import type { Metadata } from "next";
import { one } from "@/lib/db";
import { voiceConfigured } from "@/lib/deepgram";
import { focusFor, salesConfig } from "@/lib/sales/config";
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
  const focus = focusFor(cfg, new Date());
  const tiles = [
    { label: "Open pipeline", value: money(k?.open_usd ?? 0), sub: `${k?.deals ?? 0} deals`, tone: "bg-p-sky text-p-sky-fg" },
    { label: "Weighted", value: money(k?.weighted ?? 0), sub: "by stage probability", tone: "border border-border bg-surface text-fg" },
    { label: "Won, not paid", value: money(k?.won_unpaid ?? 0), sub: "cash to collect", tone: "bg-p-mint text-p-mint-fg" },
    { label: "Replies waiting", value: String(k?.replies ?? 0), sub: `${k?.meetings ?? 0} meetings in 24h`, tone: "bg-p-rose text-p-rose-fg" },
    { label: "Fresh radar leads", value: String(k?.radar ?? 0), sub: `${focus.country} · ${focus.industry}`, tone: "bg-p-butter text-p-butter-fg" },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Moves</h1>
          <p className="text-sm text-subtle">Everything that needs you, ranked. Draft in your voice, send in one tap, it logs itself.</p>
        </div>
        <NewDealButton />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-2xl px-3 py-2.5 ${t.tone}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{t.label}</p>
            <p className="font-display text-xl tabular text-current">{t.value || "0"}</p>
            <p className="truncate text-[11px] opacity-80">{t.sub}</p>
          </div>
        ))}
      </div>
      <CaptureBox dealId={null} voiceEnabled={voiceConfigured()} placeholder="Log anything: paste a chat or email, drop a screenshot, or speak what happened in a meeting. AI finds the person and deal." compact />
      <MovesView moves={moves} googleReady={google} />
    </div>
  );
}
