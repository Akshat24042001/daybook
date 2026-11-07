import type { Metadata } from "next";
import { BlocklistSection, OffersSection } from "@/components/sales/playbook-offers";
import { ObjectionsSection, ProofSection } from "@/components/sales/playbook-library";
import { q } from "@/lib/db";
import { listObjections, pendingObjections } from "@/lib/sales/objections";
import { listProofs } from "@/lib/sales/proofs";
import { listBlocklist } from "@/lib/sales/blocklist";
import { DEFAULT_CONFIG, salesRow } from "@/lib/sales/config";
import { listOffers } from "@/lib/sales/offers";

export const metadata: Metadata = { title: "Playbook" };
export const dynamic = "force-dynamic";

function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-0.5 text-[13px] text-subtle">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function PlaybookPage() {
  const row = await salesRow();
  // the first visit copies the plain offer list from Sales settings into the catalogue
  const seed = (row.config?.offers as string[] | undefined) ?? DEFAULT_CONFIG.offers;
  const [offers, blocks, proofs, objections, pending, waiting] = await Promise.all([
    listOffers({ seedFrom: seed }), listBlocklist(), listProofs(), listObjections(), pendingObjections(),
    q<{ n: number }>(
      `select count(*)::int as n from sales_deals d join sales_stages s on s.id = d.stage_id
       where s.role in ('delivered','paid') and not exists (select 1 from sales_proofs p where p.deal_id = d.id)`,
    ).then((r) => r[0]?.n ?? 0),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl leading-tight">Playbook</h1>
        <p className="mt-0.5 text-sm text-subtle">What you sell, the proof behind it, the objections you hear and who never to contact. Drafts and the radar use all of it.</p>
      </div>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-subtle" aria-label="Sections">
        {[["offers", "Offers"], ["proof", "Proof"], ["objections", "Objections"], ["dnc", "Do not contact"]].map(([id, l]) => <a key={id} href={`#${id}`} className="hover:text-fg">{l}</a>)}
      </nav>
      <Section id="offers" title="Offers" hint="Your catalogue. Each offer can have packages with prices, so a quote starts in one tap from the deal page. Paused offers are never pitched.">
        <OffersSection offers={offers} defaultCurrency={String(row.config?.default_currency ?? DEFAULT_CONFIG.default_currency)} />
      </Section>
      <Section id="proof" title="Proof" hint="Case studies from delivered work. A draft is written for every delivered or paid deal from its own record; nothing is used until you approve it. Approved proof that fits a lead can be cited in follow-ups, re-engages and upsells.">
        <ProofSection rows={proofs} waiting={waiting} />
      </Section>
      <Section id="objections" title="Objections" hint="Every objection people raise, grouped, with how those deals ended. Your answer is used in drafts and pre-call briefs for any deal that raises it.">
        <ObjectionsSection rows={objections} pending={pending} />
      </Section>
      <Section id="dnc" title="Do not contact" hint="Radar leads that match are dropped before they reach you, and deals with them get no outreach moves. Their own messages are still logged.">
        <BlocklistSection rows={blocks} />
      </Section>
    </div>
  );
}
