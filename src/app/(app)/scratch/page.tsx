import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScratchPanel } from "@/components/scratch/scratch-panel";
import { cn } from "@/lib/cn";
import { logicalDate, addDays, fmtDateLong, fmtDay, fmtHM, weekdayName, type DateStr } from "@/lib/time";
import { makeCtx } from "@/lib/settings";
import { normalizeData, SCRATCH_KINDS, type ScratchKind } from "@/lib/scratch";
import { itemCountsInRange, listItems, mediaUrls, sweepAbandonedUploads } from "@/lib/services/scratch";
import { storageConfigured } from "@/lib/storage";
import { voiceConfigured } from "@/lib/deepgram";

export const metadata: Metadata = { title: "Scratchpad" };
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isTodayView = (date: DateStr, today: DateStr) => date === today;

export default async function ScratchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await makeCtx();
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const date: DateStr = raw && DATE.test(raw) && raw <= ctx.today ? raw : ctx.today;
  const from = addDays(ctx.today, -20);
  const autoAdd = SCRATCH_KINDS.find((k) => k === sp.new) ?? null;

  const [rows, counts] = await Promise.all([listItems(date), itemCountsInRange(from, ctx.today)]);
  // short-lived links for this day's photos, files and voice memos (one storage call)
  const urls = await mediaUrls(rows);
  // uploads abandoned mid-way (tab closed) are cleaned up in passing
  if (isTodayView(date, ctx.today)) void sweepAbandonedUploads().catch(() => undefined);
  const days: DateStr[] = Array.from({ length: 21 }, (_, i) => addDays(ctx.today, -i));
  const isToday = date === ctx.today;
  const stamp = (d: Date) => {
    const day = logicalDate(d, ctx.tz, ctx.boundaryMin);
    return day === date ? fmtHM(d, ctx.tz) : `${fmtDay(day)} ${fmtHM(d, ctx.tz)}`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Scratchpad</p>
          <h1 className="font-display text-2xl">{isToday ? "Today" : fmtDateLong(date)}</h1>
          {isToday ? <p className="text-sm text-subtle">{fmtDateLong(date)}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/scratch?date=${addDays(date, -1)}`}
            aria-label="Previous day"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:bg-muted hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {!isToday ? (
            <Link href="/scratch" className="flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-muted">
              Today
            </Link>
          ) : null}
          <Link
            href={isToday ? "/scratch" : `/scratch?date=${addDays(date, 1)}`}
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

      {/* 3-week strip: which days have scratch work, and how much */}
      <ol className="grid grid-cols-7 gap-1 md:grid-cols-[repeat(21,minmax(0,1fr))] md:gap-1.5">
        {days.slice().reverse().map((d, i) => {
          const c = counts.get(d);
          const n = c ? c.note + c.sketch + c.calc + c.graph : 0;
          const active = d === date;
          const title = c
            ? `${fmtDay(d)}: ${[
              c.note && `${c.note} note${c.note > 1 ? "s" : ""}`,
              c.sketch && `${c.sketch} sketch${c.sketch > 1 ? "es" : ""}`,
              c.calc && `${c.calc} calc${c.calc > 1 ? "s" : ""}`,
              c.graph && `${c.graph} graph${c.graph > 1 ? "s" : ""}`,
            ].filter(Boolean).join(", ")}`
            : fmtDay(d);
          return (
            <li key={d} className={i < 14 ? "hidden md:block" : undefined}>
              <Link
                href={d === ctx.today ? "/scratch" : `/scratch?date=${d}`}
                title={title}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border py-1.5 transition-colors",
                  active ? "border-accent bg-accent-muted" : "border-transparent hover:bg-muted",
                )}
              >
                <span className="text-[10px] font-medium uppercase text-subtle">{weekdayName(d).slice(0, 2)}</span>
                <span className={cn("tabular text-sm font-semibold", active && "text-accent")}>{Number(d.slice(8))}</span>
                <span className={cn("tabular flex h-5 min-w-[1.5rem] items-center justify-center rounded-md px-1 text-[10px] font-bold", n ? "bg-accent/15 text-accent" : "")}>
                  {n || ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <ScratchPanel
        key={date}
        date={date}
        isToday={isToday}
        autoAdd={autoAdd as ScratchKind | null}
        items={rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          data: normalizeData(r.kind, r.data)!,
          timeLabel: stamp(r.created_at),
          updatedLabel: stamp(r.updated_at),
          mediaUrl: urls.get(r.id) ?? null,
        }))}
        storageEnabled={storageConfigured()}
        voiceEnabled={voiceConfigured()}
      />
    </div>
  );
}
