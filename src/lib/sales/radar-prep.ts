/**
 * Every qualified radar lead is made ready on its own, without asking: what they need, the business behind the post,
 * the company researched, the decision maker and every public contact pulled together, and a draft written to them.
 *
 * It runs as a chain of short background jobs (each fits in one tick):
 *   brief  -> the requirement in plain words (radar-brief)
 *   behind -> the business behind the post, then the full company research (behind-post, research)
 *   pack   -> waits for the research, then gathers the decision maker, contacts and insights into one pack
 *   draft  -> a message written for the best way to reach them
 * Progress is kept on the lead (prep) so the radar shows a checklist, and a step that fails says why and moves on.
 * The same rules as everywhere: businesses only, only contacts that were seen in what was read, nothing invented.
 */
import { one, q } from "../db";
import { salesConfig } from "./config";
import { behindThenResearch, type Identity } from "./behind-post";
import { enqueue } from "./jobs";
import { radarBrief } from "./radar-brief";
import type { Enrichment } from "./research-fields";

export type PrepStep = "brief" | "behind" | "pack" | "draft";
export interface Prep {
  stage: PrepStep | "ready";
  started_at: string;
  ready_at?: string | null;
  steps: Partial<Record<PrepStep, { ok: boolean; note: string; at: string }>>;
  pack?: Pack | null;
  move_id?: number | null;
  /** how many times the pack step waited for the research to finish */
  waits?: number;
}

export interface Pack {
  company: { name: string | null; website: string | null; summary: string | null; what_they_do: string | null; size: string | null; location: string | null;
    revenue: string | null; budget: string | null; founded: string | null } | null;
  decision_maker: { name: string; title: string | null; email: string | null; phone: string | null; linkedin: string | null; why: string | null } | null;
  others: { name: string; title: string | null; email: string | null; linkedin: string | null }[];
  contacts: { emails: string[]; phones: string[]; whatsapp: string | null; contact_page: string | null; linkedin: string | null };
  insights: { label: string; text: string }[];
}

const step = (ok: boolean, note: string) => ({ ok, note: note.slice(0, 300), at: new Date().toISOString() });

async function save(id: number, patch: (p: Prep) => Prep): Promise<Prep> {
  const cur = (await one<{ prep: Prep | null }>("select prep from sales_radar_items where id = $1", [id]))?.prep
    ?? { stage: "brief", started_at: new Date().toISOString(), steps: {} };
  const next = patch(cur);
  await q("update sales_radar_items set prep = $2 where id = $1", [id, JSON.stringify(next)]);
  return next;
}

/** Picks the leads to prepare now: qualified, recent, not yet prepared, newest first, within the daily cap. */
export async function scheduleRadarPrep(limit = 4): Promise<number> {
  const cfg = await salesConfig();
  if (cfg.radar.auto_research_score > 100) return 0;
  const done = (await one<{ n: number }>("select count(*)::int as n from sales_radar_items where (prep->>'started_at')::timestamptz > now() - interval '24 hours'"))?.n ?? 0;
  const room = Math.min(limit, Math.max(0, (cfg.radar.auto_prep_daily ?? 40) - done));
  if (!room) return 0;
  const picks = await q<{ id: number }>(
    `select id from sales_radar_items
     where status = 'qualified' and not hidden and deal_id is null and blocked is null and prep is null
       and coalesce(score, 0) >= $1 and found_at > now() - interval '4 days'
     order by coalesce(posted_at, found_at) desc, score desc nulls last limit $2`,
    [cfg.radar.auto_research_score, room],
  );
  for (const p of picks) {
    await q("update sales_radar_items set prep = $2 where id = $1 and prep is null", [p.id, JSON.stringify({ stage: "brief", started_at: new Date().toISOString(), steps: {} } satisfies Prep)]);
    await enqueue("radar_prep", { id: p.id, step: "brief" }, { dedupeKey: `radar_prep:${p.id}:brief` });
  }
  return picks.length;
}

