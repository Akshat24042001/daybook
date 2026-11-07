/**
 * The Sales heartbeat, called from the minute tick in the background: runs queued jobs, refreshes moves, crawls the
 * radar, sends pre-call briefs and post-call debrief prompts, the morning brief, the radar digest and the Sunday review.
 */
import { one, q } from "../db";
import { buildCtx, getSettings } from "../settings";
import { calendarDate, isoDow, zonedParts } from "../time";
import { esc, sendMessage } from "../telegram/api";
import { inQuietHours } from "../telegram/notify";
import { salesConfig, salesRow } from "./config";
import { currentFocus } from "./focus";
import { dealContext } from "./context";
import { auditCompany } from "./enrich";
import { processCapture } from "./ingest";
import { enqueue, runJobs, type Handler } from "./jobs";
import { baseUrl } from "./links";
import { llm } from "./llm";
import { draftForMove, refreshMoves } from "./moves";
import { ownerChat, push } from "./notify";
import { reportHunt, runHunt, scheduleHunts } from "./hunts";
import { personStage, researchRadarItem, searchStage, siteStage, startResearch, synthStage } from "./research";
import { dailyDigest, hunt, qualifyPending, runRadar } from "./radar";
import { weeklyReview, reviewMessage, reviewInsights } from "./review";
import { syncObjections } from "./objections";
import { draftProof, queueProofs } from "./proofs";
import { movesMessage, processAndReport, report } from "./telegram";

export const HANDLERS: Record<string, Handler> = {
  async process_capture(p) {
    const id = Number(p.id);
    const cap = await one<{ tg_chat: number | null; source: string; status: string }>("select tg_chat, source, status from sales_captures where id = $1", [id]);
    if (!cap || (cap.status !== "pending" && cap.status !== "failed")) return;
    if (cap.tg_chat || p.notify) {
      await processAndReport(id);
      return;
    }
    const r = await processCapture(id);
    // a new lead found in your email: tell you, with a one-tap "not a lead"
    if (r.created_deal && (cap.source === "email" || cap.source === "meet")) await report(id, r, null, null);
    if (r.candidates?.length) await report(id, r, null, null);
  },
  async refresh_moves(p) {
    await refreshMoves(p.deal_id ? Number(p.deal_id) : undefined);
  },
  async sync_objections() {
    await syncObjections();
  },
  async draft_proof(p) {
    await draftProof(Number(p.deal_id));
  },
  // the old "enrich" jobs now start the deep, staged research (live log, sources, people, contacts)
  async enrich_company(p) {
    await startResearch({ subject: "company", id: Number(p.id), trigger: "auto" });
  },
  async enrich_person(p) {
    await startResearch({ subject: "person", id: Number(p.id), trigger: "auto" });
  },
  async research_company(p) {
    await siteStage(Number(p.runId));
  },
  async research_search(p) {
    await searchStage(Number(p.runId));
  },
  async research_synth(p) {
    await synthStage(Number(p.runId));
  },
  async research_person(p) {
    await personStage(Number(p.runId));
  },
  async radar_research(p) {
    await researchRadarItem(Number(p.id), {}, "auto");
  },
  async audit_website(p) {
    await auditCompany(Number(p.id));
  },
  async radar_run() {
    await runRadar(35_000);
  },
  async radar_qualify() {
    const n = await qualifyPending(40_000);
    const left = await one("select 1 from sales_radar_items where status = 'new' and score is null limit 1");
    if (left && n > 0) await enqueue("radar_qualify", {}, { dedupeKey: "radar_qualify_more", runAfter: new Date(Date.now() + 60_000) });
  },
  async radar_hunt() {
    await hunt(40_000);
    await enqueue("radar_qualify", {}, { dedupeKey: "radar_qualify" });
  },
  async hunt_run(p) {
    await runHunt(Number(p.id), String(p.trigger ?? "schedule"), 45_000);
  },
  async hunt_report(p) {
    await reportHunt(Number(p.runId));
  },
  async radar_digest() {
    await dailyDigest(50_000);
  },
  async draft_move(p) {
    await draftForMove(Number(p.id));
  },
};

