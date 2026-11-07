/**
 * The objection library. Every conversation already records the objections people raise (deal.objections, free text).
 * Here the same objection said many ways ("too expensive", "price is high for us") becomes one entry, with how deals
 * that raised it ended, and your best answer to it.
 *
 * - Grouping: the AI maps new raw objections to an existing label or a new short one. Without an AI key, each raw
 *   objection is its own label (cleaned up), so nothing is ever lost or invented.
 * - Answers: you write them, or ask for a suggestion drawn from the deals you WON that raised it. A suggestion is
 *   marked as one until you save it as yours.
 * - Use: a deal whose objections have answers gets them in its context, so drafts and pre-call briefs use them.
 */
import { one, q, UserError } from "../db";
import { dealContext } from "./context";
import { llm, llmConfigured, llmJson } from "./llm";

export interface ObjectionRow {
  id: number;
  label: string;
  answer: string | null;
  answer_source: "ai" | "me" | null;
  deals: number;
  won: number;
  lost: number;
  open: number;
  win_rate: number | null;
  examples: string[];
  deal_ids: number[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 80);

/** Groups raw objections that are not in the library yet. Returns how many raw objections were filed. */
export async function syncObjections(limit = 60): Promise<number> {
  const pending = await q<{ deal_id: number; raw: string }>(
    `select d.id as deal_id, trim(o) as raw from sales_deals d cross join lateral unnest(d.objections) o
     where trim(o) <> '' and not exists (select 1 from sales_deal_objections x where x.deal_id = d.id and x.raw = trim(o))
     limit $1`,
    [limit],
  );
  if (!pending.length) return 0;
  const labels = (await q<{ id: number; label: string }>("select id, label from sales_objections order by id")).map((r) => r.label);
  const raws = [...new Set(pending.map((p) => p.raw))];
  let map: Record<string, string> = {};
  if (llmConfigured()) {
    try {
      const out = await llmJson<{ map?: Record<string, string> } | Record<string, string>>(
        `You group sales objections. Map each raw objection to a short label (2 to 6 words, plain, e.g. "Price too high", "No budget right now",
"Already have a vendor", "Need to involve my partner", "Not the right time"). Reuse an EXISTING label whenever the meaning is the same.
Create a new label only for a genuinely different objection. Return JSON {"map": {"<raw objection exactly as given>": "<label>"}}.`,
        `EXISTING LABELS:\n${labels.map((l) => `- ${l}`).join("\n") || "(none yet)"}\n\nRAW OBJECTIONS:\n${raws.map((r) => `- ${r}`).join("\n")}`,
        { maxTokens: 1500, totalMs: 30_000 },
      );
      map = ("map" in out && out.map && typeof out.map === "object" ? out.map : out) as Record<string, string>;
    } catch {
      map = {};
    }
  }
  let n = 0;
  for (const p of pending) {
    const label = clean(String(map[p.raw] ?? "") || p.raw);
    if (!label) continue;
    const obj = await one<{ id: number }>(
      "insert into sales_objections (label) values ($1) on conflict (label) do update set label = excluded.label returning id",
      [label],
    );
    await q("insert into sales_deal_objections (deal_id, objection_id, raw) values ($1,$2,$3) on conflict do nothing", [p.deal_id, obj!.id, p.raw]);
    n += 1;
  }
  return n;
}

export async function listObjections(): Promise<ObjectionRow[]> {
  const rows = await q<Omit<ObjectionRow, "win_rate">>(
    `select o.id, o.label, o.answer, o.answer_source,
            count(distinct x.deal_id)::int as deals,
            count(distinct x.deal_id) filter (where s.category = 'won')::int as won,
            count(distinct x.deal_id) filter (where s.category = 'lost' or s.role = 'ghosted')::int as lost,
            count(distinct x.deal_id) filter (where s.category = 'open')::int as open,
            (array_agg(distinct x.raw))[1:4] as examples,
            array_agg(distinct x.deal_id) as deal_ids
     from sales_objections o
     join sales_deal_objections x on x.objection_id = o.id
     join sales_deals d on d.id = x.deal_id join sales_stages s on s.id = d.stage_id
     group by o.id order by count(distinct x.deal_id) desc, o.label`,
  );
  return rows.map((r) => ({ ...r, win_rate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null }));
}

export async function pendingObjections(): Promise<number> {
  const r = await one<{ n: number }>(
    `select count(*)::int as n from sales_deals d cross join lateral unnest(d.objections) o
     where trim(o) <> '' and not exists (select 1 from sales_deal_objections x where x.deal_id = d.id and x.raw = trim(o))`,
  );
  return r?.n ?? 0;
}

export async function saveAnswer(id: number, answer: string): Promise<void> {
  await q("update sales_objections set answer = nullif(trim($2), ''), answer_source = case when nullif(trim($2), '') is null then null else 'me' end, updated_at = now() where id = $1", [id, answer]);
}

export async function renameObjection(id: number, label: string): Promise<void> {
  const l = clean(label);
  if (!l) throw new UserError("Give it a name.");
  const other = await one<{ id: number }>("select id from sales_objections where label = $1 and id <> $2", [l, id]);
  if (other) {
    // renaming onto an existing label merges the two
    await q("update sales_deal_objections set objection_id = $1 where objection_id = $2 and (deal_id, raw) not in (select deal_id, raw from sales_deal_objections where objection_id = $1)", [other.id, id]);
    await q("update sales_objections set answer = coalesce(answer, (select answer from sales_objections where id = $2)) where id = $1", [other.id, id]);
    await q("delete from sales_objections where id = $1", [id]);
    return;
  }
  await q("update sales_objections set label = $2, updated_at = now() where id = $1", [id, l]);
}

/** Drafts an answer from how you handled it in deals you won (or a principled answer if there are none). */
export async function suggestAnswer(id: number): Promise<string> {
  const o = await one<{ label: string }>("select label from sales_objections where id = $1", [id]);
  if (!o) throw new UserError("That objection no longer exists.");
  if (!llmConfigured()) throw new UserError("Suggestions need an AI key (GEMINI_API_KEY or OPENROUTER_API_KEY).");
  const won = await q<{ deal_id: number }>(
    `select x.deal_id from sales_deal_objections x join sales_deals d on d.id = x.deal_id join sales_stages s on s.id = d.stage_id
     where x.objection_id = $1 and s.category = 'won' order by d.updated_at desc limit 3`,
    [id],
  );
  const contexts = await Promise.all(won.map((w) => dealContext(w.deal_id, { interactions: 12 })));
  const { text } = await llm([
    { role: "system", content: `You coach a founder of a small AI agency. Write the best short answer (2 to 4 sentences, plain words, no dashes, no hype) to the objection below. ${contexts.length ? "Base it on how the founder actually handled it in the deals below that were WON; reuse what worked." : "There are no won deals with this objection yet, so give a principled, honest answer: acknowledge, reframe around their cost of the problem, offer a smaller first step."} Never invent numbers, clients or results. Return only the answer.` },
    { role: "user", content: `OBJECTION: ${o.label}\n\n${contexts.map((c, i) => `WON DEAL ${i + 1}:\n${c.slice(0, 3500)}`).join("\n\n")}` },
  ], { maxTokens: 400, totalMs: 40_000 });
  const answer = text.trim();
  await q("update sales_objections set answer = $2, answer_source = 'ai', updated_at = now() where id = $1", [id, answer]);
  return answer;
}
