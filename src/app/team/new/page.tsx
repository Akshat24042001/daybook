import type { Metadata } from "next";
import { TeamShell } from "@/components/team/kit";
import { NewLeadForm } from "@/components/team/new-lead-form";
import { voiceConfigured } from "@/lib/deepgram";
import { listOffers } from "@/lib/sales/offers";
import { repOrLogin } from "@/lib/team/page-auth";

export const metadata: Metadata = { title: { absolute: "New lead · Aivaura Sales" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TeamNewLead() {
  const rep = await repOrLogin();
  // only the names of what Aivaura sells, for the "services" choice (no prices or packages)
  const services = (await listOffers({ activeOnly: true }).catch(() => [])).map((o) => o.name);
  return (
    <TeamShell name={rep.display_name}>
      <NewLeadForm services={services} voice={voiceConfigured()} />
    </TeamShell>
  );
}
