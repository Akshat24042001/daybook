"use server";
// News page actions: write or send an edition now, read the news now, sources and settings.
import { revalidatePath } from "next/cache";
import { one, q, UserError } from "@/lib/db";
import { journaled } from "@/lib/undo";
import { getSettings } from "@/lib/settings";
import { calendarDate } from "@/lib/time";

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object = object>(fn: () => Promise<T | void>): Promise<Result<T>> {
  try {
    const out = (await journaled("web", async () => (await fn()) ?? ({} as T))).value;
    revalidatePath("/news");
    return { ok: true, ...(out as T) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[news] action failed:", (e as Error).message);
    return { ok: false, error: "That did not work. Try again." };
  }
}

/** Reads every source now and scores what is new. */
export async function readNewsNowAction() {
  return run<{ read: number; added: number; scored: number }>(async () => {
    const { collectNews, scoreNews } = await import("@/lib/news/collect");
    const r = await collectNews(25_000, { force: true });
    const scored = await scoreNews(25_000);
    return { ...r, scored };
  });
}

/** Writes today's (or a given day's) newsletter now from the latest news. */
export async function writeEditionNowAction(date?: string) {
  return run<{ date: string | null }>(async () => {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : calendarDate(new Date(), (await getSettings()).timezone);
    const { writeEdition } = await import("@/lib/news/edition");
    const e = await writeEdition(day, { budgetMs: 55_000, fresh: true });
    if (!e) throw new UserError("Nothing worth a newsletter yet: no story scored 50 or more since the last one. Read the news now, then try again.");
    return { date: e.date };
  });
}

export async function sendEditionAction(date: string) {
  return run(async () => {
    const { sendEdition } = await import("@/lib/news/edition");
    if (!(await sendEdition(date))) throw new UserError("Could not send it: Telegram is not connected, or sending to Telegram is off in News settings.");
  });
}

export async function saveNewsSettingsAction(s: { enabled: boolean; send_hour: number; telegram: boolean; pdf: boolean; extra_interests: string }) {
  return run(async () => {
    const hour = Math.max(0, Math.min(23, Math.round(Number(s.send_hour) || 8)));
    await q("update news_settings set enabled = $1, send_hour = $2, telegram = $3, pdf = $4, extra_interests = $5, updated_at = now() where id = 1",
      [!!s.enabled, hour, !!s.telegram, !!s.pdf, String(s.extra_interests ?? "").slice(0, 2000)]);
  });
}

/** Adds your own source: a Google News search (words) or a feed (a URL). */
export async function addNewsSourceAction(value: string, topic: string) {
  return run(async () => {
    const v = value.trim();
    if (v.length < 3) throw new UserError("Type a search (like \"Nvidia earnings\") or paste a feed URL.");
    const url = /^https?:\/\//i.test(v);
    const key = `${url ? "my_rss" : "my_gn"}_${Date.now().toString(36)}`;
    await q("insert into news_sources (key, name, kind, config, topic, custom) values ($1,$2,$3,$4,$5,true)",
      [key, url ? v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60) : `Search: ${v.slice(0, 60)}`, url ? "rss" : "gnews", JSON.stringify(url ? { url: v } : { q: `${v} when:2d`, ed: "US" }), topic || "other"]);
  });
}

export async function toggleNewsSourceAction(id: number, enabled: boolean) {
  return run(async () => { await q("update news_sources set enabled = $2 where id = $1", [id, enabled]); });
}

export async function starNewsAction(id: number, starred: boolean) {
  return run(async () => {
    if (!(await one("select 1 from news_items where id = $1", [id]))) throw new UserError("That story is gone.");
    await q("update news_items set starred = $2 where id = $1", [id, starred]);
  });
}
