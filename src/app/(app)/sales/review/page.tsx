import type { Metadata } from "next";
import { verdicts, weeklyReview } from "@/lib/sales/review";

export const metadata: Metadata = { title: "Sales review" };
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-2 font-display text-base">{title}</h2>
      {children}
    </section>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = Math.min(90, Math.max(1, Number((await searchParams).days) || 7));
  const r = await weeklyReview(days);
  const tiles: [string, string][] = [
    ["New conversations", String(r.started)],
    ["Replies", `${r.replies}${r.reply_rate !== null ? ` · ${r.reply_rate}%` : ""}`],
    ["Meetings", String(r.meetings)],
    ["Proposals sent", String(r.proposals)],
    ["Won", `${r.won} · ${usd(r.won_usd)}`],
    ["Lost", String(r.lost)],
    ["Cash in", usd(r.cash_in_usd)],
    ["Overdue cash", usd(r.cash_overdue_usd)],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Review</h1>
          <p className="text-sm text-subtle">Last {days} days. The honest version; it also lands in Telegram every Sunday.</p>
        </div>
        <div className="flex gap-1.5 text-xs">
          {[7, 30, 90].map((d) => (
            <a key={d} href={`?days=${d}`} className={`rounded-full border px-3 py-1 ${d === days ? "border-accent bg-accent-muted text-accent" : "border-border text-subtle"}`}>
              {d} days
            </a>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-border bg-surface px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-subtle">{l}</p>
            <p className="font-display text-xl tabular">{v}</p>
          </div>
        ))}
      </div>
      <Box title="Straight talk">
        <ul className="space-y-1.5 text-sm">{verdicts(r).map((v) => <li key={v}>• {v}</li>)}</ul>
      </Box>
      <div className="grid gap-4 md:grid-cols-2">
        <Box title="Reply rate by channel">
          {r.by_channel.length ? (
            <ul className="space-y-1 text-sm">
              {r.by_channel.map((c) => (
                <li key={c.channel} className="flex justify-between"><span>{c.channel}</span><span className="tabular">{c.replied}/{c.out} · {c.out ? Math.round((c.replied / c.out) * 100) : 0}%</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-subtle">No outreach logged in this period.</p>}
        </Box>
        <Box title="Where leads come from (90 days)">
          {r.by_source.length ? (
            <ul className="space-y-1 text-sm">
              {r.by_source.map((s) => (
                <li key={s.source} className="flex justify-between"><span>{s.source}</span><span className="tabular">{s.deals} deals · {s.won} won · {usd(s.won_usd)}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-subtle">No deals yet.</p>}
        </Box>
        <Box title="Where deals die (90 days)">
          {r.leaks.length ? (
            <ul className="space-y-1 text-sm">{r.leaks.map((l) => <li key={l.stage} className="flex justify-between"><span>{l.stage}</span><span className="tabular">{l.n}</span></li>)}</ul>
          ) : <p className="text-sm text-subtle">Nothing lost or parked yet.</p>}
          {r.lost_reasons.length ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-subtle">Lost because</p>
              <ul className="space-y-1 text-sm">{r.lost_reasons.map((l) => <li key={l.reason} className="flex justify-between"><span>{l.reason}</span><span>{l.n}</span></li>)}</ul>
            </>
          ) : null}
        </Box>
        <Box title="Discipline">
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between"><span>Moves done / skipped</span><span>{r.moves_done} / {r.moves_skipped}</span></li>
            <li className="flex justify-between"><span>Moves overdue</span><span>{r.moves_overdue}</span></li>
            <li className="flex justify-between"><span>Promises kept / overdue</span><span>{r.promises_kept} / {r.promises_broken}</span></li>
            <li className="flex justify-between"><span>Deals stuck past limit</span><span>{r.stuck}</span></li>
            <li className="flex justify-between"><span>Avg days to close</span><span>{r.days_to_close ?? "n/a"}</span></li>
            <li className="flex justify-between"><span>Radar found / qualified / became deals</span><span>{r.radar.found} / {r.radar.qualified} / {r.radar.converted}</span></li>
          </ul>
          {r.top_sources.length ? <p className="mt-2 text-xs text-subtle">Best radar sources: {r.top_sources.map((s) => `${s.name} (${s.deals})`).join(", ")}</p> : null}
        </Box>
      </div>
    </div>
  );
}
