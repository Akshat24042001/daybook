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
import { blockedDealIds } from "@/lib/sales/blocklist";
import { listOffers, packageTotal, packagesFor } from "@/lib/sales/offers";
import { DealView, type DealPageData } from "@/components/sales/deal-view";
import { dealQuickLinks } from "@/lib/sales/quick-links";
import { salesConfig } from "@/lib/sales/config";
import { closingGaps } from "@/lib/sales/closing";
import { asFieldDefs, listCustomFields } from "@/lib/sales/custom-fields";
import { fitForDeals } from "@/lib/sales/fit";
import { listItems } from "@/lib/sales/items";
import { listPipelines, listTeam } from "@/lib/sales/org";
import { playFor } from "@/lib/sales/playbook-stages";

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
    `select p.id, p.full_name, p.title, dp.role, p.emails, p.phones, p.linkedin, p.is_decision_maker, p.department, p.seniority, p.whatsapp,
            p.preferred_channel, p.language, p.instagram, p.city, p.country, p.relationship, p.notes, p.custom
     from sales_deal_people dp join sales_people p on p.id = dp.person_id where dp.deal_id = $1 order by (p.id = $2) desc, p.full_name`,
    [id, deal.person_id ?? 0],
  );
  const company = deal.company_id ? await one<DealPageData["company"]>("select id, name, website, industry, country, city, region, address, postal_code, phone, email, tax_id, linkedin, notes, custom, employees, revenue_usd, revenue_is_estimate, enrichment, enriched_at, audit from sales_companies where id = $1", [deal.company_id]) : null;
  const person = deal.person_id ? await one<DealPageData["person"]>("select id, full_name, enrichment, enriched_at from sales_people where id = $1", [deal.person_id]) : null;
  // the whole journey: every stage move and field change, with the stages' order so a move back can be shown
  const events = await q<DealPageData["events"][number]>(
    `select e.id, e.kind, f.name as from_name, t.name as to_name, f.sort as from_sort, t.sort as to_sort, f.category as from_cat, t.category as to_cat,
            e.cause, e.detail, e.field, e.old_value, e.new_value, e.created_at, e.edited_at
     from sales_deal_events e left join sales_stages f on f.id = e.from_stage left join sales_stages t on t.id = e.to_stage
     where e.deal_id = $1 and e.kind in ('stage','field','created') order by e.created_at desc limit 1000`,
    [id],
  );
  const [cfg, customDefs, gaps, companyDefs, personDefs] = await Promise.all([salesConfig(), listCustomFields("deal"), closingGaps(id), listCustomFields("company"), listCustomFields("person")]);
  const blocked = (await blockedDealIds()).has(id);
  const packages = packagesFor(await listOffers({ activeOnly: true }), deal.services ?? []).map((p) => ({
    offerId: p.offer.id, index: p.index, offer: p.offer.name, name: p.pkg.name, currency: p.pkg.currency, total: packageTotal(p.pkg), items: p.pkg.items.length, timeline: p.pkg.timeline, fits: p.fits,
  }));
  const links = await dealQuickLinks(id);
  const [pipelines, team] = await Promise.all([listPipelines(), listTeam()]);
  const stageRow = await one<{ key: string }>("select key from sales_stages where id = $1", [deal.stage_id]);
  const stageKey = deal.stage_role ?? stageRow?.key ?? String(deal.stage_id);
  // your objection answers: the ones this deal raised first, then your most common
  const objections = await q<{ label: string; answer: string }>(
    `select o.label, o.answer from sales_objections o
     where o.answer is not null and length(trim(o.answer)) > 0
     order by exists (select 1 from sales_deal_objections x where x.objection_id = o.id and x.deal_id = $1) desc,
              (select count(*) from sales_deal_objections x where x.objection_id = o.id) desc
     limit 4`,
    [id],
  ).catch(() => []);
  const meetings = await q<DealPageData["meetings"][number]>("select id, title, starts_at, link from sales_meetings where deal_id = $1 and not cancelled order by starts_at desc limit 10", [id]);
  return (
    <DealView
      d={{
        deal, targets, timeline: tl, touches, commitments: commits, payments: pays, docs, moves, people, company, person, events, meetings,
        companyFields: COMPANY_FIELDS, personFields: PERSON_FIELDS, googleReady: google, voiceEnabled: voiceConfigured(), baseUrl: baseUrl(), blocked, packages, links,
        reasons: cfg.reasons, customDefs: asFieldDefs(customDefs), gaps, companyDefs: asFieldDefs(companyDefs), personDefs: asFieldDefs(personDefs),
        fit: (await fitForDeals([id])).get(id) ?? null, items: await listItems(id), defaultTax: cfg.default_tax_pct,
        itemPackages: packages.map((p) => ({ offerId: p.offerId, index: p.index, label: `${p.offer} · ${p.name}` })),
        stageKey, play: playFor({ role: deal.stage_role, key: stageRow?.key }, cfg.playbook), ticked: (deal.checklist ?? {})[stageKey] ?? [],
        objections, owner: { name: cfg.owner.name, company: cfg.owner.company },
        choices: {
          pipeline_id: pipelines.map((p) => [String(p.id), p.name] as [string, string]),
          owner_id: team.map((t) => [String(t.id), t.name] as [string, string]),
        },
      }}
    />
  );
}
