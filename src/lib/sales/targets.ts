/**
 * Targets and trips: hunts aimed at a place, an industry or anything else you want, run on your schedule.
 *
 * A trip is a target with dates you will be in a city ("Udaipur, 29 Nov to 2 Dec"). It starts searching the day you add
 * it and stops the day the trip ends. Besides posts asking for help, it finds local businesses that fit your offers
 * (each one grounded in a search result, never invented) and local news (new openings, expansions). Every lead it finds
 * is prepared like any other radar lead, and the message asks to meet in person on a day you are there, with two
 * concrete options. Meetings you book from a lead show on the trip's day-by-day plan.
 */
import { one, q, UserError } from "../db";
import { getSettings } from "../settings";
import { addDays, calendarDate, diffDays, fmtDateShort, fmtRange, isoDow, weekdayName, zonedInstant, type DateStr } from "../time";
import { salesConfig } from "./config";
import { logInteraction } from "./deals";
import { llmConfigured, llmJson } from "./llm";
import { fetchFeed, geminiSearchReady, groundedResearch, webSearch, type SearchHit } from "./search";
import type { HuntInput, HuntRow } from "./hunts";

export type TripPhase = "upcoming" | "visiting" | "over" | "none";

/** Where a trip stands on a given day, in words. Pure. */
export function tripPhase(h: Pick<HuntRow, "kind" | "trip_from" | "trip_to">, today: DateStr): { phase: TripPhase; label: string; days: number | null } {
  if (h.kind !== "trip" || !h.trip_from || !h.trip_to) return { phase: "none", label: "", days: null };
  const from = String(h.trip_from).slice(0, 10);
  const to = String(h.trip_to).slice(0, 10);
  if (today > to) return { phase: "over", label: "Trip over", days: null };
  if (today >= from) return { phase: "visiting", label: today === to ? "Last day there" : "You are there now", days: 0 };
  const n = diffDays(from, today);
  return { phase: "upcoming", label: n === 1 ? "Trip tomorrow" : `Trip in ${n} days`, days: n };
}

/**
 * Two meeting options for the message, on working days of the visit (Sunday only when nothing else fits), a morning
 * and an afternoon, so the reply can be a one-word yes. Pure.
 */
export function meetingOptions(from: DateStr, to: DateStr, today: DateStr): string[] {
  const start = from > today ? from : addDays(today, 1);
  const days: DateStr[] = [];
  for (let d = start; d <= to && days.length < 10; d = addDays(d, 1)) days.push(d);
  if (!days.length) return [];
  const work = days.filter((d) => isoDow(d) !== 7);
  const pool = work.length ? work : days;
  const label = (d: DateStr) => `${weekdayName(d)} ${fmtDateShort(d)}`;
  if (pool.length === 1) return [`${label(pool[0])} morning`, `${label(pool[0])} afternoon`];
  // the first full day there and the next working day: arriving days are often lost to travel
  const a = pool.length >= 3 ? pool[1] : pool[0];
  const b = pool[pool.indexOf(a) + 1] ?? pool[0];
  return [`${label(a)} around 11:00`, `${label(b)} around 16:00`];
}

/** The place a target aims at, in one phrase. Pure. */
export function placeOf(h: Pick<HuntRow, "cities" | "countries">): string {
  const c = h.cities.join(", ");
  const k = h.countries.join(", ");
  return [c, k].filter(Boolean).join(", ");
}

/** True when an item mentions a word you said to skip. Pure. */
export function isExcluded(exclude: string[], text: string): boolean {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  // whole words, so "app" never drops a post about a "happy" client
  return exclude.some((w) => {
    const k = w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return k.length >= 2 && t.includes(` ${k} `);
  });
}

