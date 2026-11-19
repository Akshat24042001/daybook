/**
 * Share a deal: everything that matters about it in one go, in the same four forms as a radar lead (lead-share): the
 * full details, a short WhatsApp version, a version for Claude with what to do, and the data. Its contacts come first,
 * then where it stands and the next step, then what they need, the latest conversation, promises and documents.
 */
import { one, q, UserError } from "../db";
import { getSettings } from "../settings";
import { noDashes } from "../text/no-dashes";
import { salesConfig } from "./config";
import { getDeal } from "./deals";
import type { LeadShare } from "./lead-share";

export interface DealDossier {
  id: number;
  title: string;
  stage: string;
  days_in_stage: number;
  value: string | null;
  next_step: string | null;
  next_step_at: string | null;
  source: string | null;
  country: string | null;
  people: { name: string; title: string | null; decides: boolean; phones: string[]; whatsapp: string | null; emails: string[]; linkedin: string | null; place: string | null }[];
  company: { name: string; website: string | null; phone: string | null; email: string | null; industry: string | null; place: string | null; summary: string | null } | null;
  need: string | null;
  summary: string | null;
  budget: string | null;
  timeline: { at: string; channel: string; direction: string; text: string }[];
  promises: { owner: string; text: string; due: string | null }[];
  documents: { title: string; status: string }[];
}

export async function dealDossier(dealId: number): Promise<DealDossier> {
  const d = await getDeal(dealId);
  if (!d) throw new UserError("That deal no longer exists.");
  const [people, company, tl, promises, docs] = await Promise.all([
    q<{ full_name: string; title: string | null; is_decision_maker: boolean | null; phones: string[]; whatsapp: string | null; emails: string[]; linkedin: string | null; city: string | null; country: string | null }>(
      `select p.full_name, p.title, p.is_decision_maker, p.phones, p.whatsapp, p.emails, p.linkedin, p.city, p.country
       from sales_deal_people dp join sales_people p on p.id = dp.person_id where dp.deal_id = $1 order by (p.id = $2) desc, p.full_name`,
      [dealId, d.person_id ?? 0],
    ),
    d.company_id
      ? one<{ name: string; website: string | null; phone: string | null; email: string | null; industry: string | null; city: string | null; country: string | null; description: string | null }>(
          "select name, website, phone, email, industry, city, country, description from sales_companies where id = $1", [d.company_id])
      : Promise.resolve(null),
    q<{ occurred_at: string; channel: string; direction: string; summary: string | null; body: string | null }>(
      "select occurred_at, channel, direction, summary, body from sales_interactions where deal_id = $1 order by occurred_at desc limit 12", [dealId]),
    q<{ owner: string; text: string; due_on: string | null }>("select owner, text, to_char(due_at, 'YYYY-MM-DD') as due_on from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last", [dealId]).catch(() => []),
    q<{ title: string; status: string }>("select title, status from sales_docs where deal_id = $1 and not coalesce(internal, false) order by id desc limit 8", [dealId]).catch(() => []),
  ]);
  const place = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(", ") || null;
  return {
    id: d.id, title: d.title, stage: d.stage_name,
    days_in_stage: Math.floor((Date.now() - new Date(d.stage_changed_at).getTime()) / 86_400_000),
    value: d.value_amount ? `${d.currency} ${Number(d.value_amount).toLocaleString("en-IN")}` : null,
    next_step: d.next_action, next_step_at: d.next_action_at, source: d.source, country: d.country,
    people: people.map((p) => ({ name: p.full_name, title: p.title, decides: !!p.is_decision_maker, phones: p.phones, whatsapp: p.whatsapp, emails: p.emails, linkedin: p.linkedin, place: place(p.city, p.country) })),
    company: company ? { name: company.name, website: company.website, phone: company.phone, email: company.email, industry: company.industry, place: place(company.city, company.country), summary: company.description } : null,
    need: d.requirements, summary: d.summary, budget: d.budget,
    timeline: tl.map((i) => ({ at: i.occurred_at, channel: i.channel, direction: i.direction, text: (i.summary || i.body || "").replace(/\s+/g, " ").slice(0, 300) })),
    promises: promises.map((p) => ({ owner: p.owner === "me" ? "We promised" : "They promised", text: p.text, due: p.due_on })),
    documents: docs,
  };
}

const when = (iso: string, tz: string) => new Date(iso).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const who = (dir: string) => (dir === "in" ? "them" : dir === "out" ? "us" : dir === "internal" ? "note" : "both");

