/**
 * One clean-up, run once by the scheduler: contacts saved before the strict check (contact-verify) are taken out of
 * sight unless they can still be trusted. No contact is better than a wrong one.
 *
 *   Radar leads: phones and emails found "behind the post" before proof was required are moved to `unverified`; only
 *     what the poster wrote in the post itself stays. Recent open leads are searched again, the strict way.
 *   People: the numbers and emails copied from those searches onto a person are removed, unless the lead has written
 *     back to you since (then the conversation proves the channel).
 *   Companies: website contacts from another country are removed; when the website was found by research and never
 *     matched the lead decisively, its contacts are removed too.
 */
import { one, q } from "../db";
import { wrongCountry } from "./contact-verify";
import { enqueue } from "./jobs";
import type { Enrichment } from "./enrich";

const digits = (s: string) => s.replace(/\D/g, "");

export async function scrubContacts(): Promise<{ radar: number; people: number; companies: number; requeued: number }> {
  let radar = 0, people = 0, companies = 0, requeued = 0;

  const items = await q<{ id: number; title: string; body: string | null; url: string | null; deal_id: number | null; person_id: number | null; status: string; found_at: string; identity: Record<string, unknown> & { phones?: string[]; emails?: string[] }; prep: Record<string, unknown> | null }>(
    `select id, title, body, url, deal_id, person_id, status, found_at, identity, prep from sales_radar_items
     where identity is not null and identity->'verified' is null
       and (jsonb_array_length(coalesce(identity->'phones', '[]')) > 0 or jsonb_array_length(coalesce(identity->'emails', '[]')) > 0)`,
  );
  for (const it of items) {
    const post = `${it.title}\n${it.body ?? ""}`;
    const inPost = (v: string) => (/@/.test(v) ? post.toLowerCase().includes(v.toLowerCase()) : digits(v).length >= 8 && digits(post).includes(digits(v).slice(-9)));
    const phones = it.identity.phones ?? [];
    const emails = it.identity.emails ?? [];
    const keep = { phones: phones.filter(inPost), emails: emails.filter(inPost) };
    const drop = { phones: phones.filter((p) => !inPost(p)), emails: emails.filter((e) => !inPost(e)) };
    const verified = [...keep.phones.map((v) => ({ kind: "phone", value: v, url: it.url ?? "the post", owner: "person" })), ...keep.emails.map((v) => ({ kind: "email", value: v, url: it.url ?? "the post", owner: "person" }))];
    const identity = { ...it.identity, phones: keep.phones, emails: keep.emails, verified, unverified: drop };
    // the ready pack drew on the same contacts: those go too, and the lead is prepared again
    type PackLike = { decision_maker?: { email?: string | null; phone?: string | null } | null; contacts?: { emails?: string[]; phones?: string[]; whatsapp?: string | null } };
    const pk = it.prep?.pack as PackLike | null | undefined;
    const prep = pk ? {
      ...it.prep,
      pack: {
        ...pk,
        decision_maker: pk.decision_maker ? { ...pk.decision_maker, email: pk.decision_maker.email && inPost(pk.decision_maker.email) ? pk.decision_maker.email : null, phone: pk.decision_maker.phone && inPost(pk.decision_maker.phone) ? pk.decision_maker.phone : null } : null,
        contacts: { ...pk.contacts, emails: (pk.contacts?.emails ?? []).filter(inPost), phones: (pk.contacts?.phones ?? []).filter(inPost), whatsapp: null },
      },
    } : it.prep;
    await q("update sales_radar_items set identity = $2, prep = $3 where id = $1", [it.id, JSON.stringify(identity), prep ? JSON.stringify(prep) : null]);
    radar += 1;

    // what was copied onto a person from this search
    const replied = it.deal_id ? await one("select 1 from sales_interactions where deal_id = $1 and direction in ('in','both') limit 1", [it.deal_id]) : null;
    const pid = it.person_id ?? (it.deal_id ? (await one<{ person_id: number | null }>("select person_id from sales_deals where id = $1", [it.deal_id]))?.person_id ?? null : null);
    if (pid && !replied && (drop.phones.length || drop.emails.length)) {
      const badDigits = drop.phones.map((p) => digits(p).slice(-9));
      const badEmails = drop.emails.map((e) => e.toLowerCase());
      const r = await one<{ id: number }>(
        `update sales_people set
           phones = array(select x from unnest(phones) x where right(regexp_replace(x, '\\D', '', 'g'), 9) <> all($2::text[])),
           emails = array(select x from unnest(emails) x where lower(x) <> all($3::text[])),
           updated_at = now()
         where id = $1 and (exists (select 1 from unnest(phones) x where right(regexp_replace(x, '\\D', '', 'g'), 9) = any($2::text[]))
                         or exists (select 1 from unnest(emails) x where lower(x) = any($3::text[])))
         returning id`,
        [pid, badDigits, badEmails],
      );
      if (r) people += 1;
    }
    // recent leads you have not acted on are searched again, with proof required this time
    const recent = Date.now() - new Date(it.found_at).getTime() < 10 * 86_400_000;
    if (recent && !it.deal_id && ["qualified", "new"].includes(it.status) && requeued < 25) {
      await enqueue("radar_prep", { id: it.id, step: "behind" }, { dedupeKey: `radar_prep:${it.id}:behind:strict` });
      requeued += 1;
    }
  }

  const cos = await q<{ id: number; country: string | null; website_source: string | null; enrichment: Enrichment }>(
    `select id, country, website_source, enrichment from sales_companies
     where enrichment ?| array['public_phones','public_emails','whatsapp_number','generic_email']`,
  );
  for (const c of cos) {
    const e = { ...c.enrichment };
    let changed = false;
    const country = (e.hq_country?.v ? String(e.hq_country.v) : null) ?? c.country;
    const ph = e.public_phones?.v ? String(e.public_phones.v).split(",").map((x) => x.trim()).filter(Boolean) : [];
    const okPh = ph.filter((p) => !wrongCountry(p, country));
    if (okPh.length !== ph.length) { e.public_phones = okPh.length ? { ...e.public_phones!, v: okPh.join(", ") } : { v: null }; changed = true; }
    if (e.whatsapp_number?.v && wrongCountry(`+${digits(String(e.whatsapp_number.v))}`, country)) { e.whatsapp_number = { v: null }; changed = true; }
    const sure = c.website_source === "you" || c.website_source === "lead" || String(e.identity_match?.v ?? "") === "confirmed";
    if (!sure) {
      for (const k of ["public_phones", "public_emails", "whatsapp_number", "generic_email"]) {
        if (e[k]?.v) { e[k] = { v: null }; changed = true; }
      }
    }
    if (changed) {
      await q("update sales_companies set enrichment = $2 where id = $1", [c.id, JSON.stringify(e)]);
      companies += 1;
    }
  }
  return { radar, people, companies, requeued };
}
