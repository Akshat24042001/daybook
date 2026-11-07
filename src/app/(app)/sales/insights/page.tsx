import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { forecast, speed, winLoss, type Forecast, type SegmentRow } from "@/lib/sales/insights";
import { messagePerformance } from "@/lib/sales/learning";
import type { Bucket } from "@/lib/sales/learning-calc";

export const metadata: Metadata = { title: "Sales insights" };
export const dynamic = "force-dynamic";

const usd = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n}%`);
const hrs = (h: number | null | undefined) => (h === null || h === undefined ? "–" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h} h` : `${Math.round(h / 24)} days`);

function Section({ id, title, hint, children, className }: { id?: string; title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-24 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)]", className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint ? <p className="mt-0.5 text-[13px] text-subtle">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-medium text-subtle">{label}</p>
      <p className="mt-0.5 font-display text-2xl tabular">{value}</p>
      {sub ? <p className="text-xs text-subtle">{sub}</p> : null}
    </div>
  );
}

function RateBar({ value, thin }: { value: number | null; thin?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:w-24">
        <div className={cn("h-full rounded-full", thin ? "bg-subtle/40" : "bg-accent")} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
      </div>
      <span className={cn("tabular w-10 text-right text-[13px]", thin && "text-subtle")}>{pct(value)}</span>
    </div>
  );
}

