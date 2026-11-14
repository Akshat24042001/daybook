/**
 * A radar lead in plain words: what they actually need, what you would deliver, how you can help (with which of your
 * offers), what to ask them, and an opening line. Made once per lead when you first open it, then kept.
 */
import { one, q, UserError } from "../db";
import { salesConfig } from "./config";
import { llmConfigured, llmJson } from "./llm";

export interface RadarBrief {
  /** what they want, in one or two plain sentences, no jargon */
  need: string;
  /** what would be delivered, concrete items */
  deliverables: string[];
  /** how you can help: two to four concrete steps or angles */
  help: string[];
  /** which of your offers fit */
  offers: string[];
  /** what to ask before quoting */
  questions: string[];
  /** a first line you could open with */
  opener: string | null;
  /** size of the job, as far as the post says */
  size: "small" | "medium" | "large" | null;
  /** budget and timing as stated */
  budget: string | null;
  timing: string | null;
  /** anything that makes it a poor fit, plainly */
  watch_out: string | null;
  made_at: string;
}

const SYSTEM = (owner: string, company: string, offers: string[]) => `You brief ${owner} of ${company} (an AI and software agency in India) on a lead someone posted.
OFFERS: ${offers.join("; ")}.
Explain the lead so it can be understood in ten seconds. Return JSON:
{
 "need": "what they want, in one or two plain sentences a non-technical person understands",
 "deliverables": ["the concrete things to deliver", "2 to 5 items"],
 "help": ["how ${company} can help: 2 to 4 concrete steps or angles, each one line, tied to the offers"],
 "offers": ["which offers fit, short names"],
 "questions": ["2 to 4 questions to ask them before quoting"],
 "opener": "one natural first line to open a conversation with them, specific to their post",
 "size": "small|medium|large" or null,
 "budget": "as stated, else null",
 "timing": "deadline or timing as stated, else null",
 "watch_out": "one line on what makes this a poor fit (tiny budget, vague, student, wants a full-time employee), else null"
}
Use only what the post says. Do not invent budgets, names or numbers.`;

export async function radarBrief(itemId: number, force = false): Promise<RadarBrief> {
  const it = await one<{ title: string; body: string | null; url: string | null; fit: Record<string, unknown> | null; brief: RadarBrief | null; poster: Record<string, unknown> | null }>(
    "select title, body, url, fit, brief, poster from sales_radar_items where id = $1", [itemId]);
  if (!it) throw new UserError("That lead no longer exists.");
  if (it.brief && !force) return it.brief;
  if (!llmConfigured()) throw new UserError("Explaining leads needs an AI key: add GEMINI_API_KEY.");
  const cfg = await salesConfig();
  const out = await llmJson<Partial<RadarBrief>>(
    SYSTEM(cfg.owner.name, cfg.owner.company, cfg.offers),
    `POSTED AT: ${it.url ?? "unknown"}\nPOSTER: ${JSON.stringify(it.poster ?? {})}\nSCORER'S NOTES: ${JSON.stringify(it.fit ?? {})}\n\nTITLE: ${it.title}\n\n${(it.body ?? "").slice(0, 5000)}`,
    { maxTokens: 1400, totalMs: 40_000 },
  );
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, 240)) : []);
  const text = (v: unknown, n = 400) => (typeof v === "string" && v.trim() && !/^(null|none|n\/a)$/i.test(v.trim()) ? v.trim().slice(0, n) : null);
  const brief: RadarBrief = {
    need: text(out.need, 500) ?? it.title,
    deliverables: list(out.deliverables, 5),
    help: list(out.help, 4),
    offers: list(out.offers, 4),
    questions: list(out.questions, 4),
    opener: text(out.opener, 300),
    size: (["small", "medium", "large"] as const).find((s) => s === out.size) ?? null,
    budget: text(out.budget, 120),
    timing: text(out.timing, 120),
    watch_out: text(out.watch_out, 240),
    made_at: new Date().toISOString(),
  };
  await q("update sales_radar_items set brief = $2 where id = $1", [itemId, JSON.stringify(brief)]);
  return brief;
}

/** You opened it: it is no longer unread. */
export async function markRadarSeen(ids: number[]): Promise<void> {
  if (ids.length) await q("update sales_radar_items set seen_at = now() where id = any($1) and seen_at is null", [ids]);
}