// ------------------------------------------------------------------ one line in, a target out

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "29 Nov", "Nov 29", "29/11", "2026-11-29" after `today` (next occurrence). Pure. */
export function parseDay(s: string, today: DateStr): DateStr | null {
  const t = s.trim().toLowerCase();
  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  if (!r && (r = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?$/))) [d, m, y] = [Number(r[1]), MONTHS[r[2].slice(0, 4) === "sept" ? "sept" : r[2].slice(0, 3)] ?? null, r[3] ? Number(r[3]) : null];
  if (!r && (r = t.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/))) [m, d, y] = [MONTHS[r[1].slice(0, 3)] ?? null, Number(r[2]), r[3] ? Number(r[3]) : null];
  if (!r && (r = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/))) [d, m, y] = [Number(r[1]), Number(r[2]), r[3] ? Number(r[3].length === 2 ? `20${r[3]}` : r[3]) : null];
  if (!m || !d || m > 12 || d > 31) return null;
  const ty = Number(today.slice(0, 4));
  const mk = (yy: number) => `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (y) return mk(y);
  return mk(ty) >= today ? mk(ty) : mk(ty + 1);
}

/**
 * The plain-words fallback when no AI is available: dates ("29 Nov to 2 Dec", "in 15 days for 4 days"), the city after
 * "to", "in" or "visiting", and whether it is a trip. Pure.
 */
export function parseTargetLine(text: string, today: DateStr): HuntInput {
  const t = text.replace(/\s+/g, " ").trim();
  const day = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(?:,?\s+\d{4})?|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)`;
  let from: DateStr | null = null;
  let to: DateStr | null = null;
  const range = t.match(new RegExp(`${day}\\s*(?:to|till|until|through|and|-|\\u2013)\\s*${day}`, "i"));
  if (range) {
    from = parseDay(range[1], today);
    to = from ? parseDay(range[2], from) : null;
  }
  const inDays = t.match(/\bin (\d{1,3}) days?\b/i);
  if (!from && inDays) from = addDays(today, Number(inDays[1]));
  const forDays = t.match(/\bfor (\d{1,2}) days?\b/i);
  if (from && !to) to = addDays(from, Math.max(0, (forDays ? Number(forDays[1]) : 3) - 1));
  const city = t.match(/\b(?:travel(?:l)?ing to|going to|visiting|trip to|to|in)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/)?.[1] ?? null;
  const trip = !!(from && to) || /\b(trip|travel|visit|visiting|going to)\b/i.test(t);
  const industries = t.match(/\b(?:industr(?:y|ies)|domain|sector)s?:?\s+([^.;]+)/i)?.[1]?.split(/,|\band\b/).map((x) => x.trim()).filter(Boolean) ?? [];
  return {
    name: trip && city ? `${city} trip` : city ? `${city} leads` : t.slice(0, 60),
    kind: trip && from && to ? "trip" : "standing",
    cities: city ? [city] : [],
    industries,
    brief: t,
    trip_from: trip ? from : null,
    trip_to: trip ? to : null,
    meet: trip,
    prospects: !!city,
  };
}

interface Parsed {
  name?: string; kind?: "trip" | "standing"; region?: string | null; cities?: string[]; countries?: string[]; industries?: string[]; keywords?: string[]; exclude?: string[];
  brief?: string; trip_from?: string | null; trip_to?: string | null; meet?: boolean; prospects?: boolean; signals?: string[];
}

