import { Briefcase, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { OutreachToday } from "@/lib/sales/activity";

/** Today's outreach against your daily goal, with what is waiting in Sales. */
export function SalesOutreachCard({ o }: { o: OutreachToday }) {
  if (!o.active || o.goal <= 0) return null;
  const pct = Math.min(100, Math.round((o.done / o.goal) * 100));
  const hit = o.done >= o.goal;
  return (
    <Link href="/sales" className="block rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] transition-colors hover:border-subtle/30">
      <div className="flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-subtle" aria-hidden />
        <p className="flex-1 text-sm font-semibold">Sales outreach</p>
        <span className={cn("tabular text-sm font-semibold", hit ? "text-good" : "text-fg")}>{o.done} of {o.goal}</span>
        <ChevronRight className="h-4 w-4 text-subtle" aria-hidden />
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Outreach today">
        <div className={cn("h-full rounded-full", hit ? "bg-good" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-subtle">
        {hit ? "Goal hit for today." : `${o.goal - o.done} more to send today.`}
        {o.replies_waiting ? ` ${o.replies_waiting} repl${o.replies_waiting === 1 ? "y is" : "ies are"} waiting on you.` : ""}
        {o.due ? ` ${o.due} outreach move${o.due === 1 ? "" : "s"} due.` : ""}
      </p>
    </Link>
  );
}