async function lastDone(kind: string): Promise<number> {
  const r = await one<{ t: string | null }>("select max(coalesce(done_at, created_at)) as t from sales_jobs where kind = $1 and status in ('done','queued','running')", [kind]);
  return r?.t ? new Date(r.t).getTime() : 0;
}

async function preCallBriefs(): Promise<void> {
  const meets = await q<{ id: number; deal_id: number | null; title: string; starts_at: string; link: string | null }>(
    `select id, deal_id, title, starts_at, link from sales_meetings where not cancelled and brief_sent_at is null
     and starts_at between now() and now() + interval '20 minutes' order by starts_at limit 3`,
  );
  for (const m of meets) {
    await q("update sales_meetings set brief_sent_at = now() where id = $1", [m.id]);
    if (!m.deal_id) continue;
    const ctx = await dealContext(m.deal_id, { interactions: 10 });
    let brief = "";
    try {
      brief = (await llm([
        { role: "system", content: "You prepare a founder for a sales call in 30 seconds of reading. Plain text, short lines, no dashes as punctuation. Sections: Goal of this call (1 line). What they said last (2 lines). Open promises. Likely objection and how to handle it. 3 questions to ask. The one thing to close on." },
        { role: "user", content: ctx },
      ], { maxTokens: 600, totalMs: 25_000 })).text;
    } catch {
      brief = ctx.slice(0, 1500);
    }
    const mins = Math.max(1, Math.round((new Date(m.starts_at).getTime() - Date.now()) / 60_000));
    await push(`📞 <b>${esc(m.title)}</b> in ${mins} min\n\n${esc(brief.slice(0, 3200))}`, {
      inline_keyboard: [[...(m.link?.startsWith("https://") ? [{ text: "Join", url: m.link }] : []), { text: "Open deal", url: `${baseUrl()}/sales/deal/${m.deal_id}` }]],
    });
  }
}

async function debriefPrompts(): Promise<void> {
  const meets = await q<{ id: number; deal_id: number; title: string }>(
    `select m.id, m.deal_id, m.title from sales_meetings m where not m.cancelled and m.deal_id is not null and m.debrief_sent_at is null
       and m.ends_at between now() - interval '60 minutes' and now() - interval '3 minutes'
       and not exists (select 1 from sales_interactions i where i.deal_id = m.deal_id and i.created_at > m.starts_at and i.channel in ('meeting','call','in_person','note'))
     limit 3`,
  );
  const chat = await ownerChat();
  if (!chat) return;
  for (const m of meets) {
    await q("update sales_meetings set debrief_sent_at = now() where id = $1", [m.id]);
    const mid = await sendMessage(chat, `🎙 How did <b>${esc(m.title)}</b> go?\nReply to this message with a 30-second voice note: what they want, budget, timeline, who decides, what each of you promised.`, {
      force_reply: true, input_field_placeholder: "Voice note or text",
    }).catch(() => null);
    if (mid) await q("insert into sales_tg_prompts (message_id, kind, deal_id, meeting_id) values ($1,'debrief',$2,$3) on conflict do nothing", [mid, m.deal_id, m.id]);
  }
}

async function morningBrief(): Promise<void> {
  await refreshMoves();
  const cfg = await salesConfig();
  if (cfg.autonomy.prewrite !== "suggest") {
    // drafts are ready by the time you open the list
    const top = await q<{ id: number }>("select id from sales_moves where status = 'open' and draft is null and due_at <= now() + interval '12 hours' order by score desc limit 5");
    for (const m of top) await enqueue("draft_move", { id: m.id }, { dedupeKey: `draft_move:${m.id}` });
  }
  const focus = await currentFocus(cfg);
  const stats = await one<{ replies: number; due: number; meetings: number; cash: number | null; hot: number }>(
    `select (select count(*)::int from sales_moves where status = 'open' and kind = 'reply') as replies,
            (select count(*)::int from sales_moves where status = 'open' and due_at <= now() + interval '12 hours') as due,
            (select count(*)::int from sales_meetings where not cancelled and starts_at::date = current_date) as meetings,
            (select sum(amount) from sales_payments where status = 'due' and due_on <= current_date) as cash,
            (select count(*)::int from sales_deals where heat >= 70) as hot`,
  );
  const m = await movesMessage(8);
  await push(
    `☀️ <b>Sales today</b>\n${stats?.due ?? 0} moves · ${stats?.replies ?? 0} replies waiting · ${stats?.meetings ?? 0} meetings · ${stats?.hot ?? 0} hot deals${stats?.cash ? ` · cash due ${Math.round(Number(stats.cash)).toLocaleString("en-IN")}` : ""}\nFocus this week: <b>${esc(focus.country)}</b>, today: <b>${esc(focus.industry)}</b>\n\n${m.text.replace(/^⚡ <b>Moves<\/b>\n\n/, "")}`,
    m.markup,
  );
}

