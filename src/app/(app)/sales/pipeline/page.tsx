import type { Metadata } from "next";
import Link from "next/link";
import { reportMoney, salesConfig } from "@/lib/sales/config";
import { listDeals } from "@/lib/sales/deals";
import { refreshPrioritiesIfStale } from "@/lib/sales/priority";
import { asFieldDefs, listCustomFields } from "@/lib/sales/custom-fields";
import { fitForDeals, loadFitContext } from "@/lib/sales/fit";
import { listPipelines, listTeam } from "@/lib/sales/org";
import { listStages, listTransitions } from "@/lib/sales/stages";
import { cn } from "@/lib/cn";
import { NewDealButton } from "@/components/sales/new-deal";
import { PipelineBoard } from "@/components/sales/pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await refreshPrioritiesIfStale();
  const [stages, transitions, all, cfg, pipelines, team] = await Promise.all([
    listStages(), listTransitions(),
    listDeals("(s.category in ('open','won','parked') or d.updated_at > now() - interval '120 days')"),
    salesConfig(), listPipelines().catch(() => []), listTeam().catch(() => []),
  ]);
  const want = Number((await searchParams).p);
  const current = pipelines.find((p) => p.id === want) ?? pipelines[0] ?? null;
  const first = pipelines[0]?.id ?? null;
  // deals with no pipeline (or one that was turned off) show in the first
  const deals = current ? all.filter((d) => (pipelines.some((p) => p.id === d.pipeline_id) ? d.pipeline_id : first) === current.id) : all;
  // the pipeline's own stages, plus any stage one of its deals is in, so a deal never disappears from view
  const shown = current?.stage_ids.length ? stages.filter((s) => current.stage_ids.includes(s.id) || deals.some((d) => d.stage_id === s.id)) : stages;
  // the fit grade is a nice-to-have: if it fails, the board still opens
  const fits = await loadFitContext().then((ctx) => fitForDeals(deals.map((d) => d.id), ctx)).catch((e) => {
    console.warn("[pipeline] fit failed:", (e as Error).message);
    return new Map() as Awaited<ReturnType<typeof fitForDeals>>;
  });
  const withFit = deals.map((d) => ({ ...d, fit: fits.has(d.id) ? { score: fits.get(d.id)!.score, grade: fits.get(d.id)!.grade } : null }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Pipeline</h1>
          <p className="text-sm text-subtle">Stages move on their own as conversations happen. Priority (0 to 100) rises and falls with real engagement, so whoever needs you most is on top. Fit (A to D) is how well they suit your business.</p>
        </div>
        <NewDealButton defaultCurrency={cfg.default_currency} pipelineId={current?.id ?? null} />
      </div>
      {pipelines.length > 1 ? (
        <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Pipelines">
          {pipelines.map((p) => (
            <Link key={p.id} href={`/sales/pipeline?p=${p.id}`} aria-current={p.id === current?.id ? "page" : undefined}
              className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm", p.id === current?.id ? "border-accent font-medium text-accent" : "border-transparent text-subtle hover:text-fg")}>
              {p.name} <span className="text-xs text-subtle">{p.deals}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      <PipelineBoard
        key={current?.id ?? 0}
        stages={shown} deals={withFit} transitions={transitions} report={{ cur: reportMoney(cfg).cur, rate: reportMoney(cfg).toUsd(1) }}
        reasons={cfg.reasons} customDefs={asFieldDefs(await listCustomFields("deal"))}
        team={team.map((t) => ({ id: t.id, name: t.name }))} pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} pipelineId={current?.id ?? null}
      />
    </div>
  );
}
