import type { Metadata } from "next";
import { ContactsClient } from "@/components/contacts/contacts-client";
import { listContacts } from "@/lib/services/contacts";

export const metadata: Metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await listContacts();
  return <ContactsClient contacts={contacts} />;
}
