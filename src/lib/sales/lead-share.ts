/**
 * Share a radar lead: everything the radar knows about it in one go, ready to copy, send on WhatsApp, email, download,
 * hand to Claude for more research, or send to your own Telegram to forward anywhere.
 *
 * One dossier is gathered (the post, who posted it, the business behind it and other possible businesses, the decision
 * maker and every contact, the company research with its sources, the people found, the plain-words brief, the drafted
 * message, the trip, meetings and links) and written four ways:
 *   full      every section, for notes, email or a teammate
 *   whatsapp  the essentials in WhatsApp formatting, short enough to send
 *   claude    the full text with instructions to verify, research further and advise, never inventing contacts
 *   json      the same facts as data, for Claude or another tool
 * Facts keep their source link where the research recorded one, and estimates say so.
 */
import { one, q, UserError } from "../db";
import { getSettings } from "../settings";
import { noDashes } from "../text/no-dashes";
import { calendarDate } from "../time";
import type { Identity } from "./behind-post";
import { salesConfig } from "./config";
import type { Poster } from "./radar";
import type { RadarBrief } from "./radar-brief";
import type { Pack, Prep } from "./radar-prep";
import { radarQuickLinks } from "./quick-links";
import { COMPANY_FIELDS, PERSON_FIELDS, type Enrichment } from "./research-fields";
import { meetingOptions, tripFor } from "./targets";

export interface LeadDossier {
  id: number;
  title: string;
  url: string | null;
  score: number | null;
  status: string;
  kind: string;
  source: string | null;
  target: string | null;
  posted_at: string | null;
  found_at: string;
  post: string | null;
  poster: Poster | null;
  author: string | null;
  identity: Identity | null;
  pack: Pack | null;
  prep_steps: { step: string; ok: boolean; note: string }[];
  company: { name: string; website: string | null; facts: { group: string; label: string; value: string; source: string | null; estimate: boolean }[] } | null;
  people: { name: string; title: string | null; emails: string[]; phones: string[]; linkedin: string | null; decision_maker: boolean; facts: { label: string; value: string; source: string | null }[] }[];
  brief: RadarBrief | null;
  fit: Record<string, unknown> | null;
  draft: { channel: string | null; subject: string | null; message: string } | null;
  trip: { city: string; from: string; to: string; meeting_options: string[] } | null;
  meetings: { at: string; title: string; place: string | null }[];
  known: { why: string; deal_title: string | null; stage: string | null } | null;
  blocked: string | null;
  links: { group: string; label: string; value: string | null; href: string }[];
}

const s = (x: unknown) => (x === null || x === undefined || x === "" ? null : String(x));

