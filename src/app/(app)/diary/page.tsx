import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DiaryPanel } from "@/components/diary/diary-panel";
import { ratingTone } from "@/lib/rating-tone";
import { aiConfigured } from "@/lib/ai";
import { cn } from "@/lib/cn";
import { voiceConfigured } from "@/lib/deepgram";
import { makeCtx } from "@/lib/settings";
import { addDays, fmtDateLong, fmtDateShort, fmtHM, weekdayName, type DateStr } from "@/lib/time";
import {
  entryCountsInRange, getSummary, listEntries, summariesInRange, toSummaryView,
} from "@/lib/services/diary";

export const metadata: Metadata = { title: "Diary" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DiaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await makeCtx();
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const date: DateStr = raw && DATE.test(raw) && raw <= ctx.today ? raw : ctx.today;
  const from = addDays(ctx.today, -20);

  const [entries, summary, recent, counts] = await Promise.all([
    listEntries(date),
    getSummary(date),
    summariesInRange(from, ctx.today),
    entryCountsInRange(from, ctx.today),
  ]);
  const byDate = new Map(recent.map((s) => [s.date, s]));
  const days: DateStr[] = Array.from({ length: 21 }, (_, i) => addDays(ctx.today, -i));
  const isToday = date === ctx.today;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Diary</p>
          <h1 className="font-display text-2xl">{isToday ? "Today" : fmtDateLong(date)}</h1>
          {isToday ? <p className="text-sm text-subtle">{fmtDateLong(date)}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/diary?date=${addDays(date, -1)}`}
            aria-label="Previous day"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:bg-muted hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {!isToday ? (
            <Link href="/diary" className="flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-muted">
              Today
            </Link>
          ) : null}
          <Link
            href={isToday ? "/diary" : `/diary?date=${addDays(date, 1)}`}
            aria-label="Next day"
            aria-disabled={isToday}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:bg-muted hover:text-fg",
              isToday && "pointer-events-none opacity-40",
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* 3-week strip: every day, its AI rating, and whether notes exist */}
      <div>
        <ol className="grid grid-cols-7 gap-1 md:grid-cols-[repeat(21,minmax(0,1fr))] md:gap-1.5">
          {days.slice().reverse().map((d, i) => {
            const s = byDate.get(d);
            const n = counts.get(d) ?? 0;
            const active = d === date;
            return (
              <li key={d} className={i < 14 ? "hidden md:block" : undefined}>
                <Link
                  href={d === ctx.today ? "/diary" : `/diary?date=${d}`}
                  title={s ? `${fmtDateShort(d)}: ${s.headline}` : fmtDateShort(d)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border py-1.5 transition-colors",
                    active ? "border-accent bg-accent-muted" : "border-transparent hover:bg-muted",
                  )}
                >
                  <span className="text-[10px] font-medium uppercase text-subtle">{weekdayName(d).slice(0, 2)}</span>
                  <span className={cn("tabular text-sm font-semibold", active && "text-accent")}>{Number(d.slice(8))}</span>
                  <span
                    className={cn("tabular flex h-5 min-w-[1.5rem] items-center justify-center rounded-md px-1 text-[10px] font-bold", s ? ratingTone(s.rating) : n ? "bg-muted text-subtle" : "")}
                  >
                    {s ? s.rating ?? "·" : n ? `${n}✎` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      <DiaryPanel
        key={date}
        date={date}
        isToday={isToday}
        entries={entries.map((e) => ({ id: e.id, body: e.body, source: e.source, timeLabel: fmtHM(e.created_at, ctx.tz) }))}
        summary={summary ? toSummaryView(summary) : null}
        voiceEnabled={voiceConfigured()}
        aiEnabled={aiConfigured()}
      />
    </div>
  );
}
