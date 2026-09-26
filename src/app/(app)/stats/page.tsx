import type { Metadata } from "next";
import { StatsView } from "@/components/stats/stats-view";
import { q } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import { addDays, type DateStr } from "@/lib/time";
import type { TaskType } from "@/lib/types";
import { computeStats, dayTimelines, type StatsFilters } from "@/lib/services/stats";
import { summariesInRange, toSummaryView } from "@/lib/services/diary";

export const metadata: Metadata = { title: "Stats" };
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES: TaskType[] = ["one_off", "ongoing", "follow_up", "cadence", "recurring", "someday", "target"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function StatsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await makeCtx();

  const range = one(sp.range) ?? "30";
  let from: DateStr;
  let to: DateStr = ctx.today;
  if (range === "custom") {
    const f = one(sp.from);
    const t = one(sp.to);
    from = f && DATE.test(f) ? f : addDays(ctx.today, -29);
    to = t && DATE.test(t) ? t : ctx.today;
    if (from > to) [from, to] = [to, from];
    if (from < addDays(to, -730)) from = addDays(to, -730);
  } else {
    const n = range === "7" ? 7 : range === "90" ? 90 : 30;
    from = addDays(ctx.today, -(n - 1));
  }

  const type = one(sp.type);
  const scope = one(sp.scope);
  const person = Number(one(sp.person));
  const filters: StatsFilters = {
    from,
    to,
    project: one(sp.project) || null,
    type: type && (TYPES as string[]).includes(type) ? (type as TaskType) : null,
    scope: scope === "work" || scope === "personal" ? scope : "all",
    person: Number.isFinite(person) && person > 0 ? person : null,
    via: one(sp.via)?.trim() || null,
  };

  const [stats, projects, people, vias, diary, timeline] = await Promise.all([
    computeStats(ctx, filters, one(sp.drill) ?? null),
    q<{ id: number; name: string }>("select id, name from projects order by lower(name)"),
    q<{ id: number; name: string }>("select id, name from people order by lower(name)"),
    q<{ via: string }>("select distinct via from tasks where via is not null and via <> '' order by via"),
    summariesInRange(from, to).catch(() => []),
    dayTimelines(ctx, from, to),
  ]);

  return (
    <StatsView
      stats={stats}
      range={range === "custom" ? "custom" : range === "7" ? "7" : range === "90" ? "90" : "30"}
      projects={projects}
      people={people}
      vias={vias.map((v) => v.via)}
      drill={one(sp.drill) ?? null}
      today={ctx.today}
      diary={diary.map(toSummaryView)}
      timeline={timeline}
    />
  );
}
