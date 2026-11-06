/**
 * Google Workspace without the Google Cloud console: a small Apps Script in your own account (integrations/daybook-sales.gs)
 * pushes Gmail messages, Calendar events and Meet transcripts here every few minutes, and sends email for you on request.
 * Free, runs under your own Google login, nothing to verify with Google.
 */
import { one, q, UserError } from "../db";
import { salesConfig, salesRow } from "./config";
import { createDeal, dealForPerson, logInteraction } from "./deals";
import { emailDomain, normEmail, resolvePerson, upsertPerson } from "./identity";
import { capture } from "./ingest";
import { enqueue } from "./jobs";
import { baseUrl } from "./links";
import { push } from "./notify";
import { emailToRadar } from "./radar";
import { applyEvent, stageByRole } from "./stages";
import { esc } from "../telegram/api";

export interface GmailMsg {
  id: string;
  threadId?: string;
  from: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  body?: string;
  outbound?: boolean;
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  attendees?: { email: string; name?: string | null }[];
  description?: string;
  link?: string;
  cancelled?: boolean;
}

export interface Transcript {
  id: string;
  title: string;
  created?: string;
  text: string;
}

const AUTOMATED = /no-?reply|noreply|do-?not-?reply|notifications?@|mailer-daemon|postmaster|newsletter|digest@|bounce|billing@|invoice@|receipts?@|support@.*\.(stripe|paypal|razorpay)|calendar-notification/i;

function addresses(s: string | undefined): { email: string; name: string | null }[] {
  if (!s) return [];
  return s.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((part) => {
    const email = normEmail(part);
    const name = part.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
    return email ? { email, name: name && !name.includes("@") ? name : null } : null;
  }).filter((x): x is { email: string; name: string | null } => !!x);
}

export async function ingestGmail(msgs: GmailMsg[]): Promise<{ logged: number; radar: number; skipped: number }> {
  const cfg = await salesConfig();
  const mine = new Set(cfg.owner.emails.map((e) => e.toLowerCase()));
  let logged = 0;
  let radar = 0;
  let skipped = 0;
  for (const m of msgs) {
    const seen = await one("select 1 from sales_captures where hints->>'gmail_id' = $1 union all select 1 from sales_interactions where external_id = $2 limit 1", [m.id, `gmail:${m.id}`]);
    if (seen) {
      skipped += 1;
      continue;
    }
    const from = addresses(m.from)[0];
    const outbound = m.outbound ?? (from ? mine.has(from.email) : false);
    if (!outbound && from && (await emailToRadar(from.email, m.subject ?? "", m.body ?? "", m.id))) {
      radar += 1;
      await q("insert into sales_seen (hash) values ($1) on conflict do nothing", [`gmail:${m.id}`]);
      continue;
    }
    if (!outbound && from && AUTOMATED.test(from.email)) {
      skipped += 1;
      continue;
    }
    const counterparts = (outbound ? [...addresses(m.to), ...addresses(m.cc)] : from ? [from] : []).filter((a) => !mine.has(a.email) && !AUTOMATED.test(a.email));
    if (!counterparts.length) {
      skipped += 1;
      continue;
    }
    let personId: number | null = null;
    for (const c of counterparts) {
      const r = await resolvePerson({ email: c.email });
      if (r.person) {
        personId = r.person.id;
        break;
      }
    }
    // a known domain (another person at the same company) also counts as known
    if (!personId) {
      for (const c of counterparts) {
        const d = emailDomain(c.email);
        if (!d) continue;
        const co = await one<{ id: number }>("select id from sales_companies where lower(domain) = $1", [d]);
        if (co) {
          personId = await upsertPerson({ email: c.email, name: c.name, company_id: co.id });
          break;
        }
      }
    }
    if (!personId && cfg.unknown_email === "off") {
      skipped += 1;
      continue;
    }
    const text = `EMAIL ${outbound ? "SENT BY ME" : "RECEIVED"}\nFrom: ${m.from}\nTo: ${m.to ?? ""}${m.cc ? `\nCc: ${m.cc}` : ""}\nDate: ${m.date ?? ""}\nSubject: ${m.subject ?? ""}\n\n${stripQuoted(m.body ?? "").slice(0, 8000)}`;
    const dealId = personId ? await dealForPerson(personId) : null;
    await capture({
      source: "email",
      channel: "email",
      text,
      hints: { ...(personId ? { person_id: personId } : {}), ...(dealId ? { deal_id: dealId } : {}), direction: outbound ? "out" : "in", gmail_id: m.id, thread_id: m.threadId } as never,
    });
    logged += 1;
  }
  return { logged, radar, skipped };
}

/** Drops the quoted history below a reply so the same text is not logged again and again. */
export function stripQuoted(body: string): string {
  const cut = body.search(/\n(On .{5,120}wrote:|-{2,}\s*Original Message|From: .+\nSent: |_{5,})/i);
  return (cut > 0 ? body.slice(0, cut) : body).trim();
}

