import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { voiceConfigured } from "@/lib/deepgram";
import { commitments, getDeal, lastTouchByChannel, payments, timeline } from "@/lib/sales/deals";
import { listDocs } from "@/lib/sales/docs";
import { COMPANY_FIELDS, PERSON_FIELDS } from "@/lib/sales/enrich";
import { googleConfigured } from "@/lib/sales/google";
import { baseUrl } from "@/lib/sales/links";
import { listMoves, refreshMoves } from "@/lib/sales/moves";
import { allowedTargets } from "@/lib/sales/stages";
import { DealView, type DealPageData } from "@/components/sales/deal-view";

export const metadata: Metadata = { title: "Deal" };
export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  await refreshMoves(id).catch(() => {});
  const deal = await getDeal(id);
  if (!deal) notFound();
  const [targets, tl, touches, commits, pays, docs, moves, google] = await Promise.all([
    allowedTargets(deal.stage_id), timeline(id), lastTouchByChannel(id), commitments(id), payments(id), listDocs(id), listMoves({ dealId: id, horizonHours: 24 * 30 }), googleConfigured(),
  ]);
  const people = await q<DealPageData["people"][number]>(
    `select p.id, p.full_name, p.title, dp.role, p.emails, p.phones, p.linkedin, p.is_decision_maker
     from sales_deal_people dp join sales_people p on p.id = dp.person_id where dp.deal_id = $1 order by (p.id = $2) desc, p.full_name`,
    [id, deal.person_id ?? 0],
  );
  const company = deal.company_id ? await one<DealPageData["company"]>("select id, name, website, industry, country, employees, revenue_usd, revenue_is_estimate, enrichment, enriched_at, audit from sales_companies where id = $1", [deal.company_id]) : null;
  const person = deal.person_id ? await one<DealPageData["person"]>("select id, full_name, enrichment, enriched_at from sales_people where id = $1", [deal.person_id]) : null;
  const events = await q<DealPageData["events"][number]>(
    `select e.id, f.name as from_name, t.name as to_name, e.cause, e.detail, e.created_at from sales_deal_events e
     left join sales_stages f on f.id = e.from_stage left join sales_stages t on t.id = e.to_stage where e.deal_id = $1 order by e.created_at desc limit 40`,
    [id],
  );
  const meetings = await q<DealPageData["meetings"][number]>("select id, title, starts_at, link from sales_meetings where deal_id = $1 and not cancelled order by starts_at desc limit 10", [id]);
  return (
    <DealView
      d={{
        deal, targets, timeline: tl, touches, commitments: commits, payments: pays, docs, moves, people, company, person, events, meetings,
        companyFields: COMPANY_FIELDS, personFields: PERSON_FIELDS, googleReady: google, voiceEnabled: voiceConfigured(), baseUrl: baseUrl(),
      }}
    />
  );
}
