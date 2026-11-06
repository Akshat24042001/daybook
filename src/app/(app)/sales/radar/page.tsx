import type { Metadata } from "next";
import { q } from "@/lib/db";
import { focusFor, salesConfig } from "@/lib/sales/config";
import { googleConfigured } from "@/lib/sales/google";
import { searchConfigured } from "@/lib/sales/search";
import { RadarView, type RadarItem, type SourceRow } from "@/components/sales/radar-view";

export const metadata: Metadata = { title: "Radar" };
export const dynamic = "force-dynamic";

export default async function RadarPage() {
  const [items, sources, cfg, google] = await Promise.all([
    q<RadarItem>(
      `select r.id, r.title, r.body, r.url, r.score, r.status, r.found_at, r.posted_at, r.deal_id, r.fit, s.name as source, s.category
       from sales_radar_items r left join sales_radar_sources s on s.id = r.source_id
       where r.found_at > now() - interval '10 days' and r.status in ('qualified','new','rejected','skipped')
       order by (r.status = 'qualified') desc, r.score desc nulls last, r.found_at desc limit 300`,
    ),
    q<SourceRow>("select * from sales_radar_sources order by enabled desc, category, name"),
    salesConfig(),
    googleConfigured(),
  ]);
  return <RadarView items={items} sources={sources} googleReady={google} focus={focusFor(cfg, new Date())} searchProviders={searchConfigured()} />;
}