export async function ingestCalendar(events: CalEvent[]): Promise<number> {
  const cfg = await salesConfig();
  const mine = new Set(cfg.owner.emails.map((e) => e.toLowerCase()));
  let n = 0;
  for (const e of events) {
    const ext = (e.attendees ?? []).filter((a) => a.email && !mine.has(a.email.toLowerCase()) && !/resource\.calendar\.google|group\.calendar\.google/.test(a.email));
    const existing = await one<{ id: number; deal_id: number | null }>("select id, deal_id from sales_meetings where external_id = $1", [`gcal:${e.id}`]);
    let dealId = existing?.deal_id ?? null;
    let personId: number | null = null;
    for (const a of ext) {
      const r = await resolvePerson({ email: a.email });
      if (r.person) {
        personId = r.person.id;
        dealId = dealId ?? (await dealForPerson(r.person.id));
        break;
      }
    }
    let created = false;
    if (!dealId && ext.length && !e.cancelled && cfg.unknown_email !== "off" && new Date(e.start).getTime() > Date.now() - 86_400_000) {
      const a = ext[0];
      personId = await upsertPerson({ email: a.email, name: a.name ?? null });
      const disc = await stageByRole("discovery");
      dealId = await createDeal({ person_id: personId, source: "inbound", source_detail: `Calendar: ${e.title}`, stage_role: disc ? "discovery" : "new" });
      created = true;
    }
    await q(
      `insert into sales_meetings (external_id, deal_id, person_id, title, starts_at, ends_at, attendees, link, description, cancelled)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (external_id) do update set deal_id = coalesce(sales_meetings.deal_id, excluded.deal_id), person_id = coalesce(sales_meetings.person_id, excluded.person_id),
         title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at, attendees = excluded.attendees, link = excluded.link,
         description = excluded.description, cancelled = excluded.cancelled`,
      [`gcal:${e.id}`, dealId, personId, e.title.slice(0, 300), e.start, e.end ?? null, ext.map((a) => a.email), e.link ?? null, (e.description ?? "").slice(0, 4000), !!e.cancelled],
    );
    if (dealId && !e.cancelled && !existing) {
      await applyEvent(dealId, "meeting");
      await logInteraction({ deal_id: dealId, person_id: personId, channel: "meeting", direction: "internal", summary: `Meeting booked: ${e.title} on ${new Date(e.start).toISOString().slice(0, 16).replace("T", " ")} UTC`, source: "calendar", external_id: `gcal-booked:${e.id}` });
    }
    if (created && dealId) {
      await push(`📅 New meeting with someone not in Sales yet: <b>${esc(e.title)}</b> (${esc(ext[0].email)}). I made it a lead in Discovery.`, {
        inline_keyboard: [[{ text: "Open deal", url: `${baseUrl()}/sales/deal/${dealId}` }, { text: "Not a lead", callback_data: `zs:nl:${dealId}` }]],
      });
      if (personId) await enqueue("enrich_person", { id: personId }, { dedupeKey: `enrich_person:${personId}` });
    }
    n += 1;
  }
  return n;
}

export async function ingestTranscripts(items: Transcript[]): Promise<number> {
  let n = 0;
  for (const t of items) {
    const seen = await one("select 1 from sales_captures where hints->>'gmail_id' = $1", [`doc:${t.id}`]);
    if (seen || !t.text?.trim()) continue;
    const at = t.created ? new Date(t.created) : new Date();
    // match the meeting by time (Meet names the doc after the event) and by title
    const m = await one<{ id: number; deal_id: number | null }>(
      `select id, deal_id from sales_meetings where starts_at between $1::timestamptz - interval '12 hours' and $1::timestamptz + interval '2 hours'
       order by (position(lower(title) in lower($2)) > 0) desc, abs(extract(epoch from starts_at - $1::timestamptz)) limit 1`,
      [at.toISOString(), t.title],
    );
    await capture({
      source: "meet",
      channel: "meeting",
      text: `MEETING TRANSCRIPT / NOTES: ${t.title}\n\n${t.text.slice(0, 30_000)}`,
      hints: { ...(m?.deal_id ? { deal_id: m.deal_id } : {}), ...(m ? { meeting_id: m.id } : {}), direction: "both", gmail_id: `doc:${t.id}` } as never,
    });
    if (m) await q("update sales_meetings set transcript_at = now() where id = $1", [m.id]);
    n += 1;
  }
  return n;
}

export async function googleConfigured(): Promise<boolean> {
  return !!(await salesRow()).apps_script_url;
}

/** Sends an email from your own Gmail through the Apps Script web app. */
export async function sendEmail(o: { to: string; subject: string; body: string; threadId?: string | null }): Promise<{ id: string | null; threadId: string | null }> {
  const row = await salesRow();
  if (!row.apps_script_url) throw new UserError("Connect Google first (Sales settings, Google), or use the mail link instead.");
  const cfg = await salesConfig();
  const body = o.body.includes(cfg.owner.signature.split("\n")[0]) ? o.body : `${o.body}\n\n${cfg.owner.signature}`;
  const res = await fetch(row.apps_script_url, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret: row.google_secret, action: "send", to: o.to, subject: o.subject, body, threadId: o.threadId ?? null }),
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let parsed: { ok?: boolean; id?: string; threadId?: string } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  if (parsed.ok !== true) throw new UserError(`Google did not send it: ${text.slice(0, 160)}`);
  return { id: parsed.id ?? null, threadId: parsed.threadId ?? null };
}

export async function alertDomains(): Promise<string[]> {
  const rows = await q<{ d: string }>("select distinct jsonb_array_elements_text(config->'domains') as d from sales_radar_sources where kind = 'email' and enabled");
  return rows.map((r) => r.d);
}
