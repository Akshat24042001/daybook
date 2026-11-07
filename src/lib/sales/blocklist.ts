/**
 * Do not contact, and "you already know them".
 *
 * Do not contact: a domain, email, phone, company or person you never want to pitch. A blocked radar lead is dropped
 * before it can alert you or become a move, and a deal whose company or person is blocked gets no outreach moves
 * (their own messages are still logged: you can always answer someone who writes to you).
 *
 * Known: a radar lead that matches a company or person already in Sales is tagged with that deal, and turning it into
 * a lead adds it to the existing deal instead of creating a duplicate (unless that deal was lost: then it is a new
 * attempt with the same company).
 */
import { one, q, UserError } from "../db";
import { domainOf, emailDomain, normEmail, normPhone } from "./identity";

export type BlockKind = "domain" | "email" | "phone" | "company" | "person";
export interface BlockRow { id: number; kind: BlockKind; value: string; reason: string | null; created_at: string }

const LEGAL = /\b(private limited|pvt\.? ?ltd\.?|pvt|ltd\.?|limited|llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|co\.|gmbh|plc|pte\.?|fzco|fz-llc|fze|llp|bv|s\.a\.|sa|ag)\b/g;
export function normCompany(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase().replace(LEGAL, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length >= 2 ? v : null;
}
export function normPerson(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return v.split(" ").length >= 2 ? v : null; // a single first name is too vague to block or match on
}

/** The canonical stored form of a value, so "https://www.Acme.com/about" and "acme.com" are the same entry. */
export function normBlock(kind: BlockKind, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  switch (kind) {
    case "domain": return v.includes("@") ? emailDomain(v) ?? v.split("@")[1]?.toLowerCase() ?? null : domainOf(v);
    case "email": return normEmail(v);
    case "phone": return normPhone(v);
    case "company": return normCompany(v);
    case "person": return normPerson(v);
  }
}

export async function listBlocklist(): Promise<BlockRow[]> {
  return q<BlockRow>("select * from sales_blocklist order by created_at desc");
}

export async function addBlock(kind: BlockKind, raw: string, reason?: string | null): Promise<number> {
  const value = normBlock(kind, raw);
  if (!value) throw new UserError(kind === "person" ? "Enter a full name (first and last), a single first name is too vague." : `That does not look like a valid ${kind}.`);
  const row = await one<{ id: number }>(
    "insert into sales_blocklist (kind, value, reason) values ($1,$2,$3) on conflict (kind, value) do update set reason = coalesce(excluded.reason, sales_blocklist.reason) returning id",
    [kind, value, reason?.trim() || null],
  );
  // leads already waiting that match are dropped now, not at the next sweep
  await rescreenOpenRadar();
  return row!.id;
}

export async function removeBlock(id: number): Promise<void> {
  await q("delete from sales_blocklist where id = $1", [id]);
}

export interface Hint {
  domains?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
  company?: string | null;
  person?: string | null;
}

const LABEL: Record<BlockKind, string> = { domain: "domain", email: "email", phone: "phone", company: "company", person: "person" };

/** The reason this hint is blocked, or null. */
export function blockedBy(list: BlockRow[], h: Hint): string | null {
  if (!list.length) return null;
  const domains = new Set((h.domains ?? []).map((d) => (d ? domainOf(d) : null)).filter(Boolean) as string[]);
  for (const e of h.emails ?? []) { const d = emailDomain(e); if (d) domains.add(d); }
  const emails = new Set((h.emails ?? []).map((e) => normEmail(e)).filter(Boolean) as string[]);
  const phones = new Set((h.phones ?? []).map((p) => normPhone(p)).filter(Boolean) as string[]);
  const company = normCompany(h.company);
  const person = normPerson(h.person);
  for (const b of list) {
    const hit = b.kind === "domain" ? [...domains].some((d) => d === b.value || d.endsWith(`.${b.value}`))
      : b.kind === "email" ? emails.has(b.value)
      : b.kind === "phone" ? phones.has(b.value)
      : b.kind === "company" ? company === b.value
      : person === b.value;
    if (hit) return `On your do-not-contact list (${LABEL[b.kind]}: ${b.value}${b.reason ? `, ${b.reason}` : ""})`;
  }
  return null;
}

export interface Known {
  deal_id: number | null;
  deal_title: string | null;
  stage: string | null;
  category: string | null;
  lost_reason: string | null;
  company_id: number | null;
  person_id: number | null;
  why: string;
}

/** Someone already in Sales: by website domain or email first (exact), then company name, then full person name. */
export async function knownFor(h: Hint): Promise<Known | null> {
  const domains = [...new Set([...(h.domains ?? []).map((d) => (d ? domainOf(d) : null)), ...(h.emails ?? []).map((e) => emailDomain(e))].filter(Boolean) as string[])];
  const emails = (h.emails ?? []).map((e) => normEmail(e)).filter(Boolean) as string[];
  let companyId: number | null = null;
  let personId: number | null = null;
  let why = "";
  if (emails.length) {
    const p = await one<{ person_id: number; company_id: number | null }>(
      "select i.person_id, p.company_id from sales_identities i join sales_people p on p.id = i.person_id where i.kind = 'email' and i.value = any($1) limit 1",
      [emails],
    );
    if (p) { personId = p.person_id; companyId = p.company_id; why = "same email address"; }
  }
  if (!companyId && domains.length) {
    const c = await one<{ id: number }>("select id from sales_companies where lower(domain) = any($1) limit 1", [domains]);
    if (c) { companyId = c.id; why = "same website domain"; }
  }
  const cn = normCompany(h.company);
  if (!companyId && cn) {
    const rows = await q<{ id: number; name: string }>("select id, name from sales_companies where name is not null");
    const c = rows.find((r) => normCompany(r.name) === cn);
    if (c) { companyId = c.id; why = "same company name"; }
  }
  const pn = normPerson(h.person);
  if (!personId && pn) {
    const rows = await q<{ id: number; full_name: string; company_id: number | null }>(
      "select id, full_name, company_id from sales_people where ($1::int is null or company_id = $1 or company_id is null)",
      [companyId],
    );
    const p = rows.find((r) => normPerson(r.full_name) === pn);
    if (p) { personId = p.id; companyId = companyId ?? p.company_id; why = why || "same person"; }
  }
  if (!companyId && !personId) return null;
  const deal = await one<{ id: number; title: string; stage: string; category: string; lost_reason: string | null }>(
    `select d.id, d.title, s.name as stage, s.category, d.lost_reason from sales_deals d join sales_stages s on s.id = d.stage_id
     where ($1::int is not null and d.company_id = $1) or ($2::int is not null and d.person_id = $2)
     order by (s.category = 'open') desc, (s.category = 'won') desc, d.updated_at desc limit 1`,
    [companyId, personId],
  );
  return {
    deal_id: deal?.id ?? null, deal_title: deal?.title ?? null, stage: deal?.stage ?? null, category: deal?.category ?? null,
    lost_reason: deal?.lost_reason ?? null, company_id: companyId, person_id: personId, why,
  };
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Screens one scored radar lead: blocked leads are rejected with the reason, known ones are tagged.
 * Returns what happened so the caller can skip alerts for blocked leads.
 */
export async function screenRadarItem(id: number, list?: BlockRow[]): Promise<"blocked" | "known" | "new" | null> {
  const it = await one<{ id: number; title: string; body: string | null; status: string; fit: { company?: string | null; website?: string | null; contact?: string | null } | null }>(
    "select id, title, body, status, fit from sales_radar_items where id = $1",
    [id],
  );
  if (!it) return null;
  const f = it.fit ?? {};
  const hint: Hint = {
    domains: [f.website],
    emails: [...new Set(`${it.title} ${it.body ?? ""}`.match(EMAIL_RE) ?? [])].slice(0, 5),
    company: f.company ?? null,
    person: f.contact ?? null,
  };
  const reason = blockedBy(list ?? (await listBlocklist()), hint);
  if (reason) {
    await q("update sales_radar_items set status = 'rejected', blocked = $2 where id = $1", [id, reason]);
    await q("update sales_moves set status = 'obsolete' where dedupe_key = $1 and status in ('open','snoozed')", [`radar:${id}`]);
    return "blocked";
  }
  const known = await knownFor(hint);
  await q("update sales_radar_items set known = $2, blocked = null where id = $1", [id, known ? JSON.stringify(known) : null]);
  return known ? "known" : "new";
}

/** Re-screens leads that are still waiting for you (after the list changes). */
export async function rescreenOpenRadar(): Promise<number> {
  const list = await listBlocklist();
  const rows = await q<{ id: number }>("select id from sales_radar_items where status in ('new','qualified') and deal_id is null and found_at > now() - interval '30 days'");
  let n = 0;
  for (const r of rows) if ((await screenRadarItem(r.id, list)) === "blocked") n += 1;
  return n;
}

/** Deals whose company or person is on the list: they get no outreach moves. */
export async function blockedDealIds(): Promise<Set<number>> {
  const list = await listBlocklist();
  if (!list.length) return new Set();
  const deals = await q<{ id: number; domain: string | null; website: string | null; company: string | null; person: string | null; emails: string[] | null; phones: string[] | null }>(
    `select d.id, c.domain, c.website, c.name as company, p.full_name as person, p.emails, p.phones
     from sales_deals d left join sales_companies c on c.id = d.company_id left join sales_people p on p.id = d.person_id`,
  );
  return new Set(deals.filter((d) => blockedBy(list, { domains: [d.domain, d.website], emails: d.emails ?? [], phones: d.phones ?? [], company: d.company, person: d.person })).map((d) => d.id));
}