/** "I'm in Udaipur from 29 Nov to 2 Dec, want hotels and wedding planners" into a target you can check and save. */
export async function parseTarget(text: string): Promise<HuntInput & { by: "ai" | "rules" }> {
  const line = text.trim().slice(0, 1500);
  if (!line) throw new UserError("Say what you want to target, for example: Udaipur, 29 Nov to 2 Dec, hotels and wedding planners.");
  const today = calendarDate(new Date(), (await getSettings()).timezone);
  const rules = parseTargetLine(line, today);
  if (!llmConfigured()) return { ...rules, by: "rules" };
  const cfg = await salesConfig();
  try {
    const p = await llmJson<Parsed>(
      `You turn one line from ${cfg.owner.name} (who runs ${cfg.owner.company}, offers: ${cfg.offers.join("; ")}) into a lead-finding target.
Today is ${today} (${weekdayName(today)}). Return JSON:
{"name": short name like "Udaipur trip" or "Dubai real estate",
 "kind": "trip" when they will be somewhere on set dates, else "standing",
 "cities": [cities named], "countries": [the country of each city, or countries named], "region": the state or province of the first city (e.g. "Rajasthan"), else null,
 "industries": [industries or domains named; for a trip with none named, pick 3 to 5 that are big in that city and fit the offers, e.g. hotels for a tourist city],
 "keywords": [exact phrases they asked to search, else []], "exclude": [things they said to skip, else []],
 "brief": who to find, 1 to 3 plain sentences, mentioning the place and the dates when given,
 "trip_from": "YYYY-MM-DD" or null, "trip_to": "YYYY-MM-DD" or null (a trip with a start but no end lasts 3 days; "in 15 days" counts from today),
 "meet": true when they want to meet people in person (always true for a trip),
 "prospects": true when finding local businesses (not only posts) helps; true for any city target,
 "signals": any of ["requirement","hiring","funding","review","tender","launch"]}.
Only use what the line says or plain facts about the place. Never invent dates.`,
      line,
      { maxTokens: 900, totalMs: 20_000 },
    );
    const date = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean) : []);
    const trip = p.kind === "trip" && !!date(p.trip_from) && !!date(p.trip_to);
    return {
      name: String(p.name ?? rules.name ?? "").slice(0, 80),
      kind: trip ? "trip" : "standing",
      cities: arr(p.cities).length ? arr(p.cities) : rules.cities,
      countries: arr(p.countries),
      region: typeof p.region === "string" && p.region.trim() ? p.region.trim().slice(0, 80) : null,
      industries: arr(p.industries).length ? arr(p.industries) : rules.industries,
      keywords: arr(p.keywords),
      exclude: arr(p.exclude),
      brief: String(p.brief ?? line).slice(0, 2000),
      trip_from: trip ? date(p.trip_from) : null,
      trip_to: trip ? date(p.trip_to) : null,
      meet: trip || !!p.meet,
      prospects: p.prospects !== false && (arr(p.cities).length > 0 || rules.cities!.length > 0),
      signals: arr(p.signals).length ? arr(p.signals) : undefined,
      by: "ai",
    };
  } catch {
    return { ...rules, by: "rules" };
  }
}

// ------------------------------------------------------------------ local businesses for a place (prospects)

export interface Prospect { company: string; website: string | null; why: string; evidence_url: string; evidence: string; industry: string | null }

const DIRECTORY = /(justdial|sulekha|indiamart|tripadvisor|booking\.com|makemytrip|goibibo|yelp|facebook|instagram|linkedin|zomato|swiggy|google\.|maps\.|wikipedia|youtube|weddingwire|wedmegood|yellowpages|asklaila|magicpin|agoda|expedia|trivago|quora|reddit)/i;
const hostOf = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];

/**
 * Keeps only businesses the search results really name, with a website only when it appears in them, never the
 * same business twice and never one already on the radar. Pure.
 */
