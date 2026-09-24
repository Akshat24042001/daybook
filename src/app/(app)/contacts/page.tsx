import type { Metadata } from "next";
import { ContactsClient } from "@/components/contacts/contacts-client";
import { listContacts } from "@/lib/services/contacts";
import { deepgramReady } from "@/lib/voice-config";

export const metadata: Metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await listContacts();
  return <div className="mx-auto max-w-6xl"><ContactsClient contacts={contacts} voiceEnabled={deepgramReady()} /></div>;
}
