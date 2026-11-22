/**
 * The shape of the personal newspaper: a front page (headline, the lead story, the 60-second brief, the world today,
 * an editor's note), a board of which businesses win and lose today, then sections (World, Economy and markets,
 * Business and trade, AI, Sales tech, Robotics) with every story told in detail, and the day's opportunities and to-dos.
 * Used by the News page, the PDF and Telegram alike.
 */
import { q } from "../db";
import { TOPICS } from "./sources";

export interface PaperStory {
  id: number; title: string; url: string; real_url: string | null; outlet: string | null; author: string | null; image_url: string | null;
  summary: string | null; detail: string | null; affects: string | null; impact: string | null; for_you: string | null;
  score: number; topic: string; why: string | null; action: string | null; published_at: string | null; found_at: string;
}

export interface Layout {
  v: 2;
  headline: string;
  standfirst: string;
  lead: number | null;
  brief: { text: string; id: number | null }[];
  glance: string;
  note: string;
  sectors: { name: string; move: "up" | "down" | "mixed"; why: string; ids: number[] }[];
  opportunities: { idea: string; id: number | null }[];
  today: string[];
  sections: { key: string; title: string; ids: number[] }[];
}

export const SECTION_DEFS: { key: string; title: string; topics: string[] }[] = [
  { key: "world", title: "World and geopolitics", topics: ["world"] },
  { key: "economy", title: "Economy and markets", topics: ["markets_india", "india_economy", "markets_global", "global_economy", "commodities"] },
  { key: "business", title: "Business and trade", topics: ["business", "supply_chain", "clients", "competitors", "funding"] },
  { key: "ai", title: "AI and technology", topics: ["ai_tools", "ai_models", "india_ai", "policy"] },
  { key: "sales", title: "Sales and revenue tech", topics: ["sales_tech"] },
  { key: "robotics", title: "Robotics and vision", topics: ["robotics"] },
  { key: "more", title: "Also worth knowing", topics: ["other"] },
];

export const STORY_COLS = `id, title, url, real_url, outlet, author, image_url, summary, detail, affects, impact, for_you, score,
  coalesce(topic, 'other') as topic, why, action, published_at, found_at`;

/** The stories in each section, best first, the lead left out (it is on the front page). Pure. */
export function buildSections(stories: PaperStory[], leadId: number | null, perSection = 14): Layout["sections"] {
  return SECTION_DEFS.map((d) => ({
    key: d.key, title: d.title,
    ids: stories.filter((s) => s.id !== leadId && (d.topics.includes(s.topic) || (d.key === "more" && !SECTION_DEFS.some((x) => x.topics.includes(s.topic)))))
      .sort((a, b) => b.score - a.score).slice(0, perSection).map((s) => s.id),
  })).filter((s) => s.ids.length);
}

/** Where a story's link goes: the publisher's own page when it is known. Pure. */
export const linkOf = (s: Pick<PaperStory, "url" | "real_url">) => s.real_url || s.url;

/** The edition as Markdown (for search, old screens and Telegram's text). Pure. */
export function paperMarkdown(l: Layout, byId: Map<number, PaperStory>): string {
  const src = (id: number | null) => {
    const s = id ? byId.get(id) : null;
    return s ? ` [${s.outlet ?? "source"}](${linkOf(s)})` : "";
  };
  const out: string[] = [`# ${l.headline}`];
  if (l.standfirst) out.push(l.standfirst);
  if (l.brief.length) out.push("## The 60-second brief", ...l.brief.map((b) => `- ${b.text}${src(b.id)}`));
  if (l.glance) out.push("## The world today", l.glance);
  if (l.sectors.length) out.push("## Who wins, who loses", ...l.sectors.map((x) => `- **${x.name}** (${x.move}): ${x.why}${src(x.ids[0] ?? null)}`));
  const lead = l.lead ? byId.get(l.lead) : null;
  if (lead) out.push("## Lead story", `- **${lead.title}** ${lead.detail ?? lead.summary ?? ""}${src(lead.id)}`);
  for (const sec of l.sections) {
    out.push(`## ${sec.title}`);
    for (const id of sec.ids) {
      const s = byId.get(id);
      if (s) out.push(`- **${s.title}** ${(s.detail ?? s.why ?? s.summary ?? "").split(/(?<=\.)\s/)[0] ?? ""}${src(id)}`);
    }
  }
  if (l.opportunities.length) out.push("## Opportunities", ...l.opportunities.map((o) => `- ${o.idea}${src(o.id)}`));
  if (l.today.length) out.push("## Do today", ...l.today.map((t) => `- ${t}`));
  return out.join("\n");
}

export async function storiesByIds(ids: number[]): Promise<Map<number, PaperStory>> {
  if (!ids.length) return new Map();
  const rows = await q<PaperStory>(`select ${STORY_COLS} from news_items where id = any($1::int[])`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Every story id an edition shows. Pure. */
export function layoutIds(l: Layout): number[] {
  return [...new Set([l.lead, ...l.brief.map((b) => b.id), ...l.sectors.flatMap((s) => s.ids), ...l.opportunities.map((o) => o.id), ...l.sections.flatMap((s) => s.ids)].filter((x): x is number => typeof x === "number"))];
}

export const topicName = (t: string) => TOPICS[t as keyof typeof TOPICS] ?? t;