/** The contacts block, the same in every form. Pure. */
export function contactLines(d: Pick<DealDossier, "people" | "company">): string[] {
  const out: string[] = [];
  for (const p of d.people) {
    const bits = [...p.phones, ...(p.whatsapp && !p.phones.some((x) => x.replace(/\D/g, "") === p.whatsapp!.replace(/\D/g, "")) ? [`WhatsApp ${p.whatsapp}`] : []), ...p.emails, p.linkedin, p.place].filter(Boolean);
    out.push(`- ${p.name}${p.title ? ` (${p.title})` : ""}${p.decides ? ", decides" : ""}${bits.length ? `: ${bits.join(" · ")}` : ": no contact yet"}`);
  }
  if (d.company && (d.company.phone || d.company.email || d.company.website)) {
    out.push(`- ${d.company.name} (office): ${[d.company.phone, d.company.email, d.company.website, d.company.place].filter(Boolean).join(" · ")}`);
  }
  return out;
}

/** Everything, as Markdown. Pure. */
export function dealText(d: DealDossier, tz = "Asia/Kolkata"): string {
  const out: string[] = [`# ${d.title}`];
  out.push([`Stage: ${d.stage} (${d.days_in_stage} day${d.days_in_stage === 1 ? "" : "s"})`, d.value ? `Value: ${d.value}` : null, d.country ? `Country: ${d.country}` : null, d.source ? `Source: ${d.source}` : null].filter(Boolean).join(" · "));
  const sec = (h: string, body: string | null | undefined) => { if (body && body.trim()) out.push(`## ${h}\n${body.trim()}`); };
  sec("Contacts", contactLines(d).join("\n"));
  sec("Next step", d.next_step ? `${d.next_step}${d.next_step_at ? ` (by ${when(d.next_step_at, tz)})` : ""}` : "None set");
  sec("What they need", d.need);
  sec("Where we are", d.summary);
  sec("Budget", d.budget);
  sec("Company", d.company ? [d.company.name, d.company.industry, d.company.place, d.company.summary].filter(Boolean).join("\n") : null);
  sec("Latest conversation", d.timeline.map((t) => `- ${when(t.at, tz)}, ${t.channel}, ${who(t.direction)}: ${t.text}`).join("\n"));
  sec("Open promises", d.promises.map((p) => `- ${p.owner}: ${p.text}${p.due ? ` (by ${p.due})` : ""}`).join("\n"));
  sec("Documents", d.documents.map((x) => `- ${x.title} (${x.status})`).join("\n"));
  out.push(`From Daybook, deal #${d.id}.`);
  return noDashes(out.join("\n\n"));
}

/** The essentials for WhatsApp. Pure. */
export function dealWhatsapp(d: DealDossier): string {
  const c = contactLines(d);
  return noDashes([
    `*${d.title.slice(0, 160)}*\n${d.stage}${d.value ? ` · ${d.value}` : ""}`,
    c.length ? `*Contact:*\n${c.join("\n")}` : null,
    d.next_step ? `*Next step:* ${d.next_step}` : null,
    d.need ? `*Need:* ${d.need.replace(/\s+/g, " ").slice(0, 400)}` : null,
    d.timeline[0] ? `*Last:* ${d.timeline[0].channel}, ${who(d.timeline[0].direction)}: ${d.timeline[0].text.slice(0, 200)}` : null,
  ].filter(Boolean).join("\n\n")).slice(0, 3500);
}

export async function dealShare(dealId: number): Promise<LeadShare> {
  const [d, cfg, settings] = await Promise.all([dealDossier(dealId), salesConfig(), getSettings()]);
  const full = dealText(d, settings.timezone);
  const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || `deal-${d.id}`;
  return {
    title: d.title,
    full,
    whatsapp: dealWhatsapp(d),
    claude: noDashes(`I am ${cfg.owner.name}, ${cfg.owner.title} of ${cfg.owner.company} (${cfg.owner.website}). What we offer: ${cfg.offers.join("; ")}.
Below is one deal from my sales pipeline. Please help me move it forward:
1. Tell me plainly where it stands and what is blocking it.
2. Suggest the next step, who to talk to, on which channel, and when.
3. Write the next message in my voice: short, specific to them, one easy next step.
Never invent names, numbers or facts. If something is missing, say so.

${full}`),
    json: JSON.stringify(d, null, 2),
    filename: `deal-${d.id}-${slug}.md`,
  };
}

export async function sendDealToTelegram(dealId: number): Promise<number> {
  const { push } = await import("./notify");
  const { esc } = await import("../telegram/api");
  const sh = await dealShare(dealId);
  const parts: string[] = [];
  let cur = "";
  for (const block of sh.full.split("\n\n")) {
    if ((cur + block).length > 3500 && cur) { parts.push(cur); cur = ""; }
    cur += `${block}\n\n`;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts.slice(0, 8)) await push(esc(p.trim()));
  return Math.min(parts.length, 8);
}