/** One step of the chain; queues the next. Never throws for a lead's own problem: it notes it and carries on. */
export async function radarPrepStep(id: number, s: PrepStep): Promise<void> {
  const it = await one<{ id: number; status: string; deal_id: number | null; company_id: number | null; identity: Identity | null; url: string | null }>(
    "select id, status, deal_id, company_id, identity, url from sales_radar_items where id = $1", [id]);
  if (!it || it.deal_id || ["rejected", "skipped", "converted"].includes(it.status)) return; // you already dealt with it

  if (s === "brief") {
    const r = await radarBrief(id).then(() => step(true, "Requirement understood")).catch((e) => step(false, (e as Error).message));
    await save(id, (p) => ({ ...p, stage: "behind", steps: { ...p.steps, brief: r } }));
    await enqueue("radar_prep", { id, step: "behind" }, { dedupeKey: `radar_prep:${id}:behind` });
    return;
  }

  if (s === "behind") {
    let note: ReturnType<typeof step>;
    try {
      const { identifyLead, researchRadarItem } = await import("./research");
      const named = identifyLead({ url: it.url, fit: (await one<{ fit: Parameters<typeof identifyLead>[0]["fit"] }>("select fit from sales_radar_items where id = $1", [id]))?.fit ?? null });
      if (named.name || named.website || it.company_id) {
        await researchRadarItem(id, {}, "auto");
        note = step(true, `The post names ${named.name ?? named.website ?? "the company"}: researching it`);
      } else {
        const who = await behindThenResearch(id, "auto", 30_000);
        note = who.status === "found" || who.status === "partial"
          ? step(true, `Found ${[who.person, who.company].filter(Boolean).join(" at ") || who.website}`)
          : step(false, who.note || "Could not tie a business to this post");
      }
    } catch (e) {
      note = step(false, (e as Error).message);
    }
    await save(id, (p) => ({ ...p, stage: "pack", steps: { ...p.steps, behind: note } }));
    // the company research runs in its own jobs: give it a couple of minutes before gathering
    await enqueue("radar_prep", { id, step: "pack" }, { dedupeKey: `radar_prep:${id}:pack`, runAfter: new Date(Date.now() + (note.ok ? 120_000 : 0)) });
    return;
  }

  if (s === "pack") {
    const p = (await one<{ prep: Prep | null }>("select prep from sales_radar_items where id = $1", [id]))?.prep;
    const running = await one("select 1 from sales_research_runs where radar_item_id = $1 and status in ('queued','running') and updated_at > now() - interval '10 minutes'", [id]);
    if (running && (p?.waits ?? 0) < 6) {
      await save(id, (x) => ({ ...x, waits: (x.waits ?? 0) + 1 }));
      await enqueue("radar_prep", { id, step: "pack" }, { dedupeKey: `radar_prep:${id}:pack:${(p?.waits ?? 0) + 1}`, runAfter: new Date(Date.now() + 90_000) });
      return;
    }
    const pack = await buildPack(id);
    // what the research found joins what was found behind the post, so the draft and the buttons can use it
    if (pack) await mergeIntoIdentity(id, pack);
    const has = pack && (pack.decision_maker || pack.contacts.emails.length || pack.contacts.phones.length);
    await save(id, (x) => ({
      ...x, stage: "draft", pack,
      steps: { ...x.steps, pack: pack ? step(!!has, has ? `${pack.decision_maker ? `Decision maker: ${pack.decision_maker.name}. ` : ""}${pack.contacts.emails.length + pack.contacts.phones.length} contact${pack.contacts.emails.length + pack.contacts.phones.length === 1 ? "" : "s"}` : "Company profiled, but no person or contact published") : step(false, "No company to profile") },
    }));
    await enqueue("radar_prep", { id, step: "draft" }, { dedupeKey: `radar_prep:${id}:draft` });
    return;
  }

  if (s === "draft") {
    let note: ReturnType<typeof step>;
    let moveId: number | null = null;
    try {
      const { draftForMove } = await import("./moves");
      const mv = await one<{ id: number }>(
        `insert into sales_moves (radar_item_id, kind, title, why, created_by, dedupe_key) select id, 'radar', left(title, 280), 'Radar lead, prepared for you', 'auto', $2
         from sales_radar_items where id = $1 on conflict (dedupe_key) do update set status = 'open' returning id`,
        [id, `radar:${id}`],
      );
      moveId = mv?.id ?? null;
      const m = moveId ? await draftForMove(moveId) : null;
      note = m?.draft ? step(true, `Draft ready for ${m.channel ?? "them"}`) : step(false, "The draft could not be written");
    } catch (e) {
      note = step(false, (e as Error).message);
    }
    await save(id, (x) => ({ ...x, stage: "ready", ready_at: new Date().toISOString(), move_id: moveId, steps: { ...x.steps, draft: note } }));
  }
}