/** Everything the radar knows about one lead. */
export async function leadDossier(itemId: number): Promise<LeadDossier> {
  const it = await one<{
    id: number; title: string; body: string | null; url: string | null; score: number | null; status: string; lead_kind: string | null; posted_at: string | null; found_at: string;
    poster: Poster | null; author: string | null; identity: Identity | null; brief: RadarBrief | null; fit: Record<string, unknown> | null; prep: Prep | null;
    known: { why: string; deal_title: string | null; stage: string | null } | null; blocked: string | null; company_id: number | null; source: string | null; hunt: string | null;
  }>(
    `select r.*, s.name as source, h.name as hunt from sales_radar_items r
     left join sales_radar_sources s on s.id = r.source_id left join sales_hunts h on h.id = r.hunt_id where r.id = $1`,
    [itemId],
  );
  if (!it) throw new UserError("That lead no longer exists.");
  const tz = (await getSettings()).timezone;

  const co = it.company_id
    ? await one<{ name: string; website: string | null; enrichment: Enrichment | null }>("select name, website, enrichment from sales_companies where id = $1", [it.company_id])
    : null;
  const company = co
    ? {
        name: co.name, website: co.website,
        facts: COMPANY_FIELDS.flatMap((g) => g.fields.flatMap(([k, label]) => {
          const f = co.enrichment?.[k];
          const v = f ? s(f.v) : null;
          return v ? [{ group: g.group, label, value: v.slice(0, 800), source: s(f!.src), estimate: !!f!.est }] : [];
        })),
      }
    : null;
  const peopleRows = it.company_id
    ? await q<{ full_name: string; title: string | null; emails: string[]; phones: string[]; linkedin: string | null; is_decision_maker: boolean | null; enrichment: Enrichment | null }>(
        "select full_name, title, emails, phones, linkedin, is_decision_maker, enrichment from sales_people where company_id = $1 order by (is_decision_maker is true) desc, id limit 10",
        [it.company_id])
    : [];
  const people = peopleRows.map((p) => ({
    name: p.full_name, title: p.title, emails: p.emails ?? [], phones: p.phones ?? [], linkedin: p.linkedin, decision_maker: !!p.is_decision_maker,
    facts: PERSON_FIELDS.flatMap((g) => g.fields.flatMap(([k, label]) => {
      const f = p.enrichment?.[k];
      const v = f ? s(f.v) : null;
      return v ? [{ label, value: v.slice(0, 400), source: s(f!.src) }] : [];
    })).slice(0, 12),
  }));

  const mv = await one<{ draft: string | null; draft_subject: string | null; channel: string | null }>(
    "select draft, draft_subject, channel from sales_moves where dedupe_key = $1 order by id desc limit 1", [`radar:${itemId}`]);
  const t = await tripFor(itemId);
  const today = calendarDate(new Date(), tz);
  const meetings = await q<{ at: string; title: string; place: string | null }>(
    "select to_char(starts_at at time zone $2, 'YYYY-MM-DD HH24:MI') as at, title, place from sales_meetings where radar_item_id = $1 and not cancelled order by starts_at",
    [itemId, tz]);
  const links = ((await radarQuickLinks([itemId]))[itemId] ?? []).flatMap((g) => g.links.map((l) => ({ group: g.title, label: l.label, value: l.value, href: l.href })));

  return {
    id: it.id, title: it.title, url: it.url, score: it.score, status: it.status, kind: it.lead_kind ?? "post", source: it.source, target: it.hunt,
    posted_at: it.posted_at ? new Date(it.posted_at).toISOString() : null, found_at: new Date(it.found_at).toISOString(),
    post: it.body, poster: it.poster, author: it.author, identity: it.identity, pack: it.prep?.pack ?? null,
    prep_steps: Object.entries(it.prep?.steps ?? {}).map(([step, v]) => ({ step, ok: !!v?.ok, note: v?.note ?? "" })),
    company, people, brief: it.brief, fit: it.fit,
    draft: mv?.draft ? { channel: mv.channel, subject: mv.draft_subject, message: mv.draft } : null,
    trip: t ? { city: t.city, from: t.trip_from, to: t.trip_to, meeting_options: meetingOptions(t.trip_from, t.trip_to, today) } : null,
    meetings, known: it.known ? { why: it.known.why, deal_title: it.known.deal_title, stage: it.known.stage } : null, blocked: it.blocked, links,
  };
}

// ------------------------------------------------------------------ writing it out

const when = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null);
const line = (label: string, v: unknown) => (s(v) ? `${label}: ${s(v)}` : null);
const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join("\n");
const listOf = (xs: string[] | undefined | null) => (xs?.length ? xs.join(", ") : null);

/** Every contact found, from every place, once. Pure. */
export function allContacts(d: Pick<LeadDossier, "identity" | "pack" | "people">): { emails: string[]; phones: string[]; linkedin: string[] } {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const linkedin = new Set<string>();
  for (const e of [...(d.identity?.emails ?? []), ...(d.pack?.contacts.emails ?? []), d.pack?.decision_maker?.email ?? "", ...d.people.flatMap((p) => p.emails)]) if (e) emails.add(e.toLowerCase());
  for (const p of [...(d.identity?.phones ?? []), ...(d.pack?.contacts.phones ?? []), d.pack?.decision_maker?.phone ?? "", ...d.people.flatMap((x) => x.phones)]) if (p) phones.add(p);
  for (const l of [d.identity?.linkedin, d.pack?.decision_maker?.linkedin, d.pack?.contacts.linkedin, ...d.people.map((p) => p.linkedin)]) if (l) linkedin.add(l);
  return { emails: [...emails], phones: [...phones], linkedin: [...linkedin] };
}