export function groundProspects(list: Partial<Prospect>[], hits: SearchHit[], known: string[] = []): Prospect[] {
  const hay = hits.map((h) => `${h.title}\n${h.snippet}\n${h.url}`).join("\n").toLowerCase();
  const seen = new Set(known.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const out: Prospect[] = [];
  for (const p of list) {
    const name = String(p.company ?? "").trim();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (name.length < 3 || !hay.includes(name.toLowerCase()) || seen.has(key)) continue;
    const host = p.website ? hostOf(String(p.website)) : "";
    const website = host && hay.includes(host) && !DIRECTORY.test(host) ? `https://${host}` : null;
    // the page that names it: the one given when it really names it, else the first that does
    const named = hits.filter((h) => `${h.title}\n${h.snippet}`.toLowerCase().includes(name.toLowerCase()));
    const ev = named.find((h) => h.url === p.evidence_url) ?? named[0] ?? hits.find((h) => website && h.url.includes(host));
    if (!ev) continue;
    seen.add(key);
    out.push({ company: name, website, why: String(p.why ?? "").slice(0, 300), evidence_url: ev.url, evidence: `${ev.title}: ${ev.snippet}`.slice(0, 500), industry: p.industry ? String(p.industry).slice(0, 60) : null });
  }
  return out;
}

/** The searches that surface local businesses of one industry in one city. Pure. */
export function prospectQueries(city: string, country: string | null, industry: string): string[] {
  const place = country ? `${city} ${country}` : city;
  return [`${industry} in ${place}`, `best ${industry} ${city} contact website`, `${city} ${industry} new opening OR expansion OR hiring`];
}

/** One city and industry: search, ask the AI which businesses the results name, keep only grounded ones. */
export async function findProspects(h: HuntRow, salt: number, budgetMs: number): Promise<Prospect[]> {
  if (!h.cities.length) return [];
  const deadline = Date.now() + budgetMs;
  const industries = h.industries.length ? h.industries : ["local businesses"];
  const city = h.cities[salt % h.cities.length];
  const industry = industries[Math.floor(salt / h.cities.length) % industries.length];
  const country = h.countries[0] ?? null;
  const lists = await Promise.allSettled(prospectQueries(city, country, industry).map((x) => webSearch(x, 8, `target: ${h.name}`)));
  const hits: SearchHit[] = lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (geminiSearchReady() && Date.now() < deadline - 25_000) {
    const g = await groundedResearch(
      `Find up to 10 real, currently operating ${industry} businesses in ${city}${country ? `, ${country}` : ""}. For each give the exact business name and its own website if it has one. Only businesses the search shows.`,
      { timeoutMs: Math.min(30_000, deadline - Date.now() - 15_000), label: `target: ${h.name}` },
    ).catch(() => null);
    if (g) hits.push(...g.sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })));
  }
  if (!hits.length || !llmConfigured()) return [];
  const known = (await q<{ title: string }>("select title from sales_radar_items where hunt_id = $1 and lead_kind = 'prospect'", [h.id])).map((r) => r.title.replace(/,.*$/, ""));
  const cfg = await salesConfig();
  const out = await llmJson<{ businesses?: Partial<Prospect>[] } | Partial<Prospect>[]>(
    `From the search results ONLY, list real businesses located in ${city} in or near "${industry}" that ${cfg.owner.company} could help (offers: ${cfg.offers.join("; ")}).
Rules: the name exactly as the results write it; "website" only when the business's own site appears in the results, else null; "evidence_url" the result URL that names it;
"why" one plain line on what the offers could do for this kind of business (missed enquiries, bookings, WhatsApp replies, follow-ups, reviews), honest and specific;
skip lists, directories, aggregators, government pages, chains' head offices elsewhere and anything outside ${city}. Never invent a business.
Return {"businesses": [{"company","website","evidence_url","why","industry"}]} with at most 8.`,
    hits.slice(0, 30).map((x, i) => `#${i + 1} ${x.title}\n${x.url}\n${x.snippet}`).join("\n\n"),
    { maxTokens: 1800, totalMs: Math.max(10_000, Math.min(25_000, deadline - Date.now() - 3_000)) },
  ).catch(() => []);
  return groundProspects(Array.isArray(out) ? out : out.businesses ?? [], hits, known);
}

