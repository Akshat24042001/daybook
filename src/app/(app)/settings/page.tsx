import type { Metadata } from "next";
import { SettingsClient } from "@/components/settings/settings-client";
import { q } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import { fmtDateShort, fmtHM } from "@/lib/time";
import { listExerciseTypes } from "@/lib/services/health";
import { telegramConfigured } from "@/lib/telegram/api";
import { deepgramReady } from "@/lib/voice-config";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await makeCtx();
  const [people, types] = await Promise.all([
    q<{ id: number; name: string; relation: string | null }>("select id, name, relation from people order by lower(name)"),
    listExerciseTypes(false),
  ]);
  const s = ctx.s;
  const envOwner = (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim();
  const last = s.last_tick_at;
  return (
    <SettingsClient
      settings={{
        timezone: s.timezone,
        day_boundary: s.day_boundary,
        working_days: s.working_days,
        morning_brief: s.morning_brief,
        exercise_start: s.exercise_start,
        exercise_end: s.exercise_end,
        exercise_interval_min: s.exercise_interval_min,
        exercise_paused: s.exercise_paused,
        task_lead_min: s.task_lead_min,
        cadence_nudge: s.cadence_nudge,
        evening_fallback: s.evening_fallback,
        score_reminder: s.score_reminder,
        open_segment_check: s.open_segment_check,
        weekly_review_day: s.weekly_review_day,
        weekly_review_time: s.weekly_review_time,
        must_do_cap: s.must_do_cap,
        available_hours: s.available_hours,
        rot_threshold: s.rot_threshold,
        step_goal: s.step_goal,
        quiet_start: s.quiet_start,
        quiet_end: s.quiet_end,
      }}
      people={people}
      types={types.map((t) => ({ id: t.id, name: t.name, defaultAmount: t.default_amount, unit: t.unit, active: t.active }))}
      status={{
        telegramToken: telegramConfigured(),
        telegramLinked: !!(envOwner || s.telegram_chat_id),
        ownerFromEnv: !!envOwner,
        voice: deepgramReady(),
        auth: "Password",
        lastTick: last ? `${fmtDateShort(ctx.today)} ${fmtHM(last, ctx.tz)}` : null,
        lastTickAgeSec: last ? Math.round((Date.now() - last.getTime()) / 1000) : null,
        appUrl: process.env.APP_BASE_URL ?? "",
        https: /^https:\/\//i.test(process.env.APP_BASE_URL ?? ""),
      }}
    />
  );
}