/** The whole lead as plain text with headings (also valid Markdown). Pure. */
export function dossierText(d: LeadDossier, tz = "Asia/Kolkata"): string {
  const f = (d.fit ?? {}) as Record<string, string | string[] | null>;
  const b = d.brief;
  const c = allContacts(d);
  const p = d.poster;
  const id = d.identity;
  const out: string[] = [];
  const sec = (title: string, body: string | null) => { if (body && body.trim()) out.push(`## ${title}\n${body.trim()}`); };

  out.push(join([
    `# ${d.title}`,
    line("Fit score", d.score != null ? `${d.score}/100` : null),
    line(d.posted_at ? "Posted" : "Found", when(d.posted_at ?? d.found_at, tz)),
    line("Where", [d.kind === "prospect" ? "Local business found for a target (nobody posted this)" : d.kind === "news" ? "Local news" : null, d.source].filter(Boolean).join(" · ") || null),
    line("Target", d.target),
    line("Link", d.url),
    line("Country / industry", [f.country, f.industry].filter(Boolean).join(" · ") || null),
  ]));

  sec("Reach them", join([
    line("Emails", listOf(c.emails)), line("Phones", listOf(c.phones)), line("LinkedIn", listOf(c.linkedin)),
    line("WhatsApp", d.pack?.contacts.whatsapp), line("Contact page", d.pack?.contacts.contact_page),
    !c.emails.length && !c.phones.length && !c.linkedin.length ? "No direct contact found yet." : null,
  ]));

  sec("Who posted it", join([
    line("Name", p?.name ?? d.author), line("Username", p?.username), line("Location", [p?.city, p?.country].filter(Boolean).join(", ") || null),
    line("Profile", p?.profile_url), line("Member since", p?.joined), line("History", p?.history),
  ]));

  if (id && id.status !== "running") {
    sec("The business behind it", join([
      line("Company", id.company), line("Website", id.website), line("Person", [id.person, id.title].filter(Boolean).join(", ") || null),
      line("Emails", listOf(id.emails)), line("Phones", listOf(id.phones)), line("LinkedIn", id.linkedin),
      line("How sure", id.confidence), line("Note", id.note),
      id.evidence?.length ? `Evidence:\n${id.evidence.slice(0, 8).map((e) => `- ${e.says} (${e.url})`).join("\n")}` : null,
      id.candidates?.length ? `Other businesses it could be:\n${id.candidates.map((x) => `- ${x.company}${x.location ? `, ${x.location}` : ""} (${x.confidence})${x.person ? `, ${x.person}` : ""}: ${x.why}${x.website ? ` ${x.website}` : ""}${x.evidence_url ? ` [source: ${x.evidence_url}]` : ""}`).join("\n")}` : null,
    ]));
  }

  const pk = d.pack;
  if (pk) {
    sec("Decision maker", pk.decision_maker ? join([
      `${pk.decision_maker.name}${pk.decision_maker.title ? `, ${pk.decision_maker.title}` : ""}`,
      line("Email", pk.decision_maker.email), line("Phone", pk.decision_maker.phone), line("LinkedIn", pk.decision_maker.linkedin), line("Why them", pk.decision_maker.why),
    ]) : null);
    sec("Company at a glance", pk.company ? join([
      line("Name", pk.company.name), line("Website", pk.company.website), line("What they do", pk.company.what_they_do ?? pk.company.summary),
      line("Size", pk.company.size), line("Location", pk.company.location), line("Revenue", pk.company.revenue), line("Budget", pk.company.budget), line("Founded", pk.company.founded),
    ]) : null);
    sec("Insights", pk.insights.map((x) => `- ${x.label}: ${x.text}`).join("\n"));
    sec("Other people there", pk.others.map((x) => `- ${x.name}${x.title ? `, ${x.title}` : ""}${x.email ? ` · ${x.email}` : ""}${x.linkedin ? ` · ${x.linkedin}` : ""}`).join("\n"));
  }

  if (d.company?.facts.length) {
    const groups = [...new Set(d.company.facts.map((x) => x.group))];
    sec(`Company research: ${d.company.name}`, groups.map((g) => `${g}:\n${d.company!.facts.filter((x) => x.group === g).map((x) => `- ${x.label}: ${x.value}${x.estimate ? " (estimate)" : ""}${x.source ? ` [source: ${x.source}]` : ""}`).join("\n")}`).join("\n\n"));
  }
  if (d.people.length) {
    sec("People found", d.people.map((x) => join([
      `- ${x.name}${x.title ? `, ${x.title}` : ""}${x.decision_maker ? " (decision maker)" : ""}`,
      x.emails.length ? `  Emails: ${x.emails.join(", ")}` : null, x.phones.length ? `  Phones: ${x.phones.join(", ")}` : null, x.linkedin ? `  LinkedIn: ${x.linkedin}` : null,
      ...x.facts.map((y) => `  ${y.label}: ${y.value}${y.source ? ` [source: ${y.source}]` : ""}`),
    ])).join("\n"));
  }

  sec("What they need", join([
    b?.need ?? s(f.need) ?? s(f.why),
    b?.deliverables?.length ? b.deliverables.map((x) => `- ${x}`).join("\n") : null,
    line("Budget", b?.budget ?? f.budget), line("Timing", b?.timing), line("Size of the job", b?.size), line("Urgency", f.urgency),
  ]));
  sec("How we can help", join([
    b?.help?.length ? b.help.map((x, i) => `${i + 1}. ${x}`).join("\n") : s(f.help),
    line("Offers that fit", listOf(b?.offers?.length ? b.offers : (f.services as string[] | null))),
    line("Open with", b?.opener ?? f.angle), line("Why it fits", f.why), line("What the problem costs them", f.money_leak),
  ]));
  sec("Ask them", b?.questions?.length ? b.questions.map((x) => `- ${x}`).join("\n") : null);
  sec("Watch out", b?.watch_out ?? null);

  if (d.trip) sec("Trip", join([`You are in ${d.trip.city} ${d.trip.from} to ${d.trip.to}.`, d.trip.meeting_options.length ? `Meeting times to offer: ${d.trip.meeting_options.join(" or ")}` : null]));
  sec("Meetings booked", d.meetings.map((m) => `- ${m.at}: ${m.title}${m.place ? ` (${m.place})` : ""}`).join("\n"));
  sec("Drafted message", d.draft ? join([line("For", d.draft.channel), line("Subject", d.draft.subject), "", d.draft.message]) : null);
  sec("Already known to you", d.known ? `${d.known.why}${d.known.deal_title ? `: ${d.known.deal_title}${d.known.stage ? `, ${d.known.stage}` : ""}` : ""}` : null);
  sec("Do not contact", d.blocked);
  sec("Links", d.links.map((l) => `- ${l.group}: ${l.label}${l.value && l.value !== l.label ? ` (${l.value})` : ""} ${l.href}`).join("\n"));
  sec(d.kind === "prospect" ? "What we found about them" : "Their post, word for word", d.post);
  sec("What the radar did", d.prep_steps.map((x) => `- ${x.step}: ${x.ok ? "done" : "not found"}. ${x.note}`).join("\n"));
  out.push(`From Daybook radar, lead #${d.id}.`);
  return noDashes(out.join("\n\n"));
}