/** Local news for a target's cities (new openings, expansions, funding): free, no search credits. */
export async function cityNews(h: HuntRow): Promise<{ title: string; url: string; body: string; date: string | null }[]> {
  const out: { title: string; url: string; body: string; date: string | null }[] = [];
  const india = h.countries.some((c) => /india/i.test(c));
  for (const city of h.cities.slice(0, 2)) {
    const topic = h.industries.length ? ` (${h.industries.slice(0, 3).map((i) => `"${i}"`).join(" OR ")})` : "";
    const query = `"${city}" (opens OR launches OR expands OR inaugurates OR "new branch" OR raises)${topic} when:14d`;
    const ed = india ? "hl=en-IN&gl=IN&ceid=IN:en" : "hl=en-US&gl=US&ceid=US:en";
    const items = await fetchFeed(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${ed}`).catch(() => []);
    out.push(...items.slice(0, 12));
  }
  return out;
}

// ------------------------------------------------------------------ the trip in drafts and meetings

export interface TripInfo { hunt_id: number; name: string; city: string; trip_from: DateStr; trip_to: DateStr; meet: boolean }

/** The trip a radar lead belongs to, when it came from one that has not ended. */
export async function tripFor(itemId: number): Promise<TripInfo | null> {
  const r = await one<{ hunt_id: number; name: string; cities: string[]; trip_from: string; trip_to: string; meet: boolean }>(
    `select h.id as hunt_id, h.name, h.cities, to_char(h.trip_from, 'YYYY-MM-DD') as trip_from, to_char(h.trip_to, 'YYYY-MM-DD') as trip_to, h.meet
     from sales_radar_items r join sales_hunts h on h.id = r.hunt_id where r.id = $1 and h.kind = 'trip' and h.trip_from is not null and h.trip_to >= current_date`,
    [itemId],
  );
  return r ? { hunt_id: r.hunt_id, name: r.name, city: r.cities[0] ?? r.name, trip_from: r.trip_from, trip_to: r.trip_to, meet: r.meet } : null;
}

/** The lines a draft gets for a trip lead: when you are there and two concrete meeting options. Pure. */
export function tripDraftLines(t: TripInfo, today: DateStr, owner: string): string {
  if (!t.meet) return "";
  const opts = meetingOptions(t.trip_from, t.trip_to, today);
  if (!opts.length) return "";
  return `IN PERSON: ${owner} will be in ${t.city} ${fmtRange(t.trip_from, t.trip_to)}. Ask for a short in-person meeting (about 20 minutes, at their place) during the visit, offering exactly these two options: ${opts.join(" or ")}. Keep it easy to say yes to, and say a call works too if neither suits. Do not make the visit sound like it is only for them.\n`;
}

/** Books a meeting with a radar lead: the lead becomes a deal (if it is not one yet), the meeting goes on the trip plan. */
export async function bookLeadMeeting(itemId: number, date: DateStr, time: string, o: { minutes?: number; place?: string | null; note?: string | null } = {}): Promise<{ deal_id: number; meeting_id: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new UserError("Pick a date and a time.");
  const it = await one<{ id: number; title: string; deal_id: number | null; identity: { company?: string | null } | null }>("select id, title, deal_id, identity from sales_radar_items where id = $1", [itemId]);
  if (!it) throw new UserError("That lead no longer exists.");
  const { radarToDeal } = await import("./radar");
  const dealId = it.deal_id ?? (await radarToDeal(itemId));
  const deal = await one<{ person_id: number | null; title: string; person: string | null; company: string | null }>(
    "select d.person_id, d.title, p.full_name as person, c.name as company from sales_deals d left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id where d.id = $1",
    [dealId],
  );
  const tz = (await getSettings()).timezone;
  const [hh, mm] = time.split(":").map(Number);
  const starts = zonedInstant(date, hh, mm, tz);
  const trip = await tripFor(itemId);
  const place = o.place?.trim() || (trip ? trip.city : null);
  const who = deal?.company ?? deal?.person ?? it.identity?.company ?? deal?.title ?? it.title.slice(0, 60);
  const row = await one<{ id: number }>(
    `insert into sales_meetings (external_id, deal_id, person_id, title, starts_at, ends_at, description, radar_item_id, place)
     values ($1,$2,$3,$4,$5,$5::timestamptz + make_interval(mins => $6),$7,$8,$9)
     on conflict (external_id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, place = excluded.place, cancelled = false returning id`,
    [`lead:${itemId}:${date}`, dealId, deal?.person_id ?? null, `Meet ${who}${place ? ` in ${place}` : ""}`, starts, Math.max(15, Math.min(240, o.minutes ?? 45)), o.note?.slice(0, 1000) ?? null, itemId, place],
  );
  await logInteraction({
    deal_id: dealId, person_id: deal?.person_id ?? null, channel: "meeting", direction: "internal", source: "radar",
    summary: `Meeting booked: ${weekdayName(date)} ${fmtDateShort(date)} at ${time}${place ? ` in ${place}` : ""}`, external_id: `meet-booked:${row!.id}`,
  });
  return { deal_id: dealId, meeting_id: row!.id };
}

export interface TripMeeting { id: number; starts_at: string; title: string; place: string | null; deal_id: number | null; radar_item_id: number | null; cancelled: boolean }

/** Meetings booked for a trip's leads, in time order. */
export async function tripMeetings(huntId: number): Promise<TripMeeting[]> {
  return q<TripMeeting>(
    `select m.id, m.starts_at, m.title, m.place, m.deal_id, m.radar_item_id, m.cancelled from sales_meetings m
     join sales_radar_items r on r.id = m.radar_item_id where r.hunt_id = $1 and not m.cancelled order by m.starts_at`,
    [huntId],
  );
}

/** When a trip (or any dated target) is over, it stops: switched off and marked ended. Returns how many ended. */
export async function endFinishedTargets(today: DateStr): Promise<number> {
  const rows = await q<{ id: number }>(
    "update sales_hunts set enabled = false, ended_at = now(), next_run_at = null where enabled and coalesce(ends_on, trip_to) < $1::date returning id",
    [today],
  );
  return rows.length;
}

// ------------------------------------------------------------------ events around a trip

export interface TripEvent {
  id?: number; hunt_id?: number; key: string; title: string; kind: string; starts_on: DateStr | null; ends_on: DateStr | null; time_text: string | null;
  venue: string | null; city: string | null; organizer: string | null; url: string; why: string | null; community: string | null; date_confirmed: boolean;
  status?: "new" | "going" | "skipped";
}

const EVENT_PAD = 5;

/** The days worth looking at: a few before the trip and a few after (a JITO meet two days later is still worth a stay). Pure. */
export function eventWindow(from: DateStr, to: DateStr): { from: DateStr; to: DateStr } {
  return { from: addDays(from, -EVENT_PAD), to: addDays(to, EVENT_PAD) };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthsOf = (from: DateStr, to: DateStr) => [...new Set([from, to].map((d) => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`))];
/** "JITO (Jain International Trade Organisation)" -> "JITO" */
export const communityShort = (c: string) => c.split(/[(,]/)[0].trim();

/** The searches for a trip's events: your communities first, then business, startup and industry events. Pure. */
export function eventQueries(h: Pick<HuntRow, "cities" | "countries" | "industries" | "trip_from" | "trip_to"> & { region?: string | null }, communities: string[]): string[] {
  const city = h.cities[0];
  if (!city || !h.trip_from || !h.trip_to) return [];
  const w = eventWindow(h.trip_from, h.trip_to);
  const month = monthsOf(w.from, w.to).join(" OR ");
  const area = h.region || city;
  const out: string[] = [];
  for (const c of communities.slice(0, 2).map(communityShort).filter(Boolean)) {
    out.push(`${c} ${city} event ${month}`);
    if (area !== city) out.push(`${c} ${area} chapter event OR meet ${month}`);
  }
  out.push(`${city} business networking event OR entrepreneurs meet ${month}`);
  out.push(`${city} startup meetup OR summit OR conference ${month}`);
  out.push(`${area} ${h.industries[0] ?? "technology"} conference OR expo ${month}`);
  out.push(`events in ${city} ${month} allevents OR meetup OR townscript OR district`);
  return [...new Set(out)].slice(0, 7);
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);

/** True when the page text shows this date (as 5 Dec, December 5th, 05/12, 2026-12-05...). Pure. */
export function textShowsDate(text: string, d: DateStr): boolean {
  const t = text.toLowerCase();
  if (t.includes(d)) return true;
  const day = Number(d.slice(8, 10));
  const m = Number(d.slice(5, 7));
  const mon = MONTH_NAMES[m - 1].toLowerCase().slice(0, 3);
  const dd = String(day).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return new RegExp(`\\b0?${day}(st|nd|rd|th)?\\s*(of\\s+)?${mon}`).test(t)
    || new RegExp(`${mon}[a-z]*\\.?\\s+0?${day}(st|nd|rd|th)?\\b`).test(t)
    || new RegExp(`\\b${dd}[/.-]${mm}\\b`).test(t);
}

/**
 * Keeps only events a page really names, inside the window and not over, with the page that names them as the link.
 * A date the page does not show is kept but marked unconfirmed. Pure.
 */
export function groundEvents(list: Partial<TripEvent & { url: string }>[], hits: SearchHit[], window: { from: DateStr; to: DateStr }, today: DateStr, communities: string[]): TripEvent[] {
  const out: TripEvent[] = [];
  const seen = new Set<string>();
  const shorts = communities.map(communityShort).filter(Boolean).map((c) => c.toLowerCase());
  const day = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  for (const e of list) {
    const title = String(e.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (title.length < 4) continue;
    const tw = words(title);
    const names = (h: SearchHit) => {
      const text = `${h.title}\n${h.snippet}`.toLowerCase();
      if (text.includes(title.toLowerCase())) return true;
      return tw.length >= 2 && tw.filter((w) => text.includes(w)).length / tw.length >= 0.7;
    };
    const hit = hits.find((h) => h.url === e.url && names(h)) ?? hits.find(names);
    if (!hit) continue;
    let starts = day(e.starts_on);
    let ends = day(e.ends_on) ?? starts;
    if (starts && ends && ends < starts) ends = starts;
    if (starts && (ends! < window.from || starts > window.to || ends! < today)) continue;
    const text = `${hit.title}\n${hit.snippet}`;
    const confirmed = !!starts && textShowsDate(text, starts);
    if (!confirmed && starts && !hits.some((h) => names(h) && textShowsDate(`${h.title}\n${h.snippet}`, starts!))) { starts = null; ends = null; }
    const key = `${hit.url.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "")}|${tw.slice(0, 5).join("-")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hay = `${title} ${e.organizer ?? ""} ${text}`.toLowerCase();
    const community = communities.find((c, i) => shorts[i] && new RegExp(`\\b${shorts[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay)) ?? null;
    out.push({
      key, title, kind: community ? "community" : String(e.kind ?? "business").slice(0, 20), starts_on: starts, ends_on: starts ? ends : null,
      time_text: e.time_text ? String(e.time_text).slice(0, 60) : null, venue: e.venue ? String(e.venue).slice(0, 160) : null, city: e.city ? String(e.city).slice(0, 80) : null,
      organizer: e.organizer ? String(e.organizer).slice(0, 120) : null, url: hit.url, why: e.why ? String(e.why).slice(0, 300) : null,
      community: community ? communityShort(community) : null, date_confirmed: !!starts && hits.some((h) => names(h) && textShowsDate(`${h.title}\n${h.snippet}`, starts!)),
    });
  }
  // your communities first, then by date (unknown dates last)
  return out.sort((a, b) => Number(!!b.community) - Number(!!a.community) || String(a.starts_on ?? "9").localeCompare(String(b.starts_on ?? "9")));
}

/** Searches for events around a trip, keeps the grounded ones, and tells you about new ones. Returns how many are new. */
export async function findTripEvents(huntId: number, budgetMs = 45_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const h = await one<HuntRow & { region: string | null }>("select * from sales_hunts where id = $1", [huntId]);
  if (!h || h.kind !== "trip" || !h.trip_from || !h.trip_to || !h.cities.length) return 0;
  const from = String(h.trip_from).slice(0, 10);
  const to = String(h.trip_to).slice(0, 10);
  const today = calendarDate(new Date(), (await getSettings()).timezone);
  if (today > addDays(to, EVENT_PAD)) return 0;
  await q("update sales_hunts set events_checked_at = now() where id = $1", [huntId]);
  const cfg = await salesConfig();
  const communities = cfg.owner.communities ?? [];
  const w = eventWindow(from, to);
  const city = h.cities[0];
  const place = [city, h.region, h.countries[0]].filter(Boolean).join(", ");
  const queries = eventQueries({ ...h, trip_from: from, trip_to: to }, communities);
  const lists = await Promise.allSettled(queries.map((x) => webSearch(x, 8, `events: ${h.name}`)));
  const hits: SearchHit[] = lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (geminiSearchReady() && Date.now() < deadline - 25_000) {
    const g = await groundedResearch(
      `Find events happening in or near ${place} (within about 150 km) between ${w.from} and ${w.to} that the founder of an AI and software agency would want to attend: ` +
      `${communities.length ? `events of ${communities.join(", ")} (any chapter in the region), ` : ""}business and entrepreneur meets, startup and tech meetups, talks by notable speakers, conferences and trade expos` +
      `${h.industries.length ? ` (especially ${h.industries.join(", ")})` : ""}. For each: exact name, date, venue, organizer and link. Only events the search shows.`,
      { timeoutMs: Math.min(35_000, deadline - Date.now() - 15_000), label: `events: ${h.name}` },
    ).catch(() => null);
    if (g) hits.push(...g.sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })));
  }
  if (!hits.length || !llmConfigured()) return 0;
  const out = await llmJson<{ events?: Partial<TripEvent>[] } | Partial<TripEvent>[]>(
    `You pick events worth attending for ${cfg.owner.name} (${cfg.owner.title} of ${cfg.owner.company}; offers: ${cfg.offers.join("; ")}${communities.length ? `; member of ${communities.join(", ")}` : ""}).
The owner visits ${place} from ${from} to ${to}. From the search results ONLY, list real events in or near ${city} (same state or within about 150 km) dated between ${w.from} and ${w.to}.
Worth it: their communities' events (always include these), business or entrepreneur meets, startup or tech meetups, talks by known speakers, industry conferences and expos where buyers are.
Skip concerts, weddings, festivals for tourists, webinars elsewhere, and anything already over before ${today}.
Rules: "title" exactly as the results write it; "url" the result URL that names it; "starts_on"/"ends_on" as YYYY-MM-DD only when the results give the date, else null; never guess a date;
"kind": community|business|startup|tech|industry|talk|expo; "why": one plain line on why it is worth the owner's time (who will be there, who he could meet).
Return {"events": [{"title","url","starts_on","ends_on","time_text","venue","city","organizer","kind","why"}]} with at most 10.`,
    hits.slice(0, 40).map((x, i) => `#${i + 1} ${x.title}\n${x.url}\n${x.snippet}`).join("\n\n"),
    { maxTokens: 2500, totalMs: Math.max(10_000, Math.min(30_000, deadline - Date.now() - 3_000)) },
  ).catch(() => []);
  const events = groundEvents(Array.isArray(out) ? out : out.events ?? [], hits, w, today, communities);
  const fresh: TripEvent[] = [];
  for (const e of events) {
    const row = await one<{ id: number }>(
      `insert into sales_trip_events (hunt_id, key, title, kind, starts_on, ends_on, time_text, venue, city, organizer, url, why, community, date_confirmed)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (hunt_id, key) do update set
         starts_on = case when excluded.date_confirmed or sales_trip_events.starts_on is null then excluded.starts_on else sales_trip_events.starts_on end,
         ends_on = case when excluded.date_confirmed or sales_trip_events.starts_on is null then excluded.ends_on else sales_trip_events.ends_on end,
         date_confirmed = sales_trip_events.date_confirmed or excluded.date_confirmed
       returning id, (xmax = 0) as inserted`,
      [huntId, e.key, e.title, e.kind, e.starts_on, e.ends_on, e.time_text, e.venue, e.city, e.organizer, e.url, e.why, e.community, e.date_confirmed],
    ) as { id: number; inserted?: boolean } | null;
    if (row?.inserted) fresh.push(e);
  }
  if (fresh.length) {
    const { push } = await import("./notify");
    const { esc } = await import("../telegram/api");
    const { baseUrl } = await import("./links");
    const line = (e: TripEvent) => `${e.community ? "⭐ " : ""}<b>${esc(e.title.slice(0, 100))}</b>${e.starts_on ? ` · ${weekdayName(e.starts_on)} ${fmtDateShort(e.starts_on)}${e.date_confirmed ? "" : " (check the date)"}` : " · date not shown"}${e.city ? ` · ${esc(e.city)}` : ""}`;
    await push(`📅 <b>${esc(h.name)}</b>: ${fresh.length} event${fresh.length === 1 ? "" : "s"} around your dates (${fmtRange(w.from, w.to)})\n${fresh.slice(0, 6).map(line).join("\n")}`, {
      inline_keyboard: [[{ text: "Open the trip", url: `${baseUrl()}/sales/radar` }]],
    }).catch(() => {});
  }
  return fresh.length;
}

