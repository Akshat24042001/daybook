import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamShell } from "@/components/team/kit";
import { TeamLead } from "@/components/team/team-lead";
import { voiceConfigured } from "@/lib/deepgram";
import { NotFound } from "@/lib/team/api";
import { leadView } from "@/lib/team/leads";
import { repOrLogin } from "@/lib/team/page-auth";

export const metadata: Metadata = { title: { absolute: "Lead · Aivaura Sales" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TeamLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const rep = await repOrLogin();
  const id = Number((await params).id);
  let view;
  try {
    view = await leadView(rep, id);
  } catch (e) {
    // a lead they may not see does not exist, as far as they can tell
    if (e instanceof NotFound) notFound();
    throw e;
  }
  return (
    <TeamShell name={rep.display_name}>
      <TeamLead v={JSON.parse(JSON.stringify(view))} voice={voiceConfigured()} />
    </TeamShell>
  );
}