/** The essentials in WhatsApp formatting (bold with *), short enough to send in one message. Pure. */
export function whatsappText(d: LeadDossier): string {
  const f = (d.fit ?? {}) as Record<string, string | string[] | null>;
  const b = d.brief;
  const c = allContacts(d);
  const dm = d.pack?.decision_maker;
  const co = d.pack?.company?.name ?? d.identity?.company ?? d.company?.name ?? null;
  const parts = [
    `*${d.title.slice(0, 160)}*${d.score != null ? `\nFit ${d.score}/100` : ""}${d.target ? ` · ${d.target}` : ""}`,
    co || d.poster?.name ? `*Who:* ${[dm ? `${dm.name}${dm.title ? ` (${dm.title})` : ""}` : d.identity?.person ?? d.poster?.name ?? null, co].filter(Boolean).join(", ")}${d.poster?.city ? `, ${[d.poster.city, d.poster.country].filter(Boolean).join(", ")}` : ""}` : null,
    c.emails.length || c.phones.length || c.linkedin.length ? `*Reach:* ${[...c.emails.slice(0, 2), ...c.phones.slice(0, 2), ...c.linkedin.slice(0, 1)].join(" · ")}` : null,
    b?.need ?? s(f.need) ? `*Need:* ${(b?.need ?? s(f.need))!.slice(0, 400)}` : null,
    b?.help?.length ? `*How we help:*\n${b.help.slice(0, 3).map((x) => `- ${x}`).join("\n")}` : s(f.why) ? `*Why it fits:* ${s(f.why)}` : null,
    b?.budget ?? f.budget ? `*Budget:* ${b?.budget ?? f.budget}` : null,
    d.trip ? `*Trip:* ${d.trip.city} ${d.trip.from} to ${d.trip.to}` : null,
    d.url ? `*Link:* ${d.url}` : null,
    d.post ? `*Post:* ${d.post.replace(/\s+/g, " ").slice(0, 500)}${d.post.length > 500 ? "..." : ""}` : null,
  ];
  return noDashes(parts.filter(Boolean).join("\n\n")).slice(0, 3500);
}

