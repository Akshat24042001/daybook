/**
 * The morning newsletter: written once a day (at the hour in News settings, 8 am by default) from the stories that
 * mattered since the last one, kept by date on the News page, and sent to Telegram with its PDF.
 *
 * Nothing in it is invented: the writer only gets the stories that were read (title, outlet, snippet, why it matters),
 * every point must link to one of them, and any link that is not one of those stories is removed before it is saved.
 */
import { one, q } from "../db";
import { getSettings } from "../settings";
import { salesConfig } from "../sales/config";
import { llmConfigured, llmJson } from "../sales/llm";
import { noDashes } from "../text/no-dashes";
import { calendarDate, fmtDateShort, weekdayName, type DateStr } from "../time";
import { collectNews, ownerBrief, scoreNews } from "./collect";
import { buildSections, layoutIds, linkOf, paperMarkdown, storiesByIds, STORY_COLS, topicName, type Layout, type PaperStory } from "./paper";

export interface EditionRow { id: number; date: string; title: string; markdown: string; item_ids: number[]; stories: number; created_at: string; sent_at: string | null; layout: Layout | null }
const EDITION_COLS = "id, to_char(date, 'YYYY-MM-DD') as date, title, markdown, item_ids, stories, created_at, sent_at, layout";

/** The stories for one edition: what scored 50 or more since the previous edition (30 hours at most), best first. */
export async function storiesFor(date: DateStr, limit = 80): Promise<PaperStory[]> {
  const prev = await one<{ created_at: string }>("select created_at from news_editions where date < $1 order by date desc limit 1", [date]);
  return q<PaperStory>(
    `select ${STORY_COLS} from news_items
     where score >= 50 and found_at > greatest(coalesce($1::timestamptz, now() - interval '30 hours'), now() - interval '30 hours')
     order by score desc, found_at desc limit $2`,
    [prev?.created_at ?? null, limit],
  );
}

/** Keeps only links to the stories given (by exact URL); any other link becomes plain text. Pure. */
export function keepKnownLinks(md: string, urls: string[]): string {
  const ok = new Set(urls);
  return md.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text: string, url: string) => (ok.has(url) ? all : text));
}

