import type { Metadata } from "next";
import { TodayView } from "@/components/today/today-view";
import { SECTION_ORDER, sectionize, type SectionKey } from "@/lib/sections";
import { voiceConfigured } from "@/lib/deepgram";
import { makeCtx } from "@/lib/settings";
import { fmtDateLong, fmtHM } from "@/lib/time";
import { getDay } from "@/lib/services/days";
import { entriesForDate } from "@/lib/services/entries";
import { currentState, segmentsForDate, workedForDate } from "@/lib/services/segments";
import { toLocalInput, toRow, type RowData, type SegmentData } from "@/lib/view-types";
import { listTargets } from "@/lib/services/goals";
import { q } from "@/lib/db";
import { aiConfigured } from "@/lib/ai";
import { DiaryPanel } from "@/components/diary/diary-panel";
import { SleepCard } from "@/components/today/sleep-card";
import { IntentionsMini } from "@/components/today/intentions-mini";
import { ReachOut } from "@/components/contacts/keep-in-touch";
import { touchStates } from "@/lib/services/keep-in-touch";
import { getReview, periodBounds } from "@/lib/services/review";
import { getSummary, listEntries, toSummaryView } from "@/lib/services/diary";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function TodayPage() {
  const ctx = await makeCtx();
  const [entries, state, worked, day, segs, allTargets, projects, diaryEntries, diarySummary] = await Promise.all([
    entriesForDate(ctx.today),
    currentState(),
    workedForDate(ctx, ctx.today),
    getDay(ctx.today),
    segmentsForDate(ctx, ctx.today),
    listTargets(ctx),
    q<{ id: number; name: string }>("select id, name from projects where archived = false order by lower(name)"),
    listEntries(ctx.today).catch(() => []),
    getSummary(ctx.today).catch(() => null),
  ]);
  const weekStart = periodBounds("week", ctx.today).start;
  const [weekReview, touch] = await Promise.all([
    getReview("week", weekStart).catch(() => null),
    touchStates(ctx.today, ctx.tz).catch(() => []),
  ]);

  const activeTargets = [...allTargets.week, ...allTargets.month, ...allTargets.quarter, ...allTargets.year]
    .filter((t) => t.task.state === "active")
    .map((t) => ({ id: t.task.id, title: t.task.title, met: t.met, behind: t.behind, hasGoal: t.hasGoal, period: t.task.target_period as string }));
  const sec = sectionize(entries, ctx.tz, ctx.boundaryMin);
  const sections = Object.fromEntries(SECTION_ORDER.map((k) => [k, sec[k].map((e) => toRow(ctx, e))])) as Record<SectionKey, RowData[]>;

  const segments: SegmentData[] = segs.map((s) => ({
    id: s.id,
    kind: s.kind,
    start: toLocalInput(ctx, s.start_at),
    end: s.end_at ? toLocalInput(ctx, s.end_at) : null,
    startLabel: fmtHM(s.start_at, ctx.tz),
    endLabel: s.end_at ? fmtHM(s.end_at, ctx.tz) : null,
    minutes: s.end_at ? Math.round((s.end_at.getTime() - s.start_at.getTime()) / 60000) : null,
  }));

  return (
    <div className="mx-auto max-w-6xl">
    <TodayView
      date={ctx.today}
      dateLabel={fmtDateLong(ctx.today)}
      sections={sections}
      state={{ kind: state.kind, sinceLabel: state.since ? fmtHM(state.since, ctx.tz) : null }}
      workedAtLoad={day?.worked_minutes_override ?? worked}
      workedOverride={day?.worked_minutes_override ?? null}
      score={day?.score ?? null}
      steps={day?.steps ?? null}
      stepGoal={ctx.s.step_goal}
      mustCap={ctx.s.must_do_cap}
      segments={segments}
      newSegmentDefault={toLocalInput(ctx, ctx.now)}
      voiceEnabled={voiceConfigured()}
      targets={activeTargets}
      projects={projects}
      asideTop={
        <>
          <SleepCard date={ctx.today} minutes={day?.sleep_minutes ?? null} quality={day?.sleep_quality ?? null} />
          <IntentionsMini weekStart={weekStart} items={weekReview?.intentions ?? []} />
          <ReachOut due={touch.filter((t) => t.due)} limit={2} title="Reach out today" compact />
        </>
      }
      aside={
        <>
        <DiaryPanel
          compact
          date={ctx.today}
          entries={diaryEntries.map((e) => ({ id: e.id, body: e.body, source: e.source, timeLabel: fmtHM(e.created_at, ctx.tz) }))}
          summary={diarySummary ? toSummaryView(diarySummary) : null}
          voiceEnabled={voiceConfigured()}
          aiEnabled={aiConfigured()}
        />
        </>
      }
    />
    </div>
  );
}
