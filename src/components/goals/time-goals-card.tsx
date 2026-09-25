import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtDuration } from "@/lib/time";
import type { TimeGoalReport, TimeGoalStatus } from "@/lib/services/time-goals";

const STATUS: Record<TimeGoalStatus, { label: string; tone: string }> = {
  done: { label: "Goal met", tone: "bg-good-muted text-good" },
  on_track: { label: "On track", tone: "bg-accent-muted text-accent" },
  behind: { label: "Behind", tone: "bg-warn-muted text-warn" },
  not_started: { label: "Not started", tone: "bg-muted text-subtle" },
};

/**
 * Planned vs actual hours per project for a range, with a marker where an even pace would be by now.
 * Server-renderable (no hooks), used on Goals and Review.
 */
export function TimeGoalsCard({ report, title = "Time goals", emptyHint = true }: { report: TimeGoalReport; title?: string; emptyHint?: boolean }) {
  const total = report.goalMin + report.otherMin;
  const share = total > 0 ? Math.round((report.goalMin / total) * 100) : null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {share !== null && report.goals.length ? (
          <span className="text-xs text-subtle">
            <strong className="tabular text-fg">{share}%</strong> of logged time went to your goals
          </span>
        ) : null}
      </div>

      {report.goals.length === 0 ? (
        emptyHint ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
            <p className="text-sm font-medium">Decide where your hours should go</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-subtle">
              Give a project a weekly hours budget and see here, every day, whether your time matches what matters.
            </p>
            <Link href="/projects" className="mt-3 inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90">
              Set a time goal
            </Link>
          </div>
        ) : null
      ) : (
        <ul className="space-y-3.5">
          {report.goals.map((g) => {
            const pct = g.targetMin > 0 ? Math.min(1, g.actualMin / g.targetMin) : 0;
            const pace = Math.min(1, report.elapsed);
            const s = STATUS[g.status];
            return (
              <li key={g.projectId}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                  <span className="tabular shrink-0 text-xs text-subtle">
                    <strong className="text-fg">{fmtDuration(g.actualMin)}</strong> / {fmtDuration(g.targetMin)}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", s.tone)}>{s.label}</span>
                </div>
                <div
                  className="relative h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${g.name}: ${fmtDuration(g.actualMin)} of ${fmtDuration(g.targetMin)}`}
                  aria-valuenow={Math.round(pct * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: g.color }} />
                  {pace > 0 && pace < 1 ? (
                    <div className="absolute top-0 h-full w-0.5 bg-fg/50" style={{ left: `${pace * 100}%` }} title="Where an even pace would be by now" />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {report.otherByProject.length ? (
        <p className="mt-3 border-t border-border pt-3 text-xs text-subtle">
          Other time: <strong className="text-fg">{fmtDuration(report.otherMin)}</strong>
          {" · "}
          {report.otherByProject.slice(0, 4).map((o) => `${o.name} ${fmtDuration(o.minutes)}`).join(", ")}
          {report.otherByProject.length > 4 ? "…" : ""}
        </p>
      ) : null}
    </div>
  );
}