const val = (e: Enrichment | null | undefined, k: string): string | null => {
  const f = e?.[k];
  if (!f || f.v === null || f.v === undefined || f.v === "") return null;
  return String(f.v).slice(0, 600);
};
const list = (s: string | null) => (s ? s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean) : []);

/** The decision maker, contacts and what matters about the company, from everything the research found. */
export async function buildPack(id: number): Promise<Pack | null> {
  const it = await one<{ company_id: number | null; identity: Identity | null }>("select company_id, identity from sales_radar_items where id = $1", [id]);
  if (!it) return null;
  const co = it.company_id
    ? await one<{ name: string; website: string | null; enrichment: Enrichment | null; employees: number | null; country: string | null; city: string | null }>(
        "select name, website, enrichment, employees, country, city from sales_companies where id = $1", [it.company_id])
    : null;
  const people = it.company_id
    ? await q<{ full_name: string; title: string | null; emails: string[]; phones: string[]; linkedin: string | null; is_decision_maker: boolean | null; enrichment: Enrichment | null }>(
        "select full_name, title, emails, phones, linkedin, is_decision_maker, enrichment from sales_people where company_id = $1 order by (is_decision_maker is true) desc, (cardinality(emails) > 0) desc, id limit 8",
        [it.company_id])
    : [];
  const who = it.identity;
  if (!co && !who?.person && !who?.emails?.length && !who?.phones?.length) return null;
  const e = co?.enrichment ?? null;

  // the decision maker: someone the research marked as deciding, else the person found behind the post, else the CEO or founder named
  const dm = people.find((p) => p.is_decision_maker) ?? (who?.person ? people.find((p) => p.full_name.toLowerCase() === who.person!.toLowerCase()) : undefined) ?? null;
  const named = val(e, "ceo") ?? list(val(e, "founders"))[0] ?? null;
  const decision_maker = dm
    ? { name: dm.full_name, title: dm.title ?? val(dm.enrichment, "current_title"), email: dm.emails[0] ?? val(dm.enrichment, "email_found"), phone: dm.phones[0] ?? val(dm.enrichment, "phone_found"), linkedin: dm.linkedin, why: val(dm.enrichment, "decision_role") ?? (dm.is_decision_maker ? "Decides on purchases like this" : null) }
    : who?.person
      ? { name: who.person, title: who.title ?? null, email: who.emails?.[0] ?? null, phone: who.phones?.[0] ?? null, linkedin: who.linkedin ?? null, why: "Posted the requirement" }
      : named
        ? { name: named, title: val(e, "ceo") ? "CEO / MD" : "Founder", email: null, phone: null, linkedin: null, why: val(e, "best_entry_person") }
        : null;

  const emails = [...new Set([...(who?.emails ?? []), ...list(val(e, "public_emails")), ...list(val(e, "generic_email")), ...people.flatMap((p) => p.emails)].map((x) => x.toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(x)))].slice(0, 5);
  const phones = [...new Set([...(who?.phones ?? []), ...list(val(e, "public_phones")), ...people.flatMap((p) => p.phones)].filter((x) => x.replace(/\D/g, "").length >= 8))].slice(0, 4);
  const size = val(e, "employees") ?? val(e, "employee_range") ?? (co?.employees ? `${co.employees} people` : null);
  const location = [val(e, "hq_city") ?? co?.city, val(e, "hq_country") ?? co?.country].filter(Boolean).join(", ") || null;
  const insights = ([
    ["Their likely pain", val(e, "pain_points")],
    ["Where you can help", val(e, "automation_opportunities")],
    ["Best first offer", val(e, "best_entry_offer")],
    ["Who to approach", val(e, "best_entry_person")],
    ["Recent news", val(e, "recent_news")],
    ["Growth signals", val(e, "expansion_signals") ?? val(e, "growth_signal")],
    ["What the problem costs them", val(e, "money_leak_estimate")],
    ["Tools they use", val(e, "tech_stack")],
    ["What customers say", val(e, "review_themes")],
    ["Watch out", val(e, "risks")],
  ] as [string, string | null][]).filter((x): x is [string, string] => !!x[1]).map(([label, text]) => ({ label, text }));

  return {
    company: co ? {
      name: co.name, website: co.website ?? val(e, "website"), summary: val(e, "summary"), what_they_do: val(e, "products_services"), size, location,
      revenue: val(e, "revenue_range") ?? val(e, "revenue_usd"), budget: val(e, "budget_capacity"), founded: val(e, "founded_year"),
    } : who?.company ? { name: who.company, website: who.website ?? null, summary: null, what_they_do: null, size: null, location: null, revenue: null, budget: null, founded: null } : null,
    decision_maker,
    others: people.filter((p) => p.full_name !== decision_maker?.name).slice(0, 4).map((p) => ({ name: p.full_name, title: p.title, email: p.emails[0] ?? null, linkedin: p.linkedin })),
    contacts: { emails, phones, whatsapp: val(e, "whatsapp_number"), contact_page: val(e, "contact_page"), linkedin: decision_maker?.linkedin ?? who?.linkedin ?? null },
    insights,
  };
}