function BucketTable({ title, rows, empty = "Nothing sent yet." }: { title: string; rows: Bucket[]; empty?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">{title}</p>
      {rows.length ? (
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key} className={cn(r.thin && "text-subtle")}>
                <td className="py-1.5 pr-2">{r.label}</td>
                <td className="tabular py-1.5 pr-3 text-right text-subtle">{r.replied}/{r.sent}</td>
                <td className="py-1.5"><RateBar value={r.rate} thin={r.thin} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-[13px] text-subtle">{empty}</p>}
    </div>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: SegmentRow[] }) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-1.5 text-[13px] font-medium">{title}</p>
      {rows.length ? (
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">Deals</th>
              <th className="py-1 text-right font-medium">Won / closed</th>
              <th className="py-1 pl-3 font-medium">Win rate</th>
              <th className="py-1 text-right font-medium">Won value</th>
              <th className="py-1 text-right font-medium">Days to close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key} className={cn(r.thin && "text-subtle")}>
                <td className="max-w-[180px] truncate py-1.5 pr-2" title={r.key}>{r.key}</td>
                <td className="tabular py-1.5 text-right">{r.deals}</td>
                <td className="tabular py-1.5 text-right">{r.won}/{r.closed}</td>
                <td className="py-1.5 pl-3"><RateBar value={r.win_rate} thin={r.thin} /></td>
                <td className="tabular py-1.5 text-right">{usd(r.won_usd)}</td>
                <td className="tabular py-1.5 text-right">{r.median_days_to_close ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-[13px] text-subtle">No deals in this period.</p>}
    </div>
  );
}

function rateNote(r: { value: number; n: number; assumed: boolean }, kind: "pct" | "usd" | "days") {
  const v = kind === "pct" ? `${Math.round(r.value * 100)}%` : kind === "usd" ? usd(r.value) : `${r.value} days`;
  return (
    <span>
      <b className="font-semibold">{v}</b>{" "}
      <span className={cn("text-xs", r.assumed ? "text-warn" : "text-subtle")}>{r.assumed ? `assumed (only ${r.n} case${r.n === 1 ? "" : "s"} so far)` : `from ${r.n} deals`}</span>
    </span>
  );
}

function TargetCard({ f }: { f: Forecast }) {
  const pctWon = f.target_usd ? Math.min(100, (f.won_usd / f.target_usd) * 100) : 0;
  const pctProj = f.target_usd ? Math.min(100, (f.projected_usd / f.target_usd) * 100) : 0;
  const pace = f.target_usd ? Math.min(100, (f.day / f.days_in_month) * 100) : 0;
  const monthName = new Date(`${f.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <Section id="target" title={`Target · ${monthName}`} hint={`Day ${f.day} of ${f.days_in_month}. Won means the deal reached a Won stage this month; cash is what was paid.`}>
      {f.target_usd ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Won" value={usd(f.won_usd)} sub={`${f.won_deals} deal${f.won_deals === 1 ? "" : "s"} · target ${usd(f.target_usd)}`} />
            <Stat label="Expected by today" value={usd(f.expected_by_today_usd)} sub="if it came in evenly" />
            <Stat label="Projected" value={usd(f.projected_usd)} sub="won plus likely deals, weighted" />
            <Stat label="Cash in" value={usd(f.cash_usd)} sub="payments received" />
          </div>
          <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-muted" aria-label={`Won ${Math.round(pctWon)}% of target`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent/25" style={{ width: `${pctProj}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pctWon}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-fg/60" style={{ left: `${pace}%` }} title="Where you should be today" />
          </div>
          <p className="mt-3 text-sm">{f.verdict}</p>
        </>
      ) : (
        <p className="text-sm">{f.verdict} <Link href="/sales/settings#targets" className="font-medium text-accent hover:underline">Set it now</Link></p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[13px] font-medium">What it takes</p>
          {f.need_per_week ? (
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-medium" /><th className="py-1 text-right font-medium">Close the gap this month</th><th className="py-1 text-right font-medium">Every week, steady</th></tr></thead>
              <tbody className="divide-y divide-border">
                {([["Deals won", "deals"], ["Proposals sent", "proposals"], ["Conversations", "conversations"], ["Outreach (people contacted)", "outreach"]] as const).map(([l, k]) => (
                  <tr key={k}><td className="py-1.5">{l}</td><td className="tabular py-1.5 text-right">{f.need_this_month?.[k] ?? 0}</td><td className="tabular py-1.5 text-right font-medium">{f.need_per_week![k]}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-[13px] text-subtle">Needs a target.</p>}
          <p className="mt-2 text-xs text-subtle">Worked backwards from your own conversion rates. A deal started today closes in about {f.rates.cycle_days.value} days, so the weekly column is what keeps every month on target.</p>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Rates behind it</p>
          <ul className="space-y-1.5 text-[13px]">
            <li className="flex justify-between gap-3"><span className="text-subtle">Average won deal</span>{rateNote(f.rates.avg_deal_usd, "usd")}</li>
            <li className="flex justify-between gap-3"><span className="text-subtle">Proposal to win</span>{rateNote(f.rates.proposal_to_win, "pct")}</li>
            <li className="flex justify-between gap-3"><span className="text-subtle">Conversation to proposal</span>{rateNote(f.rates.conversation_to_proposal, "pct")}</li>
            <li className="flex justify-between gap-3"><span className="text-subtle">Contacted to conversation</span>{rateNote(f.rates.contacted_to_conversation, "pct")}</li>
            <li className="flex justify-between gap-3"><span className="text-subtle">Time to close</span>{rateNote(f.rates.cycle_days, "days")}</li>
          </ul>
          {f.likely_deals.length ? (
            <>
              <p className="mb-1 mt-4 text-[13px] font-medium">Likely to land this month</p>
              <ul className="divide-y divide-border text-[13px]">
                {f.likely_deals.slice(0, 6).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-1.5">
                    <Link href={`/sales/deal/${d.id}`} className="min-w-0 truncate hover:underline">{d.title}</Link>
                    <span className="shrink-0 text-subtle">{d.stage} · {usd(d.value_usd)} × {d.probability}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

const PERIODS = [30, 90, 180];

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const raw = Number((await searchParams).days);
  const days = PERIODS.includes(raw) ? raw : 90;
  const [f, wl, mp, sp] = await Promise.all([forecast(), winLoss(days), messagePerformance(days), speed(days)]);
  const findings = [...wl.findings, ...mp.findings, ...sp.findings];
  const top = wl.funnel[0]?.n || 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">Insights</h1>
          <p className="mt-0.5 text-sm text-subtle">Where the money comes from, what gets replies, and what it takes to hit your number.</p>
        </div>
        <div className="flex rounded-lg border border-border bg-muted p-0.5 text-[13px]" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <Link key={p} href={`?days=${p}`} role="tab" aria-selected={p === days}
              className={cn("rounded-md px-3 py-1 font-medium", p === days ? "bg-surface text-fg shadow-[var(--shadow-sm)]" : "text-subtle hover:text-fg")}>
              {p} days
            </Link>
          ))}
        </div>
      </div>

      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-subtle" aria-label="Sections">
        {[["target", "Target"], ["findings", "What the data says"], ["funnel", "Funnel"], ["segments", "Win rate"], ["quotes", "Quotes"], ["messages", "Messages"], ["speed", "Speed"]].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="hover:text-fg">{l}</a>
        ))}
      </nav>

      <TargetCard f={f} />

      <Section id="findings" title="What the data says" hint="Only claims your numbers support: at least 5 cases and a real gap. Fewer than that and it stays quiet.">
        {findings.length ? (
          <ul className="space-y-2 text-sm">{findings.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{x}</li>)}</ul>
        ) : <p className="text-sm text-subtle">Not enough history yet to say anything with confidence. Keep logging; this fills in as deals close and messages get answered.</p>}
      </Section>

      <Section id="funnel" title="Funnel" hint={`Leads created in the last ${days} days and the furthest step each reached.`}>
        {top ? (
          <ul className="space-y-2">
            {wl.funnel.map((s) => (
              <li key={s.key} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-[13px] sm:grid-cols-[160px_1fr_140px]">
                <span>{s.label}</span>
                <div className="h-6 overflow-hidden rounded-md bg-muted">
                  <div className="flex h-full items-center rounded-md bg-accent/80 px-2 text-xs font-medium text-accent-fg" style={{ width: `${Math.max(4, (s.n / top) * 100)}%` }}>{s.n}</div>
                </div>
                <span className="text-right text-subtle">{s.from_prev === null ? "" : `${pct(s.from_prev)} of previous`}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-subtle">No leads in this period.</p>}
      </Section>

      <Section id="segments" title="Win rate by segment" hint="Closed means won, lost, disqualified or ghosted. Grey rows have fewer than 5 closed deals: too few to judge.">
        <div className="grid gap-6 xl:grid-cols-2">
          <SegmentTable title="By service" rows={wl.by_service} />
          <SegmentTable title="By country" rows={wl.by_country} />
          <SegmentTable title="By source" rows={wl.by_source} />
          <SegmentTable title="By deal size" rows={wl.by_size} />
        </div>
      </Section>

      <Section id="quotes" title="Quotes" hint={`Quotes sent in the last ${days} days. Accepted means the client accepted or the deal was won.`}>
        {wl.quotes.sent ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Sent" value={wl.quotes.sent} sub={`${wl.quotes.open} still open`} />
              <Stat label="Accepted" value={pct(wl.quotes.acceptance)} sub={`${wl.quotes.accepted} accepted, ${wl.quotes.lost} lost`} />
              <Stat label="With a discount" value={pct(wl.quotes.with_discount.rate)} sub={`${wl.quotes.with_discount.sent} sent${wl.quotes.with_discount.avg_pct !== null ? `, avg ${wl.quotes.with_discount.avg_pct}% off` : ""}`} />
              <Stat label="Days to accept" value={wl.quotes.median_days_to_accept ?? "–"} sub="median" />
            </div>
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              {([["By number of revisions", wl.quotes.by_revisions], ["By size", wl.quotes.by_size]] as const).map(([t, rows]) => (
                <div key={t}>
                  <p className="mb-1.5 text-[13px] font-medium">{t}</p>
                  <table className="w-full text-[13px]"><tbody className="divide-y divide-border">
                    {rows.map((r) => <tr key={r.label}><td className="py-1.5">{r.label}</td><td className="tabular py-1.5 pr-3 text-right text-subtle">{r.accepted}/{r.sent}</td><td className="py-1.5"><RateBar value={r.rate} thin={r.sent < 5} /></td></tr>)}
                  </tbody></table>
                </div>
              ))}
            </div>
          </>
        ) : <p className="text-sm text-subtle">No quotes sent in this period.</p>}
      </Section>

      <Section id="messages" title="What gets replies" hint={<>A message counts as answered if they replied (or you spoke) before your next message, within 14 days. {mp.pending ? `${mp.pending} recent message${mp.pending === 1 ? " is" : "s are"} under 3 days old and not counted yet.` : ""}</>}>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Messages sent" value={mp.sent} />
          <Stat label="Got a reply" value={mp.replied} />
          <Stat label="Reply rate" value={pct(mp.rate)} />
        </div>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <BucketTable title="By purpose" rows={mp.by_purpose} />
          <BucketTable title="By channel" rows={mp.by_channel} />
          <BucketTable title="By time of day (your time)" rows={mp.by_time} />
          <BucketTable title="By length" rows={mp.by_length} />
          <BucketTable title="AI drafts against your own words" rows={mp.by_draft} empty="Shows once you send from moves." />
          <BucketTable title="By weekday" rows={mp.by_weekday} />
        </div>
        <p className="mt-3 text-xs text-subtle">Drafts now learn from this: each new draft is shown your real messages of the same kind that got replies, closest match first.</p>
      </Section>

      <Section id="speed" title="Speed" hint="Leads that came to you or the radar found, not deals you started with your own message. Clock hours, not working hours.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[13px] font-medium">Time to first message</p>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Median" value={hrs(sp.first_touch.median_h)} />
              <Stat label="Within 1 hour" value={pct(sp.first_touch.within_1h)} />
              <Stat label="Not contacted" value={sp.first_touch.untouched} sub={`of ${sp.first_touch.leads} leads`} />
            </div>
            <table className="mt-4 w-full text-[13px]">
              <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-medium">First message sent</th><th className="py-1 text-right font-medium">Leads</th><th className="py-1 pl-3 font-medium">Became a conversation</th></tr></thead>
              <tbody className="divide-y divide-border">
                {sp.first_touch.by_bucket.map((b) => <tr key={b.label} className={cn(b.leads < 5 && "text-subtle")}><td className="py-1.5">{b.label}</td><td className="tabular py-1.5 text-right">{b.leads}</td><td className="py-1.5 pl-3"><RateBar value={b.rate} thin={b.leads < 5} /></td></tr>)}
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium">Your reply time</p>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Median" value={hrs(sp.reply.median_h)} />
              <Stat label={`Within ${sp.reply.target_h} h`} value={pct(sp.reply.within_target)} sub="your standard" />
              <Stat label="Left waiting" value={sp.reply.waiting} sub={`past ${sp.reply.target_h} h, no reply`} />
            </div>
            {sp.reply.by_channel.length ? (
              <table className="mt-4 w-full text-[13px]">
                <thead><tr className="text-left text-xs text-subtle"><th className="py-1 font-medium">Channel</th><th className="py-1 text-right font-medium">Replies</th><th className="py-1 text-right font-medium">Median</th></tr></thead>
                <tbody className="divide-y divide-border">{sp.reply.by_channel.map((c) => <tr key={c.channel}><td className="py-1.5 capitalize">{c.channel}</td><td className="tabular py-1.5 text-right">{c.n}</td><td className="tabular py-1.5 text-right">{hrs(c.median_h)}</td></tr>)}</tbody>
              </table>
            ) : null}
          </div>
        </div>
      </Section>
    </div>
  );
}