/** The events found for a trip, yours first, then by date. */
export async function tripEvents(huntId: number): Promise<TripEvent[]> {
  return q<TripEvent>(
    `select id, hunt_id, key, title, kind, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, time_text, venue, city, organizer, url, why, community, date_confirmed, status
     from sales_trip_events where hunt_id = $1 order by (status = 'skipped'), (community is not null) desc, starts_on nulls last, id`,
    [huntId],
  );
}

export async function setTripEventStatus(id: number, status: "new" | "going" | "skipped"): Promise<void> {
  await q("update sales_trip_events set status = $2 where id = $1", [id, status]);
}

/** Queues an events search for a trip (once a day on its own; now when you ask). */
export async function queueTripEvents(huntId: number, force = false): Promise<boolean> {
  const h = await one<{ kind: string; events: boolean; events_checked_at: string | null }>("select kind, events, events_checked_at from sales_hunts where id = $1", [huntId]);
  if (!h) throw new UserError("That trip no longer exists.");
  if (h.kind !== "trip") throw new UserError("Events are looked for on trips: give this target trip dates first.");
  if (!force && (!h.events || (h.events_checked_at && Date.now() - new Date(h.events_checked_at).getTime() < 20 * 3_600_000))) return false;
  const { enqueue } = await import("./jobs");
  await enqueue("trip_events", { id: huntId }, { dedupeKey: `trip_events:${huntId}` });
  return true;
}
