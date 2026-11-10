import type { Metadata } from "next";
import { reportMoney, salesConfig } from "@/lib/sales/config";
import { listDeals, refreshHeat } from "@/lib/sales/deals";
import { asFieldDefs, listCustomFields } from "@/lib/sales/custom-fields";
import { listStages, listTransitions } from "@/lib/sales/stages";
import { NewDealButton } from "@/components/sales/new-deal";
import { PipelineBoard } from "@/components/sales/pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  await refreshHeat().catch(() => {});
  const [stages, transitions, deals, cfg] = await Promise.all([
    listStages(), listTransitions(),
    listDeals("(s.category in ('open','won','parked') or d.updated_at > now() - interval '120 days')"),
    salesConfig(),
  ]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Pipeline</h1>
          <p className="text-sm text-subtle">Stages move on their own as conversations happen. Priority (0 to 100) rises and falls with real engagement, so whoever needs you most is on top.</p>
        </div>
        <NewDealButton defaultCurrency={cfg.default_currency} />
      </div>
      <PipelineBoard stages={stages} deals={deals} transitions={transitions} report={{ cur: reportMoney(cfg).cur, rate: reportMoney(cfg).toUsd(1) }} reasons={cfg.reasons} customDefs={asFieldDefs(await listCustomFields("deal"))} />
    </div>
  );
}
