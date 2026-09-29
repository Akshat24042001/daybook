/**
 * The assistant in Telegram: the same chats, memory, queries and action buttons as the web page.
 *
 * Answers are rendered for Telegram: markdown becomes Telegram HTML, stat tiles become lines, charts become small
 * text bar charts and tables become monospace blocks. Suggested changes become inline buttons (tap to apply, tap
 * again to undo), follow-up questions become buttons too, and every answer links to the full chat in the app.
 */
import { one, q, UserError } from "../db";
import { applyStoredAction, undoStoredAction } from "../assistant/actions";
import { askAssistant } from "../assistant/run";
import type { ActionItem, Block, ChatSummary, MessageView } from "../assistant/types";
import type { Ctx } from "../settings";
import { listChats } from "../services/assistant";
import { editMarkup, editMessage, esc, sendMessage, tg, type Button, type InlineMarkup } from "./api";
import { inline, urlBtn } from "./ui";

const LIMIT = 3900; // Telegram allows 4096; leave room for tags
const IDLE_MS = 12 * 60 * 60 * 1000; // after this long, a new question starts a new chat

// ---------------------------------------------------------------- formatting

function inlineMd(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a ?? b}</b>`)
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

const cellsOf = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isDivider = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function pre(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = Array.from({ length: cols }, (_, c) => Math.min(18, Math.max(...rows.map((r) => (r[c] ?? "").length))));
  const cut = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);
  const lines = rows.map((r) => width.map((w, c) => {
    const v = cut(r[c] ?? "", w);
    return /^[−\-+]?[\d.,]+%?$/.test(v) ? v.padStart(w) : v.padEnd(w);
  }).join("  ").trimEnd());
  return `<pre>${esc(lines.join("\n"))}</pre>`;
}

/** Markdown answer -> Telegram HTML, as separate segments so a message split never cuts a block in half. */
export function mdToTelegram(md: string): string[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.join("\n"));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.push(`<pre>${esc(body.join("\n"))}</pre>`);
      continue;
    }
    if (isRow(line) && isDivider(lines[i + 1] ?? "")) {
      flush();
      const rows = [cellsOf(line)];
      i += 2;
      while (i < lines.length && isRow(lines[i])) rows.push(cellsOf(lines[i++]));
      i--;
      out.push(pre(rows));
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      para.push(`<b>${inlineMd(h[1])}</b>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      para.push(`${bullet[1].length >= 2 ? "   ◦" : "•"} ${inlineMd(bullet[2])}`);
      continue;
    }
    para.push(inlineMd(line));
  }
  flush();
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function label(v: unknown): string {
  const s = String(v ?? "");
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (d) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1]}`;
  return s;
}
function num(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return "–";
  return (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString("en-IN");
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
function bar(value: number, max: number, width = 12): string {
  if (!(value > 0) || !(max > 0)) return "";
  const units = Math.max(1, Math.round((value / max) * width * 8));
  return "█".repeat(Math.floor(units / 8)) + EIGHTHS[units % 8];
}

/** Charts, tables and stat tiles as Telegram text. */
export function blocksToTelegram(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "stats") {
      const tone = { good: "🟢", bad: "🔴", warn: "🟠", neutral: "▪️" } as const;
      out.push(b.items.map((s) => `${tone[s.tone ?? "neutral"]} <b>${esc(s.label)}</b> ${esc(s.value)}${s.sub ? ` <i>${esc(s.sub)}</i>` : ""}`).join("\n"));
    } else if (b.type === "chart") {
      const dated = b.rows.some((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r[b.x])));
      const rows = dated ? b.rows.slice(-16) : b.rows.slice(0, 16);
      const y0 = b.y[0];
      const total = b.chart === "pie" ? rows.reduce((s, r) => s + (Number(r[y0]) || 0), 0) : 0;
      const max = Math.max(...rows.map((r) => (b.chart === "stacked" ? b.y.reduce((s, y) => s + (Number(r[y]) || 0), 0) : Number(r[y0]) || 0)));
      const w = Math.min(12, Math.max(...rows.map((r) => label(r[b.x]).length)));
      const lines = rows.map((r) => {
        const v = b.chart === "stacked" ? b.y.reduce((s, y) => s + (Number(r[y]) || 0), 0) : Number(r[y0]) || 0;
        const name = label(r[b.x]);
        const tail = b.chart === "pie" && total ? `${num(v)} (${Math.round((v / total) * 100)}%)`
          : b.y.length > 1 ? b.y.map((y) => num(r[y])).join(" / ") : num(r[y0]);
        return `${(name.length > w ? `${name.slice(0, w - 1)}…` : name).padEnd(w)} ${bar(v, max).padEnd(13)} ${tail}`;
      });
      const legend = b.y.length > 1 ? `\n<i>${esc(b.y.map((y) => y.replace(/_/g, " ")).join(" / "))}</i>` : "";
      out.push(`📊 <b>${esc(b.title)}</b>${b.unit ? ` (${esc(b.unit)})` : ""}${dated && b.rows.length > rows.length ? ` <i>last ${rows.length}</i>` : ""}${legend}\n<pre>${esc(lines.join("\n"))}</pre>`);
    } else if (b.type === "table") {
      const cols = b.columns.slice(0, 4);
      const rows = b.rows.slice(0, 12).map((r) => cols.map((c) => {
        const v = r[c];
        if (v === null || v === undefined || v === "") return "–";
        if (typeof v === "boolean") return v ? "✓" : "–";
        if (Array.isArray(v)) return v.join(", ");
        if (typeof v === "number") return num(v);
        return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? label(v) : String(v);
      }));
      const more = (b.total ?? b.rows.length) - rows.length;
      out.push(`📋 <b>${esc(b.title)}</b>${more > 0 ? ` <i>(+${more} more in the app)</i>` : ""}\n${pre([cols.map((c) => c.replace(/_/g, " ")), ...rows])}`);
    }
  }
  return out;
}

/** Joins segments into messages under Telegram's size limit. */
export function chunk(segments: string[]): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of segments) {
    const seg = raw.length > LIMIT ? `${raw.slice(0, LIMIT - 20)}…` : raw;
    if (cur && cur.length + seg.length + 2 > LIMIT) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${seg}` : seg;
  }
  if (cur) out.push(cur);
  return out.length ? out : ["…"];
}

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Buttons for one answer: its actions (apply or undo), its follow-up questions, new chat and the app link. */
export function answerMarkup(blocks: Block[], chatId: number): InlineMarkup {
  const rows: (Button | null)[][] = [];
  for (const b of blocks) {
    if (b.type === "actions") {
      for (const a of b.items) {
        rows.push([
          a.status === "applied"
            ? { text: `↩ Undo · ${short(a.label)}`, callback_data: `au:${a.id}` }
            : { text: `${a.status === "failed" ? "⟳" : "▶"} ${short(a.label)}`, callback_data: `aa:${a.id}` },
        ]);
      }
    }
  }
  for (const b of blocks) {
    if (b.type === "followups") b.items.slice(0, 3).forEach((f, i) => rows.push([{ text: `💬 ${short(f, 60)}`, callback_data: `af:${i}` }]));
  }
  rows.push([{ text: "🆕 New chat", callback_data: "an" }, urlBtn("Open in app", `/assistant?c=${chatId}`)]);
  return inline(rows);
}

