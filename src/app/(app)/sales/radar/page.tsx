import type { Metadata } from "next";
import { q } from "@/lib/db";
import { salesConfig } from "@/lib/sales/config";
import { currentFocus } from "@/lib/sales/focus";
import { googleConfigured } from "@/lib/sales/google";
import { getSettings } from "@/lib/settings";
import { radarPlan } from "@/lib/sales/radar-plan";
import { listHunts, seedHunts } from "@/lib/sales/hunts";
import { searchConfigured } from "@/lib/sales/search";
import { RadarView, type RadarItem, type SourceRow } from "@/components/sales/radar-view";
import { radarQuickLinks } from "@/lib/sales/quick-links";
import { voiceConfigured } from "@/lib/deepgram";

export const metadata: Metadata = { title: "Radar" };
export const dynamic = "force-dynamic";

export default async function RadarPage() {
  await seedHunts();
  const [items, sources, cfg, google, hunts, plan] = await Promise.all([
    q<RadarItem>(
      `select r.id, r.title, r.body, r.url, r.score, r.status, r.found_at, r.posted_at, r.deal_id, r.fit, r.hidden, r.company_id, r.known, r.blocked, r.poster, r.identity, r.brief, r.seen_at, r.author, r.prep, mv.draft as ready_draft, mv.draft_subject as ready_subject, mv.channel as ready_channel, co.enriched_at as researched_at, s.name as source, s.category, h.name as hunt, r.hunt_id, r.lead_kind,
              case when h.kind = 'trip' then json_build_object('city', h.cities[1], 'from', to_char(h.trip_from, 'YYYY-MM-DD'), 'to', to_char(h.trip_to, 'YYYY-MM-DD')) end as trip,
              (select to_char(m.starts_at at time zone $1, 'YYYY-MM-DD HH24:MI') from sales_meetings m where m.radar_item_id = r.id and not m.cancelled order by m.starts_at desc limit 1) as meeting_at
       from sales_radar_items r left join sales_radar_sources s on s.id = r.source_id left join sales_hunts h on h.id = r.hunt_id left join sales_companies co on co.id = r.company_id
       left join sales_moves mv on mv.dedupe_key = 'radar:' || r.id and mv.status = 'open'
       where (r.found_at > now() - interval '10 days' or r.sent_back_at > now() - interval '10 days') and r.status in ('qualified','new','rejected','skipped')
       order by coalesce(r.posted_at, r.found_at) desc limit 300`,
      [(await getSettings()).timezone],
    ),
    q<SourceRow>("select * from sales_radar_sources order by enabled desc, category, name"),
    salesConfig(),
    googleConfigured(),
    listHunts(),
    radarPlan(),
  ]);
  const links = await radarQuickLinks(items.map((i) => i.id));
  for (const it of items) it.links = links[it.id] ?? [];
  return <RadarView items={items} sources={sources} googleReady={google} focus={await currentFocus(cfg)} searchProviders={searchConfigured()} hunts={hunts} plan={plan} searchCap={cfg.radar.search_daily_cap} tz={(await getSettings()).timezone} voiceEnabled={voiceConfigured()} />;
}