/** The plain-text points of a section, for Telegram. Pure. */
export function sectionPoints(md: string, heading: RegExp, max = 6): string[] {
  const parts = md.split(/\n(?=## )/);
  const sec = parts.find((p) => p.startsWith("## ") && heading.test(p.split("\n")[0] ?? ""));
  if (!sec) return [];
  return sec.split("\n").filter((l) => /^\s*[-*] /.test(l)).slice(0, max)
    .map((l) => l.replace(/^\s*[-*]\s+/, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").trim());
}

interface Draft {
  headline?: string; standfirst?: string; lead?: number; glance?: string; note?: string;
  brief?: { text: string; n?: number }[]; sectors?: { name: string; move: string; why: string; n?: number[] }[];
  opportunities?: { idea: string; n?: number }[]; today?: string[];
}

/** Turns the writer's answer (story numbers) into a layout (story ids), dropping anything that points nowhere. Pure. */
export function toLayout(d: Draft, stories: PaperStory[], fallbackTitle: string): Layout {
  const idOf = (n: unknown) => (typeof n === "number" && stories[n - 1] ? stories[n - 1].id : null);
  const txt = (s: unknown, max: number) => (typeof s === "string" ? noDashes(s.replace(/\s+/g, " ").trim()).slice(0, max) : "");
  const lead = idOf(d.lead) ?? stories[0]?.id ?? null;
  return {
    v: 2,
    headline: txt(d.headline, 140) || stories.find((s) => s.id === lead)?.title || fallbackTitle,
    standfirst: txt(d.standfirst, 300),
    lead,
    brief: (d.brief ?? []).map((b) => ({ text: txt(b?.text, 320), id: idOf(b?.n) })).filter((b) => b.text).slice(0, 8),
    glance: txt(d.glance, 1400),
    note: txt(d.note, 700),
    sectors: (d.sectors ?? []).map((x) => ({
      name: txt(x?.name, 60), move: (["up", "down", "mixed"].includes(String(x?.move)) ? x.move : "mixed") as "up" | "down" | "mixed",
      why: txt(x?.why, 300), ids: (Array.isArray(x?.n) ? x.n : []).map(idOf).filter((v): v is number => v !== null),
    })).filter((x) => x.name && x.why).slice(0, 10),
    opportunities: (d.opportunities ?? []).map((o) => ({ idea: txt(o?.idea, 320), id: idOf(o?.n) })).filter((o) => o.idea).slice(0, 6),
    today: (d.today ?? []).map((t) => txt(t, 200)).filter(Boolean).slice(0, 5),
    sections: buildSections(stories, lead),
  };
}

/** Writes (or rewrites) the edition for a day. Returns null when there is nothing worth sending. */
export async function writeEdition(date: DateStr, o: { budgetMs?: number; fresh?: boolean } = {}): Promise<EditionRow | null> {
  const budget = o.budgetMs ?? 50_000;
  const started = Date.now();
  // from a button: read and score the latest first (the scheduler does that every hour on its own)
  if (o.fresh) {
    await collectNews(Math.min(12_000, budget / 5)).catch(() => null);
    await scoreNews(Math.min(18_000, budget / 3)).catch(() => 0);
  }
  const stories = await storiesFor(date);
  if (!stories.length) return null;
  const who = await ownerBrief();
  const company = who.match(/of (.+?) \(/)?.[1] ?? "your business";
  const day = `${weekdayName(date)} ${fmtDateShort(date)}`;
  let draft: Draft = {};
  if (llmConfigured()) {
    const list = stories.slice(0, 60).map((s, i) => `[${i + 1}] ${s.title}${s.outlet ? ` (${s.outlet})` : ""} | ${topicName(s.topic)} | score ${s.score}
${(s.detail ?? s.summary ?? "").slice(0, 500)}${s.affects ? `\nAFFECTS: ${s.affects}` : ""}${s.for_you ? `\nFOR THEM: ${s.for_you}` : (s.why ? `\nWHY: ${s.why}` : "")}`).join("\n\n");
    try {
      draft = await llmJson<Draft>(
        `You are the editor of a private morning newspaper for one reader:
${who}

From the STORIES only, write the front page of today's paper (${day}) as JSON:
{"headline": a sharp newspaper headline for the day's most important story for this reader (under 90 characters),
 "standfirst": one sentence under the headline saying why it matters to them,
 "lead": the number of that story,
 "brief": 6 to 8 points, the most important things to know today across the world, markets, business and AI, each {"text": one or two
   sentences: what happened and what it means for them, "n": story number},
 "glance": "The world today": 4 to 6 sentences connecting the day's events (wars, politics, markets, oil, currencies, trade, technology) to
   demand and supply, and to businesses in India, the Gulf, the US, the UK and Europe,
 "sectors": 5 to 8 sectors or kinds of business that today's news helps or hurts, each {"name", "move": "up"|"down"|"mixed", "why": one
   sentence tied to the stories, "n": [story numbers]},
 "opportunities": 2 to 4 ideas for ${company} that follow from today's news (a service to pitch, a kind of client to call, a price to
   watch), each {"idea", "n": story number},
 "today": 3 to 5 short actions for today,
 "note": the editor's note: 2 or 3 sentences, frank, on what to watch this week}
Use only facts in the stories. Never invent numbers, names, prices or dates. "likely" when it is your reading. No dashes as punctuation.`,
        `STORIES (${stories.length}):\n\n${list}`,
        { maxTokens: 3500, totalMs: Math.max(25_000, budget - (Date.now() - started) - 4_000), deep: true },
      );
    } catch (e) {
      console.warn("[news] front page failed:", (e as Error).message);
    }
  }
  if (!draft.brief?.length) draft = { ...draft, brief: stories.slice(0, 6).map((s, i) => ({ text: `${s.title}.${s.why ? ` ${s.why}` : ""}`, n: i + 1 })) };
  const layout = toLayout(draft, stories, `Morning Brief, ${day}`);
  const byId = new Map(stories.map((s) => [s.id, s]));
  const md = noDashes(keepKnownLinks(paperMarkdown(layout, byId), stories.map(linkOf)));
  const title = `${company} Morning Brief, ${day}`;
  return one<EditionRow>(
    `insert into news_editions (date, title, markdown, item_ids, stories, layout) values ($1,$2,$3,$4,$5,$6)
     on conflict (date) do update set title = excluded.title, markdown = excluded.markdown, item_ids = excluded.item_ids, stories = excluded.stories,
       layout = excluded.layout, created_at = now(), sent_at = null
     returning ${EDITION_COLS}`,
    [date, title.slice(0, 200), md, layoutIds(layout), stories.length, JSON.stringify(layout)],
  );
}

export async function getEdition(date: DateStr): Promise<EditionRow | null> {
  return one<EditionRow>(`select ${EDITION_COLS} from news_editions where date = $1`, [date]);
}

export interface Paper { edition: EditionRow; stories: Map<number, PaperStory>; dayLine: string; number: number; owner: string; company: string; tz: string; sources: number }

/** An edition with everything it shows, ready for the page or the PDF. */
export async function loadPaper(date: DateStr): Promise<Paper | null> {
  const e = await getEdition(date);
  if (!e) return null;
  const stories = await storiesByIds(e.layout ? layoutIds(e.layout) : []);
  const cfg = await salesConfig();
  const tz = (await getSettings()).timezone;
  const number = (await one<{ n: number }>("select count(*)::int as n from news_editions where date <= $1", [date]))?.n ?? 1;
  const dayLine = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  const sources = new Set([...stories.values()].map((s) => (s.outlet ?? "").toLowerCase()).filter(Boolean)).size;
  return { edition: e, stories, dayLine, number, owner: cfg.owner.name, company: cfg.owner.company, tz, sources };
}

/** The edition as the newspaper PDF, with the articles' pictures. */
export async function editionPdfFor(date: DateStr, o: { images?: boolean } = {}): Promise<{ pdf: Uint8Array; paper: Paper } | null> {
  const paper = await loadPaper(date);
  if (!paper) return null;
  const { paperPdf, fetchImages } = await import("./pdf");
  const images = o.images === false ? new Map() : await fetchImages([...paper.stories.values()].sort((a, b) => b.score - a.score));
  const pdf = await paperPdf({
    title: paper.edition.title, date, dayLine: paper.dayLine, edition: paper.number, owner: paper.owner, company: paper.company, tz: paper.tz,
    layout: paper.edition.layout, markdown: paper.edition.markdown, stories: paper.stories, sources: paper.sources, images,
  });
  return { pdf, paper };
}

/** Sends an edition to the owner's Telegram: the whole paper as a PDF, with the headline and the brief as its caption.
 *  If the PDF cannot be attached, the brief is sent as a message with a link to the paper, and says why. */
export async function sendEdition(date: DateStr): Promise<boolean> {
  const e = await getEdition(date);
  if (!e) return false;
  const { push, ownerChat } = await import("../sales/notify");
  const { esc } = await import("../telegram/api");
  const { baseUrl } = await import("../sales/links");
  const settings = await one<{ telegram: boolean; pdf: boolean }>("select telegram, pdf from news_settings where id = 1");
  if (settings && !settings.telegram) return false;
  const markup = { inline_keyboard: [[{ text: "Open on Daybook", url: `${baseUrl()}/news?date=${date}` }]] };
  const brief = e.layout?.brief.length ? e.layout.brief.map((b) => b.text) : sectionPoints(e.markdown, /60-second|brief/i, 6);
  const todo = e.layout?.today.length ? e.layout.today : sectionPoints(e.markdown, /do today/i, 3);
  const headline = e.layout?.headline ?? e.title;
  let problem: string | null = null;
  if (settings?.pdf !== false) {
    const chat = await ownerChat();
    if (!chat) problem = "no Telegram chat linked";
    else {
      try {
        const made = await editionPdfFor(date);
        if (!made) throw new Error("the edition is missing");
        const pages = (made.pdf.length / 1024 / 1024).toFixed(1);
        let caption = `📰 <b>${esc(e.title)}</b>\n\n<b>${esc(headline)}</b>\n`;
        for (const b of brief.slice(0, 4)) {
          const line = `\n• ${esc(b)}`;
          if (caption.length + line.length > 900) break;
          caption += line;
        }
        caption += `\n\n<i>The full paper is attached: ${made.paper.stories.size} stories in detail, each linked to its source (${pages} MB).</i>`;
        await sendDocument(chat, made.pdf, `daybook-daily-${date}.pdf`, caption, markup);
        await q("update news_editions set sent_at = now() where date = $1", [date]);
        return true;
      } catch (err) {
        problem = (err as Error).message;
        console.warn("[news] PDF to Telegram failed:", problem);
      }
    }
  }
  const text = `📰 <b>${esc(e.title)}</b>\n\n<b>${esc(headline)}</b>\n\n${brief.map((b) => `• ${esc(b)}`).join("\n")}${todo.length ? `\n\n<b>Do today</b>\n${todo.map((b) => `• ${esc(b)}`).join("\n")}` : ""}${problem ? `\n\n<i>The PDF could not be attached (${esc(problem)}). Open the paper on Daybook to read or download it.</i>` : ""}`;
  const sent = await push(text.slice(0, 3900), markup);
  if (sent !== null) await q("update news_editions set sent_at = now() where date = $1", [date]);
  return sent !== null;
}

/** Telegram sendDocument (a file upload). Never puts the token in an error message. */
async function sendDocument(chatId: number, data: Uint8Array, filename: string, caption: string, markup?: unknown): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption.slice(0, 1024));
  form.set("parse_mode", "HTML");
  if (markup) form.set("reply_markup", JSON.stringify(markup));
  form.set("document", new Blob([new Uint8Array(data)], { type: "application/pdf" }), filename);
  let res: Response;
  try {
    res = await fetch(`${base}/bot${token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Telegram did not answer");
  }
  if (!res.ok) {
    const why = ((await res.json().catch(() => null)) as { description?: string } | null)?.description;
    throw new Error(`Telegram said ${res.status}${why ? `: ${why.slice(0, 120)}` : ""}`);
  }
}

/** Called by the tick: writes and sends today's edition once, at or after the hour in News settings. */
export async function scheduleEdition(now = new Date()): Promise<DateStr | null> {
  const st = await one<{ enabled: boolean; send_hour: number }>("select enabled, send_hour from news_settings where id = 1");
  if (!st?.enabled) return null;
  const tz = (await getSettings()).timezone;
  const today = calendarDate(now, tz);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < st.send_hour) return null;
  if (await one("select 1 from news_editions where date = $1", [today])) return null;
  return today;
}
