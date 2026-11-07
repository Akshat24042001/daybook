import type { Metadata } from "next";
import { one } from "@/lib/db";
import { voiceConfigured } from "@/lib/deepgram";
import { reportMoney, salesConfig } from "@/lib/sales/config";
import { currentFocus } from "@/lib/sales/focus";
import { googleConfigured } from "@/lib/sales/google";
import { listMoves, refreshMoves } from "@/lib/sales/moves";
import { CaptureBox } from "@/components/sales/capture-box";
import { MovesView } from "@/components/sales/moves-view";
import { NewDealButton } from "@/components/sales/new-deal";
import { money } from "@/components/sales/format";

export const metadata: Metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  // cheap rules only, so the list is always current when you open it
  await refreshMoves().catch((e) => console.warn("[sales] refresh failed:", (e as Error).message));
  const [moves, cfg, google] = await Promise.all([listMoves({ horizonHours: 48 }), salesConfig(), googleConfigured()]);
  const k = await one<{ open_usd: number | null; weighted: number | null; won_unpaid: number | null; replies: number; radar: number; meetings: number; deals: number }>(
    `select
       (select sum(d.value_usd) from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'open') as open_usd,
       (select sum(d.value_usd * coalesce(d.probability, s.probability) / 100.0) from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'open') as weighted,
       (select sum(p.amount * coalesce((select (config->'fx'->>p.currency)::numeric from sales_settings), 1)) from sales_payments p where p.status = 'due') as won_unpaid,
       (select count(*)::int from sales_moves where status = 'open' and kind = 'reply') as replies,
       (select count(*)::int from sales_radar_items where status = 'qualified' and deal_id is null and found_at > now() - interval '3 days') as radar,
       (select count(*)::int from sales_meetings where not cancelled and starts_at between now() and now() + interval '24 hours') as meetings,
       (select count(*)::int from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'open') as deals`,
  );
  const focus = await currentFocus(cfg);
  const R = reportMoney(cfg);
  const cash = (usd: number | null | undefined) => money(Math.round(R.fromUsd(Number(usd ?? 0))), R.cur);
  const tiles = [
    { label: "Open pipeline", value: cash(k?.open_usd), sub: `${k?.deals ?? 0} deals` },
    { label: "Weighted", value: cash(k?.weighted), sub: "by stage probability" },
    { label: "Won, not paid", value: cash(k?.won_unpaid), sub: "cash to collect" },
    { label: "Replies waiting", value: String(k?.replies ?? 0), sub: `${k?.meetings ?? 0} meetings in 24h` },
    { label: "Fresh radar leads", value: String(k?.radar ?? 0), sub: `${focus.country} · ${focus.industry}` },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">Moves</h1>
          <p className="text-sm text-subtle">Everything that needs you, ranked. Draft in your voice, send in one tap, it logs itself.</p>
        </div>
        <NewDealButton defaultCurrency={cfg.default_currency} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-sm)]">
            <p className="text-[13px] font-medium text-subtle">{t.label}</p>
            <p className="mt-1 font-display text-xl tabular">{t.value || "0"}</p>
            <p className="truncate text-xs text-subtle">{t.sub}</p>
          </div>
        ))}
      </div>
      <CaptureBox dealId={null} voiceEnabled={voiceConfigured()} placeholder="Log anything: paste a chat or email, drop a screenshot, or speak what happened in a meeting. AI finds the person and deal." compact />
      <MovesView moves={moves} googleReady={google} />
    </div>
  );
}
