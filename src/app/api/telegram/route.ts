import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { handleUpdate, type TgUpdate } from "@/lib/telegram/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Telegram webhook. Rejects any request whose secret header does not match, then hands the update to the
 * bot (which applies the owner lock). Always answers 200 for valid requests: failures are logged without
 * secrets, and a non-200 would only make Telegram re-deliver the same update.
 */
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), expected)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }
  try {
    await handleUpdate(update);
  } catch (e) {
    console.error("[telegram] update failed:", (e as Error).name, (e as Error).message);
  }
  return NextResponse.json({ ok: true });
}
