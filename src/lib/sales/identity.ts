/**
 * Identity resolution: one person, many handles. Every email, phone, LinkedIn, Instagram and X handle is normalised and
 * stored in sales_identities, so a WhatsApp chat, an email thread and a LinkedIn screenshot land on the same person.
 */
import { one, q } from "../db";
import { similarity } from "../fuzzy";

export type IdKind = "email" | "phone" | "linkedin" | "instagram" | "twitter" | "name";

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com",
  "proton.me", "protonmail.com", "aol.com", "rediffmail.com", "zoho.com", "gmx.com", "yandex.com", "mail.com", "msn.com",
]);

export function normEmail(s: string | null | undefined): string | null {
  const m = (s ?? "").trim().toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}

/** Last 10 digits: the same mobile written as +91 98..., 098... or 98... matches. */
export function normPhone(s: string | null | undefined): string | null {
  const d = (s ?? "").replace(/\D/g, "");
  if (d.length < 7) return null;
  return d.slice(-10);
}

/** Full digits for wa.me links: adds India's 91 to a bare 10-digit mobile. */
export function waDigits(s: string | null | undefined): string | null {
  let d = (s ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d.length >= 8 ? d : null;
}

export function normLinkedin(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const m = v.match(/linkedin\.com\/(in|company)\/([^/?#\s]+)/i);
  if (m) return `${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}`;
  if (/^[a-z0-9-]{3,100}$/i.test(v)) return `in/${v.toLowerCase()}`;
  return null;
}

export function normHandle(s: string | null | undefined): string | null {
  const v = (s ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram\.com|x\.com|twitter\.com)\//i, "").replace(/[/?#].*$/, "");
  return /^[a-z0-9._]{2,40}$/i.test(v) ? v.toLowerCase() : null;
}

export function normName(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return v.length >= 2 ? v : null;
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = normEmail(email);
  if (!e) return null;
  const d = e.split("@")[1];
  return FREE_MAIL.has(d) ? null : d;
}

export function domainOf(url: string | null | undefined): string | null {
  const v = (url ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

export interface PersonHint {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  company?: string | null;
}

export interface PersonRow {
  id: number;
  full_name: string;
  company_id: number | null;
  company_name?: string | null;
  title: string | null;
}

function identitiesOf(h: PersonHint): { kind: IdKind; value: string }[] {
  const out: { kind: IdKind; value: string }[] = [];
  const e = normEmail(h.email);
  if (e) out.push({ kind: "email", value: e });
  const p = normPhone(h.phone);
  if (p) out.push({ kind: "phone", value: p });
  const l = normLinkedin(h.linkedin);
  if (l) out.push({ kind: "linkedin", value: l });
  const i = normHandle(h.instagram);
  if (i) out.push({ kind: "instagram", value: i });
  const t = normHandle(h.twitter);
  if (t) out.push({ kind: "twitter", value: t });
  return out;
}

export interface Resolution {
  person: PersonRow | null;
  /** how sure: an exact handle match, a strong name match, or several possibilities */
  how: "handle" | "name" | "ambiguous" | "none";
  candidates: PersonRow[];
}

const PERSON_SELECT = `select p.id, p.full_name, p.company_id, p.title, c.name as company_name
  from sales_people p left join sales_companies c on c.id = p.company_id`;

/** Finds who a captured message is about. Exact handles win; names only match when unambiguous. */
export async function resolvePerson(h: PersonHint): Promise<Resolution> {
  for (const id of identitiesOf(h)) {
    const hit = await one<PersonRow>(
      `${PERSON_SELECT} where p.id = (select person_id from sales_identities where kind = $1 and value = $2)`,
      [id.kind, id.value],
    );
    if (hit) return { person: hit, how: "handle", candidates: [hit] };
  }
  const name = normName(h.name);
  if (!name) return { person: null, how: "none", candidates: [] };
  const first = name.split(" ")[0];
  const rows = await q<PersonRow>(
    `${PERSON_SELECT} where lower(p.full_name) like $1 or exists (
       select 1 from sales_identities i where i.person_id = p.id and i.kind = 'name' and i.value like $1)
     order by p.updated_at desc limit 25`,
    [`%${first}%`],
  );
  const company = normName(h.company);
  const scored = rows
    .map((r) => {
      let s = similarity(name, normName(r.full_name) ?? "");
      if (company && r.company_name && similarity(company, normName(r.company_name) ?? "") > 0.8) s += 0.15;
      return { r, s };
    })
    .filter((x) => x.s >= 0.55)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { person: null, how: "none", candidates: [] };
  const [best, second] = scored;
  if (best.s >= 0.9 && (!second || best.s - second.s >= 0.15)) return { person: best.r, how: "name", candidates: [best.r] };
  return { person: null, how: "ambiguous", candidates: scored.slice(0, 4).map((x) => x.r) };
}

/** Adds every handle in the hint to the person (handles already owned by someone else are left alone). */
export async function addIdentities(personId: number, h: PersonHint): Promise<void> {
  const ids = identitiesOf(h);
  const name = normName(h.name);
  if (name) ids.push({ kind: "name", value: name });
  for (const id of ids) {
    await q("insert into sales_identities (person_id, kind, value) values ($1,$2,$3) on conflict (kind, value) do nothing", [personId, id.kind, id.value]);
  }
  const email = normEmail(h.email);
  const phone = h.phone?.trim();
  await q(
    `update sales_people set
       emails = case when $2::text is null or $2 = any(emails) then emails else array_append(emails, $2) end,
       phones = case when $3::text is null or exists (select 1 from unnest(phones) x where right(regexp_replace(x,'\\D','','g'),10) = right(regexp_replace($3,'\\D','','g'),10)) then phones else array_append(phones, $3) end,
       linkedin = coalesce(linkedin, $4), instagram = coalesce(instagram, $5), twitter = coalesce(twitter, $6),
       updated_at = now()
     where id = $1`,
    [personId, email, phone && normPhone(phone) ? phone : null, h.linkedin?.trim() || null, normHandle(h.instagram), normHandle(h.twitter)],
  );
}

export async function ensureCompany(name: string | null | undefined, opts: { domain?: string | null; website?: string | null; country?: string | null; industry?: string | null } = {}): Promise<number | null> {
  const domain = opts.domain ?? domainOf(opts.website);
  const clean = (name ?? "").trim();
  if (!clean && !domain) return null;
  if (domain) {
    const hit = await one<{ id: number }>("select id from sales_companies where lower(domain) = lower($1)", [domain]);
    if (hit) return hit.id;
  }
  if (clean) {
    const hit = await one<{ id: number }>("select id from sales_companies where lower(name) = lower($1) order by id limit 1", [clean]);
    if (hit) {
      if (domain) await q("update sales_companies set domain = coalesce(domain, $2), website = coalesce(website, $3) where id = $1", [hit.id, domain, opts.website ?? `https://${domain}`]).catch(() => {});
      return hit.id;
    }
  }
  const row = await one<{ id: number }>(
    `insert into sales_companies (name, domain, website, country, industry) values ($1,$2,$3,$4,$5) returning id`,
    [clean || domain, domain, opts.website ?? (domain ? `https://${domain}` : null), opts.country ?? null, opts.industry ?? null],
  );
  return row!.id;
}

/** Creates a person (or returns the resolved one) and records every handle. */
export async function upsertPerson(h: PersonHint & { title?: string | null; country?: string | null; city?: string | null; relationship?: string; company_id?: number | null }): Promise<number> {
  const r = await resolvePerson(h);
  if (r.person) {
    await addIdentities(r.person.id, h);
    await q(
      "update sales_people set title = coalesce(title, $2), country = coalesce(country, $3), city = coalesce(city, $4), company_id = coalesce(company_id, $5) where id = $1",
      [r.person.id, h.title ?? null, h.country ?? null, h.city ?? null, h.company_id ?? null],
    );
    return r.person.id;
  }
  const companyId = h.company_id ?? (await ensureCompany(h.company, { domain: emailDomain(h.email) }));
  const row = await one<{ id: number }>(
    `insert into sales_people (full_name, title, company_id, country, city, relationship) values ($1,$2,$3,$4,$5,$6) returning id`,
    [(h.name ?? "").trim() || normEmail(h.email) || h.phone || "Unknown", h.title ?? null, companyId, h.country ?? null, h.city ?? null, h.relationship ?? "cold"],
  );
  await addIdentities(row!.id, h);
  return row!.id;
}

/** Merges person `from` into `into`: handles, deals, interactions all move. */
export async function mergePeople(into: number, from: number): Promise<void> {
  if (into === from) return;
  await q("update sales_identities set person_id = $1 where person_id = $2 and (kind, value) not in (select kind, value from sales_identities where person_id = $1)", [into, from]);
  for (const sql of [
    "update sales_deals set person_id = $1 where person_id = $2",
    "update sales_deals set referrer_id = $1 where referrer_id = $2",
    "update sales_deals set intermediary_id = $1 where intermediary_id = $2",
    "update sales_interactions set person_id = $1 where person_id = $2",
    "update sales_commitments set person_id = $1 where person_id = $2",
    "update sales_meetings set person_id = $1 where person_id = $2",
    "insert into sales_deal_people (deal_id, person_id, role) select deal_id, $1, role from sales_deal_people where person_id = $2 on conflict do nothing",
  ]) await q(sql, [into, from]);
  await q(
    `update sales_people t set emails = array(select distinct unnest(t.emails || f.emails)), phones = array(select distinct unnest(t.phones || f.phones)),
       linkedin = coalesce(t.linkedin, f.linkedin), instagram = coalesce(t.instagram, f.instagram), title = coalesce(t.title, f.title),
       company_id = coalesce(t.company_id, f.company_id), notes = concat_ws(E'\\n', t.notes, f.notes)
     from sales_people f where t.id = $1 and f.id = $2`,
    [into, from],
  );
  await q("delete from sales_people where id = $1", [from]);
}
