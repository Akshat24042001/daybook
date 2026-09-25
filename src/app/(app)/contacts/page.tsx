import type { Metadata } from "next";
import { ContactsClient } from "@/components/contacts/contacts-client";
import { listContacts } from "@/lib/services/contacts";
import { deepgramReady } from "@/lib/voice-config";
import { makeCtx } from "@/lib/settings";
import { touchStates } from "@/lib/services/keep-in-touch";

export const metadata: Metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const ctx = await makeCtx();
  // touchStates first: it adds the keep-in-touch columns if a deploy skipped the migration
  const touch = await touchStates(ctx.today, ctx.tz);
  const contacts = await listContacts();
  return (
    <div className="mx-auto max-w-6xl">
      <ContactsClient contacts={contacts} voiceEnabled={deepgramReady()} touch={touch} />
    </div>
  );
}
