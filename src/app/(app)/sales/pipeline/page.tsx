import type { Metadata } from "next";
import { listDeals, refreshHeat } from "@/lib/sales/deals";
import { listStages, listTransitions } from "@/lib/sales/stages";
import { NewDealButton } from "@/components/sales/new-deal";
import { PipelineBoard } from "@/components/sales/pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  await refreshHeat().catch(() => {});
  const [stages, transitions, deals] = await Promise.all([
    listStages(), listTransitions(),
    listDeals("(s.category in ('open','won','parked') or d.updated_at > now() - interval '120 days')"),
  ]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Pipeline</h1>
          <p className="text-sm text-subtle">Stages move on their own as conversations happen. Priority (0 to 100) rises and falls with real engagement, so whoever needs you most is on top.</p>
        </div>
        <NewDealButton />
      </div>
      <PipelineBoard stages={stages} deals={deals} transitions={transitions} />
    </div>
  );
}