// ---------------------------------------------------------------- chat state

/** The chat Telegram is continuing, unless it has been quiet for half a day. */
async function currentChatId(ctx: Ctx): Promise<number | null> {
  const row = await one<{ id: number; updated_at: Date }>(
    "select c.id, c.updated_at from settings s join assistant_chats c on c.id = s.assistant_tg_chat_id where s.id = 1",
  );
  if (!row || ctx.now.getTime() - row.updated_at.getTime() > IDLE_MS) return null;
  return row.id;
}

async function setCurrentChat(id: number | null): Promise<void> {
  await q("update settings set assistant_tg_chat_id = $1 where id = 1", [id]);
}

/** Sends a saved answer: text, then data blocks, split to fit, with the buttons on the last message. */
async function deliver(chat: number, replaceId: number | null, c: ChatSummary, m: MessageView): Promise<void> {
  const parts = chunk([...mdToTelegram(m.content), ...blocksToTelegram(m.blocks)]);
  const markup = answerMarkup(m.blocks, c.id);
  let lastId = replaceId;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    if (i === 0 && replaceId) await editMessage(chat, replaceId, parts[0], last ? markup : undefined);
    else lastId = await sendMessage(chat, parts[i], last ? markup : undefined);
  }
  if (lastId) await q("update assistant_messages set tg_message_id = $2 where id = $1", [m.id, lastId]);
}

