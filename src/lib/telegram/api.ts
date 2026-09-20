/**
 * Thin Telegram Bot API client over fetch (works in serverless). The bot token is read from the
 * environment only and never logged or included in error messages.
 */

export class TelegramError extends Error {
  constructor(
    public method: string,
    message: string,
    public code?: number,
  ) {
    super(`Telegram ${method}: ${message}`);
    this.name = "TelegramError";
  }
}

export interface Button {
  text: string;
  callback_data?: string;
  url?: string;
}
export interface InlineMarkup {
  inline_keyboard: Button[][];
}
export interface ReplyKeyboard {
  keyboard: { text: string }[][];
  is_persistent: boolean;
  resize_keyboard: boolean;
}
export interface ForceReply {
  force_reply: true;
  input_field_placeholder?: string;
}
export type Markup = InlineMarkup | ReplyKeyboard | ForceReply;

function base(): string {
  return (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function tg<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError(method, "TELEGRAM_BOT_TOKEN is not set");
  let res: Response;
  try {
    res = await fetch(`${base()}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Do not surface the underlying error: it can contain the request URL, which contains the token.
    throw new TelegramError(method, "network error");
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
  if (!json?.ok) throw new TelegramError(method, json?.description ?? `HTTP ${res.status}`, json?.error_code);
  return json.result as T;
}

export async function sendMessage(chatId: number, text: string, markup?: Markup): Promise<number> {
  const r = await tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {}),
  });
  return r.message_id;
}

export async function editMessage(chatId: number, messageId: number, text: string, markup?: InlineMarkup): Promise<void> {
  try {
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: markup ?? { inline_keyboard: [] },
    });
  } catch (e) {
    if (e instanceof TelegramError && /not modified/i.test(e.message)) return; // a repeated tap: nothing to change
    throw e;
  }
}

export async function editMarkup(chatId: number, messageId: number, markup: InlineMarkup): Promise<void> {
  try {
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup });
  } catch (e) {
    if (e instanceof TelegramError && /not modified/i.test(e.message)) return;
    throw e;
  }
}

/** Must be called for every button tap, otherwise Telegram keeps showing a loading spinner. */
export async function answerCallback(id: string, text?: string): Promise<void> {
  try {
    await tg("answerCallbackQuery", { callback_query_id: id, ...(text ? { text, show_alert: false } : {}) });
  } catch {
    /* an expired query id is not worth failing the request for */
  }
}

/** Downloads a file (e.g. a voice note) that was sent to the bot. The file URL contains the token, so it never leaves the server. */
export async function downloadFile(fileId: string): Promise<{ data: Uint8Array; contentType: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError("getFile", "TELEGRAM_BOT_TOKEN is not set");
  const info = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info.file_path) throw new TelegramError("getFile", "no file_path returned");
  let res: Response;
  try {
    res = await fetch(`${base()}/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new TelegramError("getFile", "network error");
  }
  if (!res.ok) throw new TelegramError("getFile", `download failed (HTTP ${res.status})`);
  const ext = info.file_path.split(".").pop()?.toLowerCase();
  const type = ext === "oga" || ext === "ogg" ? "audio/ogg" : ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : (res.headers.get("content-type") ?? "audio/ogg");
  return { data: new Uint8Array(await res.arrayBuffer()), contentType: type };
}

export async function setWebhook(url: string, secret: string): Promise<void> {
  await tg("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