/** The pack's contacts join the identity, so drafts, buttons and Make it a lead all use them. */
async function mergeIntoIdentity(id: number, pack: Pack): Promise<void> {
  const cur = (await one<{ identity: Identity | null }>("select identity from sales_radar_items where id = $1", [id]))?.identity;
  const emails = [...new Set([...(pack.decision_maker?.email ? [pack.decision_maker.email.toLowerCase()] : []), ...(cur?.emails ?? []), ...pack.contacts.emails])].slice(0, 5);
  const phones = [...new Set([...(pack.decision_maker?.phone ? [pack.decision_maker.phone] : []), ...(cur?.phones ?? []), ...pack.contacts.phones])].slice(0, 4);
  const next: Identity = {
    status: emails.length || phones.length || pack.decision_maker ? "found" : cur?.status ?? "partial",
    company: cur?.company ?? pack.company?.name ?? null,
    website: cur?.website ?? pack.company?.website ?? null,
    person: cur?.person ?? pack.decision_maker?.name ?? null,
    title: cur?.title ?? pack.decision_maker?.title ?? null,
    linkedin: cur?.linkedin ?? pack.contacts.linkedin ?? null,
    emails, phones,
    confidence: cur?.confidence ?? "medium",
    evidence: cur?.evidence ?? [],
    note: cur?.note ?? "From the company research.",
    candidates: cur?.candidates ?? [],
    checked_at: new Date().toISOString(),
  };
  await q("update sales_radar_items set identity = $2 where id = $1", [id, JSON.stringify(next)]);
}
