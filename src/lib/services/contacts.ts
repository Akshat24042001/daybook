import { q, one } from "@/lib/db";

export interface Contact {
  id: number;
  name: string;
  city: string | null;
  company: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  linkedin: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
}

export async function listContacts(): Promise<Contact[]> {
  return q<Contact>("select * from contacts order by lower(name)");
}

export async function getContact(id: number): Promise<Contact | null> {
  return one<Contact>("select * from contacts where id = $1", [id]);
}

export async function createContact(data: Omit<Contact, "id" | "created_at">) {
  const [row] = await q<{ id: number }>(
    `insert into contacts (name, city, company, role, phone, email, linkedin, notes, tags)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [data.name, data.city || null, data.company || null, data.role || null,
     data.phone || null, data.email || null, data.linkedin || null,
     data.notes || null, data.tags],
  );
  return row.id;
}

export async function updateContact(id: number, data: Partial<Omit<Contact, "id" | "created_at">>) {
  const fields: string[] = [];
  const params: unknown[] = [id];
  let i = 2;
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k} = $${i++}`);
    params.push(v ?? null);
  }
  if (!fields.length) return;
  await q(`update contacts set ${fields.join(", ")} where id = $1`, params);
}

export async function deleteContact(id: number) {
  await q("delete from contacts where id = $1", [id]);
}
