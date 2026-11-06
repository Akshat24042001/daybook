/** Telegram pushes for Sales, and the rare emergency phone call (OmniDimension free tier). */
import { one, q } from "../db";
import { buildCtx, getSettings } from "../settings";
import { inQuietHours } from "../telegram/notify";
import { sendMessage, telegramConfigured, type InlineMarkup } from "../telegram/api";
import { salesConfig } from "./config";

export async function ownerChat(): Promise<number | null> {
  const env = Number((process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim());
  if (Number.isFinite(env) && env !== 0) return env;
  return (await getSettings()).telegram_chat_id ?? null;
}

/** Sends to the owner; never throws (a failed push must not break the work that triggered it). */
export async function push(text: string, markup?: InlineMarkup): Promise<number | null> {
  if (!telegramConfigured()) return null;
  const chat = await ownerChat();
  if (!chat) return null;
  try {
    return await sendMessage(chat, text, markup);
  } catch (e) {
    console.warn("[sales-push] failed:", (e as Error).message);
    return null;
  }
}

export function callConfigured(): boolean {
  return !!(process.env.OMNIDIM_API_KEY && process.env.OMNIDIM_AGENT_ID && process.env.OWNER_PHONE);
}

/**
 * Calls the owner's phone, only for emergencies, at most cfg.escalation.max_per_day times a day,
 * never twice for the same thing, and never in Daybook's quiet hours.
 */
export async function escalate(reason: string, ref: string, message: string): Promise<string> {
  const cfg = await salesConfig();
  if (!cfg.escalation.enabled || !cfg.escalation.on.includes(reason)) return "off";
  if (!callConfigured()) return "not-configured";
  const quiet = inQuietHours(buildCtx(await getSettings(), new Date()));
  if (quiet) return "quiet-hours";
  const dup = await one("select 1 from sales_calls where ref = $1", [ref]);
  if (dup) return "already-called";
  const today = await one<{ n: number }>("select count(*)::int as n from sales_calls where created_at > now() - interval '24 hours' and status = 'dispatched'");
  if ((today?.n ?? 0) >= cfg.escalation.max_per_day) return "daily-cap";
  try {
    const res = await fetch(`${(process.env.OMNIDIM_API_BASE ?? "https://backend.omnidim.io/api/v1").replace(/\/+$/, "")}/calls/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OMNIDIM_API_KEY}` },
      body: JSON.stringify({
        agent_id: Number(process.env.OMNIDIM_AGENT_ID) || process.env.OMNIDIM_AGENT_ID,
        to_number: process.env.OWNER_PHONE,
        call_context: { reason, message, owner_name: cfg.owner.name.split(" ")[0] },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    await q("insert into sales_calls (reason, ref, status, detail) values ($1,$2,$3,$4)", [reason, ref, res.ok ? "dispatched" : "failed", body.slice(0, 500)]);
    return res.ok ? "dispatched" : `failed ${res.status}`;
  } catch (e) {
    await q("insert into sales_calls (reason, ref, status, detail) values ($1,$2,'failed',$3)", [reason, ref, (e as Error).message]);
    return "failed";
  }
}