/** The whole lead for Claude, with what to do and the rule not to invent anything. */
export function claudeText(d: LeadDossier, owner: { name: string; title: string; company: string; website: string; offers: string[] }, tz = "Asia/Kolkata"): string {
  const channel = d.draft?.channel ?? (allContacts(d).emails.length ? "email" : "the platform where they posted");
  return noDashes(`I am ${owner.name}, ${owner.title} of ${owner.company} (${owner.website}). What we offer: ${owner.offers.join("; ")}.
Below is everything my lead radar knows about one lead. Please help me with it:
1. Separate what is verified (has a source) from what is guessed or missing.
2. Research the business and the decision maker further: their website, LinkedIn, recent news, size, and anything that shows the need.
3. Tell me plainly whether it is worth pursuing, and why.
4. Suggest the best person, channel and moment to reach them, and what to lead with.
5. Write a short first message for ${channel} in my voice: specific to what they need, no hype, one easy next step.
Never invent names, emails, phone numbers or facts. If you cannot find something, say so.

${dossierText(d, tz)}`);
}

export interface LeadShare { title: string; full: string; whatsapp: string; claude: string; json: string; filename: string }

/** All four ways to share a lead, at once. */
export async function leadShare(itemId: number): Promise<LeadShare> {
  const [d, cfg, settings] = await Promise.all([leadDossier(itemId), salesConfig(), getSettings()]);
  const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || `lead-${d.id}`;
  return {
    title: d.title,
    full: dossierText(d, settings.timezone),
    whatsapp: whatsappText(d),
    claude: claudeText(d, { ...cfg.owner, offers: cfg.offers }, settings.timezone),
    json: JSON.stringify(d, null, 2),
    filename: `lead-${d.id}-${slug}.md`,
  };
}

/** Sends the full lead to your own Telegram, in parts if long, so you can forward it anywhere. */
export async function sendLeadToTelegram(itemId: number): Promise<number> {
  const { push } = await import("./notify");
  const { esc } = await import("../telegram/api");
  const sh = await leadShare(itemId);
  const parts: string[] = [];
  let cur = "";
  for (const block of sh.full.split("\n\n")) {
    if ((cur + block).length > 3500 && cur) { parts.push(cur); cur = ""; }
    cur += `${block}\n\n`;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts.slice(0, 8)) await push(esc(p.trim()));
  return Math.min(parts.length, 8);
}
