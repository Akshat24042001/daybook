/**
 * The morning newsletter: written once a day (at the hour in News settings, 8 am by default) from the stories that
 * mattered since the last one, kept by date on the News page, and sent to Telegram with its PDF.
 *
 * Nothing in it is invented: the writer only gets the stories that were read (title, outlet, snippet, why it matters),
 * every point must link to one of them, and any link that is not one of those stories is removed before it is saved.
 */
import { one, q } from "../db";
import { getSettings } from "../settings";
import { llm, llmConfigured } from "../sales/llm";
import { noDashes } from "../text/no-dashes";
import { calendarDate, fmtDateShort, weekdayName, type DateStr } from "../time";
import { collectNews, ownerBrief, scoreNews } from "./collect";
import { TOPICS } from "./sources";

export interface EditionRow { id: number; date: string; title: string; markdown: string; item_ids: number[]; stories: number; created_at: string; sent_at: string | null }
export interface PickedStory { id: number; title: string; url: string; outlet: string | null; summary: string | null; score: number; topic: string; why: string | null; action: string | null }

/** The stories for one edition: what scored 50 or more since the previous edition (a day at most), best first. */
export async function storiesFor(date: DateStr, limit = 45): Promise<PickedStory[]> {
  const prev = await one<{ created_at: string }>("select created_at from news_editions where date < $1 order by date desc limit 1", [date]);
  return q<PickedStory>(
    `select id, title, url, outlet, summary, score, coalesce(topic, 'other') as topic, why, action from news_items
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

const SECTIONS = `## The 60-second brief
(the 5 most important points of the day for them, across every topic)
## AI tools and launches worth trying
## Models and platforms
## Sales and revenue tech
## Robotics and computer vision
## Markets: India
## Markets and economy: world
## Your clients' industries and countries
## Opportunities for ${"{company}"}
(ideas that follow from today's news: a service to pitch, a kind of client to call, a price to change; each tied to its story, written as an idea)
## Do today
(3 short actions)`;

/** Writes (or rewrites) the edition for a day. Returns null when there is nothing worth sending. */
export async function writeEdition(date: DateStr, o: { budgetMs?: number; fresh?: boolean } = {}): Promise<EditionRow | null> {
  const budget = o.budgetMs ?? 50_000;
  const started = Date.now();
  // from a button: read and score the latest first (the scheduler does that every hour on its own)
  if (o.fresh) {
    await collectNews(Math.min(15_000, budget / 4)).catch(() => null);
    await scoreNews(Math.min(20_000, budget / 3)).catch(() => 0);
  }
  const stories = await storiesFor(date);
  if (!stories.length) return null;
  const who = await ownerBrief();
  const company = who.match(/of (.+?) \(/)?.[1] ?? "your business";
  const day = `${weekdayName(date)} ${fmtDateShort(date)}`;
  const list = stories.map((s, i) => `[${i + 1}] ${s.title}${s.outlet ? ` (${s.outlet})` : ""}\nURL: ${s.url}\nTOPIC: ${TOPICS[s.topic as keyof typeof TOPICS] ?? s.topic} | SCORE: ${s.score}\nSNIPPET: ${(s.summary ?? "").slice(0, 300)}\nWHY IT MATTERS: ${s.why ?? ""}${s.action ? `\nACTION: ${s.action}` : ""}`).join("\n\n");
  let md: string;
  if (llmConfigured()) {
    const r = await llm([
      { role: "system", content: `You write a private morning newsletter for one reader:
${who}

Write today's edition in Markdown, from the STORIES below only. Structure, in this order (leave out a section with nothing worth saying):
# ${company} Morning Brief, ${day}
${SECTIONS.replace("{company}", company)}

Rules:
- Every point is one or two short sentences: what happened, then why it matters to THIS reader (their offers, clients, costs, tools, money).
- Every point ends with its source as a Markdown link using the story's exact URL: [Outlet](URL). Never a URL that is not in STORIES.
- Use only facts in the stories. No invented numbers, quotes, prices or dates. If a story's details are thin, say less, not more.
- The same story appears once (in the brief, or in its section, not both, except the brief may point to a section).
- Plain, sharp, no hype, no filler, no greetings or sign-offs. Bold the company or product name at the start of a point.
- No dashes as punctuation. Under 1000 words.` },
      { role: "user", content: `STORIES (${stories.length}):\n\n${list}` },
    ], { maxTokens: 3500, temperature: 0.3, totalMs: Math.max(25_000, budget - (Date.now() - started) - 3_000), deep: true });
    md = r.text.replace(/^```\w*\s*|```\s*$/g, "").trim();
  } else {
    // no AI key: the stories themselves, best first, grouped by topic
    const by = new Map<string, PickedStory[]>();
    for (const s of stories) by.set(s.topic, [...(by.get(s.topic) ?? []), s]);
    md = `# Morning Brief, ${day}\n\n${[...by].map(([t, xs]) => `## ${TOPICS[t as keyof typeof TOPICS] ?? t}\n${xs.map((s) => `- **${s.title}**${s.why ? ` ${s.why}` : ""} [${s.outlet ?? "source"}](${s.url})`).join("\n")}`).join("\n\n")}`;
  }
  md = noDashes(keepKnownLinks(md, stories.map((s) => s.url)));
  if (md.length < 120) return null;
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `Morning Brief, ${day}`;
  return one<EditionRow>(
    `insert into news_editions (date, title, markdown, item_ids, stories) values ($1,$2,$3,$4,$5)
     on conflict (date) do update set title = excluded.title, markdown = excluded.markdown, item_ids = excluded.item_ids, stories = excluded.stories, created_at = now(), sent_at = null
     returning id, to_char(date, 'YYYY-MM-DD') as date, title, markdown, item_ids, stories, created_at, sent_at`,
    [date, title.slice(0, 200), md, stories.map((s) => s.id), stories.length],
  );
}

export async function getEdition(date: DateStr): Promise<EditionRow | null> {
  return one<EditionRow>("select id, to_char(date, 'YYYY-MM-DD') as date, title, markdown, item_ids, stories, created_at, sent_at from news_editions where date = $1", [date]);
}

/** Sends an edition to the owner's Telegram: the 60-second brief as a message, the whole thing as a PDF. */
export async function sendEdition(date: DateStr): Promise<boolean> {
  const e = await getEdition(date);
  if (!e) return false;
  const { push, ownerChat } = await import("../sales/notify");
  const { esc } = await import("../telegram/api");
  const { baseUrl } = await import("../sales/links");
  const settings = await one<{ telegram: boolean; pdf: boolean }>("select telegram, pdf from news_settings where id = 1");
  if (settings && !settings.telegram) return false;
  const brief = sectionPoints(e.markdown, /60-second|brief/i, 5);
  const todo = sectionPoints(e.markdown, /do today/i, 3);
  const text = `📰 <b>${esc(e.title)}</b>\n\n${brief.map((b) => `• ${esc(b)}`).join("\n")}${todo.length ? `\n\n<b>Do today</b>\n${todo.map((b) => `• ${esc(b)}`).join("\n")}` : ""}`;
  const sent = await push(text.slice(0, 3900), { inline_keyboard: [[{ text: "Read it all", url: `${baseUrl()}/news?date=${date}` }]] });
  if (settings?.pdf !== false) {
    const chat = await ownerChat();
    if (chat) {
      const { editionPdf } = await import("./pdf");
      const pdf = await editionPdf(e);
      await sendDocument(chat, pdf, `morning-brief-${date}.pdf`, e.title).catch((err) => console.warn("[news] pdf to Telegram failed:", (err as Error).message));
    }
  }
  if (sent !== null) await q("update news_editions set sent_at = now() where date = $1", [date]);
  return sent !== null;
}

/** Telegram sendDocument (a file upload). Never puts the token in an error message. */
async function sendDocument(chatId: number, data: Uint8Array, filename: string, caption: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption.slice(0, 1000));
  form.set("document", new Blob([new Uint8Array(data)], { type: "application/pdf" }), filename);
  let res: Response;
  try {
    res = await fetch(`${base}/bot${token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("sendDocument: network error");
  }
  if (!res.ok) throw new Error(`sendDocument: HTTP ${res.status}`);
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