// ---------------------------------------------------------------- asking

/**
 * Answers a question in Telegram: a "Thinking…" message that shows progress, replaced by the answer. Status edits
 * are chained and stop before the answer lands, so a late status can never overwrite it.
 */
export async function askFromTelegram(ctx: Ctx, chat: number, text: string, chatId?: number | null): Promise<void> {
  const started = Date.now();
  await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => undefined);
  const mid = await sendMessage(chat, "🤔 Thinking…");
  let status = "Thinking…";
  let queries = 0;
  let lastEdit = 0;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  const show = () => {
    if (closed || Date.now() - lastEdit < 2500) return;
    lastEdit = Date.now();
    const line = `🤔 ${esc(status)}${queries ? ` · ${queries} ${queries === 1 ? "query" : "queries"} run` : ""}`;
    chain = chain.then(() => (closed ? undefined : editMessage(chat, mid, line).catch(() => undefined)));
  };
  try {
    const r = await askAssistant({
      chatId: chatId === undefined ? await currentChatId(ctx) : chatId,
      message: text,
      source: "telegram",
      ctx,
      deadline: started + 52_000,
      onStatus: (t) => { status = t; show(); },
      onQuery: () => { queries++; show(); },
    });
    closed = true;
    await chain;
    await setCurrentChat(r.chat.id);
    await deliver(chat, mid, r.chat, r.message);
  } catch (e) {
    closed = true;
    await chain;
    const msg = e instanceof UserError ? e.message
      : /OpenRouter|model/i.test((e as Error).message) ? "The AI models are busy right now. Try again in a minute."
        : "Something went wrong answering that. Try again.";
    if (!(e instanceof UserError)) console.error("[bot] assistant failed:", (e as Error).name, (e as Error).message);
    await editMessage(chat, mid, `⚠️ ${esc(msg)}`).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- commands and buttons

export async function newChat(chat: number): Promise<void> {
  await setCurrentChat(null);
  await sendMessage(chat, "🆕 New chat. Ask me anything about your Daybook, or tell me what to change.");
}

export async function listChatsMessage(ctx: Ctx, chat: number): Promise<void> {
  const chats = (await listChats()).slice(0, 8);
  const current = await currentChatId(ctx);
  if (!chats.length) {
    await sendMessage(chat, "No chats yet. Ask a question to start one.");
    return;
  }
  await sendMessage(
    chat,
    "💬 <b>Your chats</b>\nTap one to continue it here. Web and Telegram share them.",
    inline([
      ...chats.map((c) => [{ text: `${c.id === current ? "● " : ""}${c.pinned ? "📌 " : ""}${short(c.title, 50)}`, callback_data: `ac:${c.id}` }]),
      [{ text: "🆕 New chat", callback_data: "an" }, urlBtn("All chats", "/assistant")],
    ]),
  );
}

/** Redraws the buttons of the answer shown in `messageId` with the actions' current state. */
async function redraw(chat: number, messageId: number): Promise<void> {
  const m = await one<{ chat_id: number; blocks: Block[] }>("select chat_id, blocks from assistant_messages where tg_message_id = $1", [messageId]);
  if (!m) return;
  const ids = m.blocks.flatMap((b) => (b.type === "actions" ? b.items.map((i) => i.id) : []));
  const now = new Map(
    (await q<ActionItem>("select id, label, detail, status, error from assistant_actions where id = any($1::int[])", [ids])).map((a) => [a.id, a]),
  );
  const blocks = m.blocks.map((b) => (b.type === "actions" ? { ...b, items: b.items.map((i) => now.get(i.id) ?? i) } : b));
  await editMarkup(chat, messageId, answerMarkup(blocks, m.chat_id)).catch(() => undefined);
}

/**
 * Button taps for the assistant. Returns the toast text, and, when the tap asks a question, a task to run after the
 * webhook has answered (asking can take up to a minute).
 */
export async function assistantCallback(
  ctx: Ctx,
  chat: number,
  messageId: number | undefined,
  data: string,
): Promise<{ toast?: string; later?: () => Promise<void> }> {
  const [kind, arg] = data.split(":");
  switch (kind) {
    case "aa": {
      const item = await applyStoredAction(ctx, Number(arg));
      if (messageId) await redraw(chat, messageId);
      return { toast: `✓ ${short(item.label, 150)}` };
    }
    case "au": {
      const item = await undoStoredAction(Number(arg));
      if (messageId) await redraw(chat, messageId);
      return { toast: `↩ Undone: ${short(item.label, 140)}` };
    }
    case "af": {
      const m = messageId
        ? await one<{ chat_id: number; blocks: Block[] }>("select chat_id, blocks from assistant_messages where tg_message_id = $1", [messageId])
        : null;
      const f = m?.blocks.find((b) => b.type === "followups");
      const question = f && f.type === "followups" ? f.items[Number(arg)] : undefined;
      if (!m || !question) throw new UserError("That question is no longer available.");
      await sendMessage(chat, `💬 <i>${esc(question)}</i>`);
      return { later: () => askFromTelegram(ctx, chat, question, m.chat_id) };
    }
    case "an":
      await newChat(chat);
      return { toast: "New chat" };
    case "ac": {
      const c = await one<{ id: number; title: string }>("select id, title from assistant_chats where id = $1", [Number(arg)]);
      if (!c) throw new UserError("That chat was deleted.");
      await setCurrentChat(c.id);
      await q("update assistant_chats set updated_at = now() where id = $1", [c.id]);
      const last = await one<{ content: string }>(
        "select content from assistant_messages where chat_id = $1 and role = 'assistant' order by id desc limit 1", [c.id],
      );
      await sendMessage(
        chat,
        `💬 Continuing <b>${esc(c.title)}</b>.${last ? `\n\n<i>Last answer:</i> ${esc(short(last.content.replace(/[*_`#|]/g, "").replace(/\s+/g, " "), 300))}` : ""}\n\nAsk away.`,
      );
      return { toast: short(c.title, 60) };
    }
    default:
      return {};
  }
}

/** Starter questions behind the 🤖 Ask key. */
export const STARTERS = [
  "How is my day going so far?",
  "What is still pending today, most important first?",
  "Grade my last 7 days. Be brutal.",
  "When in the day do I get the most done?",
  "Who should I reconnect with this week?",
];

export async function askMenu(ctx: Ctx, chat: number): Promise<void> {
  const current = await currentChatId(ctx);
  const c = current ? await one<{ title: string }>("select title from assistant_chats where id = $1", [current]) : null;
  await sendMessage(
    chat,
    `🤖 <b>Ask your Daybook</b>\nType or say anything: questions about your day, tasks, habits, projects and people, or changes like “mark the invoice done and log 45m”. Changes come back as buttons: tap to apply, tap again to undo.${c ? `\n\nContinuing: <b>${esc(c.title)}</b>` : ""}`,
    inline([
      ...STARTERS.map((s, i) => [{ text: `💬 ${s}`, callback_data: `aq:${i}` }]),
      [{ text: "🆕 New chat", callback_data: "an" }, { text: "💬 My chats", callback_data: "al" }],
    ]),
  );
}

/** Heuristic: text that reads as a question for the assistant rather than a task to add. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 4) return false;
  if (/\?\s*$/.test(t)) return true;
  return /^(how|what|what's|whats|when|where|why|which|who|whom|whose|show me|tell me|give me|compare|summari[sz]e|analy[sz]e|explain|am i|was i|have i|did i|kya|kaise|kab|kitna|kitne|kitni|kaun|kyun|kyu|batao|bata)\b/.test(t);
}