/** Called from the minute tick, after the reply, in the background. */
export async function runSalesTick(now: Date = new Date()): Promise<string> {
  const started = Date.now();
  const s = await getSettings();
  const ctx = buildCtx(s, now);
  const cfg = await salesConfig();
  const row = await salesRow();
  const local = zonedParts(now, ctx.tz);
  const today = ctx.today;

  // schedules (each guarded so it runs once)
  if (Date.now() - (await lastDone("refresh_moves")) > 10 * 60_000) await enqueue("refresh_moves", {}, { dedupeKey: "refresh_moves:all" });
  if (Date.now() - (await lastDone("radar_run")) > 15 * 60_000) await enqueue("radar_run", {}, { dedupeKey: "radar_run" });
  await scheduleHunts(now).catch((e) => console.warn("[sales] hunts:", (e as Error).message));
  // anything captured but never queued (a crash mid-request)
  await q(
    `insert into sales_jobs (kind, payload, dedupe_key) select 'process_capture', jsonb_build_object('id', c.id), 'capture:' || c.id
     from sales_captures c where c.status = 'pending' and c.created_at < now() - interval '4 minutes' and c.created_at > now() - interval '2 days'
     on conflict (dedupe_key) do nothing`,
  );

  const quiet = inQuietHours(ctx);
  if (!quiet) {
    await preCallBriefs().catch((e) => console.warn("[sales] briefs:", (e as Error).message));
    await debriefPrompts().catch((e) => console.warn("[sales] debrief:", (e as Error).message));
  }
  if (!quiet && local.h >= cfg.brief_hour && row.last_brief_on !== today && local.h < cfg.brief_hour + 3) {
    await q("update sales_settings set last_brief_on = $1 where id = 1", [today]);
    await morningBrief().catch((e) => console.warn("[sales] morning brief:", (e as Error).message));
  }
  if (!quiet && local.h >= cfg.radar.digest_hour && row.last_radar_digest_on !== today && local.h < cfg.radar.digest_hour + 6) {
    await q("update sales_settings set last_radar_digest_on = $1 where id = 1", [today]);
    await enqueue("radar_digest", {}, { dedupeKey: `radar_digest:${today}` });
  }
  // once a day: group new objections into the library, and draft case studies for newly paid deals
  // (a finished job releases its dedupe key, so "once a day" is checked against when it last ran)
  if (Date.now() - (await lastDone("sync_objections")) > 20 * 3_600_000) await enqueue("sync_objections", {}, { dedupeKey: `sync_objections:${today}` });
  if (Date.now() - (await lastDone("draft_proof")) > 20 * 3_600_000) await queueProofs().catch(() => {});
  const dow = isoDow(calendarDate(now, ctx.tz)); // 1 = Monday
  if (!quiet && dow === cfg.review_dow && local.h >= cfg.review_hour && row.last_review_on !== today) {
    await q("update sales_settings set last_review_on = $1 where id = 1", [today]);
    const r = await weeklyReview();
    const extra = await reviewInsights().catch(() => "");
    await push(reviewMessage(r) + extra, { inline_keyboard: [[{ text: "Open review", url: `${baseUrl()}/sales/review` }, { text: "Insights", url: `${baseUrl()}/sales/insights` }]] });
  }

  const left = 52_000 - (Date.now() - started);
  const jobs = left > 8_000 ? await runJobs(HANDLERS, left) : { ran: 0, failed: 0 };
  return `jobs ${jobs.ran} ok, ${jobs.failed} failed`;
}
