/**
 * Hunts: AI lead-hunting jobs you define and schedule. A hunt has a plain-language brief ("who do you want to find"),
 * optional countries, industries and keywords, and its own schedule. Each run:
 *   1. the AI plans fresh high-intent search queries, learning from what you kept and what you rejected before,
 *      and never repeating recent queries;
 *   2. the queries run against every search provider you configured, plus (optionally) a sweep of the radar sources;
 *   3. every new result is scored against your offers AND this hunt's brief by the same qualifier the radar uses;
 *   4. strong ones reach Telegram and the Radar tab, tagged with the hunt that found them.
 * Results flow into the existing radar, so "Draft reply" and "Make it a lead" work on them unchanged.
 */
import { one, q, UserError } from "../db";
import { getSettings } from "../settings";
import { esc } from "../telegram/api";
import { salesConfig } from "./config";
import { currentFocus } from "./focus";
import { nextRunAfter, searchesPerDay, type Schedule } from "./hunt-schedule";
import { enqueue } from "./jobs";
import { baseUrl } from "./links";
import { llmConfigured, llmJson } from "./llm";
import { push } from "./notify";
import { qualifyPending, runRadar, storeItems } from "./radar";
import { searchConfigured, webSearch } from "./search";
import { calendarDate } from "../time";
import { cityNews, endFinishedTargets, findProspects, isExcluded, placeOf, queueTripEvents, tripEvents, tripMeetings, tripPhase, type TripEvent, type TripMeeting } from "./targets";

export const SIGNALS = ["requirement", "hiring", "funding", "review", "tender", "launch"] as const;

export interface HuntRow extends Schedule {
  id: number;
  name: string;
  enabled: boolean;
  brief: string;
  keywords: string[];
  countries: string[];
  industries: string[];
  signals: string[];
  sweep_sources: boolean;
  queries_per_run: number;
  min_score: number | null;
  notify: boolean;
  /** 'trip': you will be in a city on set dates; leads there get a message that asks to meet */
  kind: "standing" | "trip";
  cities: string[];
  /** words that drop an item before it is scored */
  exclude: string[];
  /** only runs between these dates (either may be empty); a trip stops on its last day */
  starts_on: string | null;
  ends_on: string | null;
  trip_from: string | null;
  trip_to: string | null;
  /** drafts ask for an in-person meeting during the trip */
  meet: boolean;
  /** also finds local businesses that fit the offers, not only posts */
  prospects: boolean;
  /** the state or province around the cities, for events and searches nearby */
  region: string | null;
  /** a trip also looks for events around its dates (your communities first) */
  events: boolean;
  events_checked_at?: string | null;
  ended_at?: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
}

export interface HuntRun {
  id: number;
  hunt_id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error";
  trigger: string;
  queries: string[];
  searched: number;
  found: number;
  error: string | null;
}

export interface HuntView extends HuntRow {
  /** the last 7 days */
  week: { found: number; qualified: number; hot: number; converted: number };
  /** everything it found, not only the last 7 days: for trips, where the whole run matters */
  total: { found: number; qualified: number; ready: number; contacted: number; meetings: number };
  meetings: TripMeeting[];
  events_list: TripEvent[];
  last_run: HuntRun | null;
  searches_per_day: number;
}

export type HuntInput = Partial<Omit<HuntRow, "id" | "next_run_at" | "last_run_at" | "ended_at" | "events_checked_at">>;

const DEFAULTS: Partial<HuntRow> = {
  schedule: "at", at_time: "09:00", days: [1, 2, 3, 4, 5, 6, 7], every_hours: 1, window_from: 0, window_to: 24,
  queries_per_run: 6, signals: ["requirement", "hiring", "funding", "review"],
};

const clean = (xs: unknown, max = 30, len = 120): string[] =>
  Array.isArray(xs) ? [...new Set(xs.map((x) => String(x).trim().slice(0, len)).filter(Boolean))].slice(0, max) : [];

/** Checks and normalises what the form sent. Throws a UserError that names the problem. */
export function validateHunt(input: HuntInput, base?: HuntRow): Omit<HuntRow, "id" | "next_run_at" | "last_run_at"> {
  // anything left out falls back to a sensible default, so the API (and the Claude connector) can send just a name and a brief
  const m = { ...DEFAULTS, ...base, ...input } as HuntRow;
  const name = String(m.name ?? "").trim().slice(0, 80);
  if (!name) throw new UserError("Give the hunt a name.");
  const brief = String(m.brief ?? "").trim().slice(0, 2000);
  const keywords = clean(input.keywords ?? base?.keywords);
  if (!brief && !keywords.length) throw new UserError("Describe who you want to find, or add at least one keyword.");
  const schedule = m.schedule === "interval" ? "interval" : "at";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(m.at_time ?? ""))) throw new UserError("Time must look like 09:00.");
  const days = [...new Set((m.days ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
  if (!days.length) throw new UserError("Pick at least one day.");
  const every = Math.round(Number(m.every_hours));
  if (!Number.isFinite(every) || every < 1 || every > 168) throw new UserError("Every N hours: N must be 1 to 168.");
  const from = Math.round(Number(m.window_from));
  const to = Math.round(Number(m.window_to));
  if (!(from >= 0 && from <= 23 && to >= 1 && to <= 24 && to > from)) throw new UserError("The active hours must start before they end (for example 8 to 20).");
  const queries = Math.round(Number(m.queries_per_run));
  if (!(queries >= 1 && queries <= 20)) throw new UserError("Queries per run: 1 to 20.");
  const min = m.min_score === null || m.min_score === undefined ? null : Math.round(Number(m.min_score));
  if (min !== null && !(min >= 0 && min <= 100)) throw new UserError("Minimum score: 0 to 100.");
  const signals = clean(m.signals, 10, 20).filter((s) => (SIGNALS as readonly string[]).includes(s));
  if (!signals.length) throw new UserError("Pick at least one kind of signal to look for.");
  const day = (x: unknown, label: string) => {
    if (x === null || x === undefined || x === "") return null;
    const v = String(x).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new UserError(`${label} must be a date.`);
    return v;
  };
  const kind = m.kind === "trip" ? "trip" : "standing";
  const cities = clean(m.cities, 10, 80);
  const tripFrom = kind === "trip" ? day(m.trip_from, "The first day of the trip") : null;
  const tripTo = kind === "trip" ? day(m.trip_to, "The last day of the trip") : null;
  if (kind === "trip") {
    if (!cities.length) throw new UserError("Say which city the trip is to.");
    if (!tripFrom || !tripTo) throw new UserError("Give the trip's first and last day.");
    if (tripTo < tripFrom) throw new UserError("The trip must end on or after the day it starts.");
  }
  const startsOn = day(m.starts_on, "Start date");
  const endsOn = day(m.ends_on, "End date") ?? (kind === "trip" ? tripTo : null);
  if (startsOn && endsOn && endsOn < startsOn) throw new UserError("The end date must be on or after the start date.");
  return {
    name, enabled: m.enabled !== false, brief, keywords, countries: clean(m.countries, 20), industries: clean(m.industries, 20), signals,
    sweep_sources: m.sweep_sources !== false, queries_per_run: queries, min_score: min, notify: m.notify !== false,
    schedule, every_hours: every, at_time: m.at_time, days, window_from: from, window_to: to,
    kind, cities, exclude: clean(m.exclude, 30, 80), starts_on: startsOn, ends_on: endsOn, trip_from: tripFrom, trip_to: tripTo,
    meet: kind === "trip" ? m.meet !== false : !!m.meet, prospects: !!m.prospects && cities.length > 0,
    region: m.region ? String(m.region).trim().slice(0, 80) || null : null, events: m.events !== false,
  };
}

async function tz(): Promise<string> {
  return (await getSettings()).timezone;
}

const COLS = "name, enabled, brief, keywords, countries, industries, signals, sweep_sources, queries_per_run, min_score, notify, schedule, every_hours, at_time, days, window_from, window_to, kind, cities, exclude, starts_on, ends_on, trip_from, trip_to, meet, prospects, region, events";

export async function saveHunt(input: HuntInput, id?: number): Promise<number> {
  const base = id ? await one<HuntRow>("select * from sales_hunts where id = $1", [id]) : null;
  if (id && !base) throw new UserError("That hunt no longer exists.");
  const h = validateHunt(input, base ?? undefined);
  const next = h.enabled ? nextRunAfter(h, new Date(), await tz()) : null;
  const vals = [h.name, h.enabled, h.brief, h.keywords, h.countries, h.industries, h.signals, h.sweep_sources, h.queries_per_run, h.min_score, h.notify, h.schedule, h.every_hours, h.at_time, h.days, h.window_from, h.window_to,
    h.kind, h.cities, h.exclude, h.starts_on, h.ends_on, h.trip_from, h.trip_to, h.meet, h.prospects, h.region, h.events, next];
  if (base) {
    await q(
      `update sales_hunts set ${COLS.split(", ").map((c, i) => `${c} = $${i + 2}`).join(", ")}, next_run_at = $${vals.length + 1}, ended_at = null, events_checked_at = null where id = $1`,
      [base.id, ...vals],
    );
    return base.id;
  }
  const row = await one<{ id: number }>(
    `insert into sales_hunts (${COLS}, next_run_at) values (${vals.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    vals,
  );
  return row!.id;
}

export async function setHuntEnabled(id: number, enabled: boolean): Promise<void> {
  const h = await one<HuntRow>("select * from sales_hunts where id = $1", [id]);
  if (!h) throw new UserError("That hunt no longer exists.");
  await q("update sales_hunts set enabled = $2, next_run_at = $3 where id = $1", [id, enabled, enabled ? nextRunAfter(h, new Date(), await tz()) : null]);
}

export async function deleteHunt(id: number): Promise<void> {
  await q("delete from sales_hunts where id = $1", [id]);
}

export async function listHunts(): Promise<HuntView[]> {
  const rows = await q<HuntRow>("select * from sales_hunts order by enabled desc, id");
  if (!rows.length) return [];
  const [stats, runs] = await Promise.all([
    q<{ hunt_id: number; found: number; qualified: number; hot: number; converted: number }>(
      `select r.hunt_id, count(*)::int as found,
              count(*) filter (where r.status in ('qualified','contacted','converted'))::int as qualified,
              count(*) filter (where r.score >= $1)::int as hot,
              count(*) filter (where r.deal_id is not null)::int as converted
       from sales_radar_items r where r.hunt_id is not null and r.found_at > now() - interval '7 days' group by r.hunt_id`,
      [(await salesConfig()).radar.alert_score],
    ),
    q<HuntRun>("select distinct on (hunt_id) * from sales_hunt_runs order by hunt_id, started_at desc"),
  ]);
  const totals = await q<{ hunt_id: number; found: number; qualified: number; ready: number; contacted: number; meetings: number }>(
    `select r.hunt_id, count(*)::int as found,
            count(*) filter (where r.status in ('qualified','contacted','converted'))::int as qualified,
            count(*) filter (where r.prep->>'stage' = 'ready' and r.deal_id is null and r.status = 'qualified')::int as ready,
            count(*) filter (where r.deal_id is not null or r.status in ('contacted','converted'))::int as contacted,
            (select count(*)::int from sales_meetings m join sales_radar_items x on x.id = m.radar_item_id where x.hunt_id = r.hunt_id and not m.cancelled) as meetings
     from sales_radar_items r where r.hunt_id = any($1::int[]) group by r.hunt_id`,
    [rows.map((h) => h.id)],
  );
  const meetings = new Map<number, TripMeeting[]>();
  const events = new Map<number, TripEvent[]>();
  for (const h of rows.filter((x) => x.kind === "trip")) {
    meetings.set(h.id, await tripMeetings(h.id));
    events.set(h.id, await tripEvents(h.id));
  }
  return rows.map((h) => ({
    ...h,
    starts_on: h.starts_on ? String(h.starts_on).slice(0, 10) : null, ends_on: h.ends_on ? String(h.ends_on).slice(0, 10) : null,
    trip_from: h.trip_from ? String(h.trip_from).slice(0, 10) : null, trip_to: h.trip_to ? String(h.trip_to).slice(0, 10) : null,
    week: stats.find((s) => s.hunt_id === h.id) ?? { found: 0, qualified: 0, hot: 0, converted: 0 },
    total: totals.find((s) => s.hunt_id === h.id) ?? { found: 0, qualified: 0, ready: 0, contacted: 0, meetings: 0 },
    meetings: meetings.get(h.id) ?? [],
    events_list: events.get(h.id) ?? [],
    last_run: runs.find((r) => r.hunt_id === h.id) ?? null,
    searches_per_day: searchesPerDay(h, h.queries_per_run, h.keywords.length),
  }));
}

export async function recentRuns(huntId: number, limit = 8): Promise<HuntRun[]> {
  return q<HuntRun>("select * from sales_hunt_runs where hunt_id = $1 order by started_at desc limit $2", [huntId, limit]);
}

/** Queues a run right now (the minute tick picks it up). */
export async function runHuntNow(id: number): Promise<void> {
  const h = await one<{ id: number }>("select id from sales_hunts where id = $1", [id]);
  if (!h) throw new UserError("That hunt no longer exists.");
  const running = await one("select 1 from sales_hunt_runs where hunt_id = $1 and status = 'running' and started_at > now() - interval '10 minutes'", [id]);
  if (running) throw new UserError("This hunt is already running.");
  await enqueue("hunt_run", { id, trigger: "manual" }, { dedupeKey: `hunt_manual:${id}` });
}

/** Called every minute: queues the hunts that are due and moves each to its next slot. Returns how many were queued. */
export async function scheduleHunts(now = new Date()): Promise<number> {
  const zone = await tz();
  const today = calendarDate(now, zone);
  // a trip or dated target past its last day stops on its own
  await endFinishedTargets(today);
  const due = await q<HuntRow>(
    "select * from sales_hunts where enabled and (next_run_at is null or next_run_at <= $1) and (starts_on is null or starts_on <= $2::date)",
    [now, today],
  );
  let queued = 0;
  for (const h of due) {
    const next = nextRunAfter(h, now, zone);
    // claim the slot first: two ticks racing must not both queue the run
    const claimed = await one<{ id: number }>(
      "update sales_hunts set next_run_at = $2 where id = $1 and date_trunc('milliseconds', next_run_at) is not distinct from $3 returning id",
      [h.id, next, h.next_run_at],
    );
    if (!claimed || !h.next_run_at) continue; // a brand-new hunt only gets its first slot
    await enqueue("hunt_run", { id: h.id, trigger: "schedule" }, { dedupeKey: `hunt:${h.id}:${new Date(h.next_run_at).getTime()}` });
    queued += 1;
  }
  return queued;
}

// ------------------------------------------------------------------ running a hunt

const SIGNAL_HINT: Record<string, string> = {
  requirement: "people or businesses publicly asking for something we could build or run (posts, forum threads, project boards)",
  hiring: "companies hiring for repetitive manual work or a first technical hire (automation opportunity)",
  funding: "fresh funding, launches or expansions that will need systems now",
  review: "public complaints that expose a broken process (slow replies, missed calls, lost orders)",
  tender: "public tenders and RFPs a small agency could bid on",
  launch: "new product or company launches",
};

/** Fallback when no AI is available, or it fails: a sensible spread across signals, countries and industries. */
export function templateQueries(h: Pick<HuntRow, "signals" | "keywords" | "countries" | "industries"> & { cities?: string[] }, focus: { country: string; industry: string }, n: number, salt = 0): string[] {
  // a city target searches the city (it says more than the country); otherwise the countries, else this week's
  const countries = h.cities?.length ? h.cities : h.countries.length ? h.countries : [focus.country];
  const industries = h.industries.length ? h.industries : [focus.industry];
  const year = new Date().getUTCFullYear();
  const out: string[] = [];
  let i = salt;
  while (out.length < n && i < salt + n * 4) {
    const country = countries[i % countries.length];
    const industry = industries[(i >> 1) % industries.length];
    const sig = h.signals[i % h.signals.length];
    const kw = h.keywords.length ? ` ${h.keywords[i % h.keywords.length]}` : "";
    const q1 =
      sig === "requirement" ? `"looking for" (developer OR agency OR "automation expert") ${industry} ${country}${kw}`
      : sig === "hiring" ? `${industry} company ${country} hiring ("data entry" OR "customer support" OR "operations coordinator") ${year}${kw}`
      : sig === "funding" ? `${industry} ${country} raises funding OR expands ${year}${kw}`
      : sig === "review" ? `${industry} ${country} reviews ("no response" OR "never called back" OR "slow delivery")${kw}`
      : sig === "tender" ? `${industry} ${country} tender OR RFP software OR automation ${year}${kw}`
      : `${industry} ${country} launches new platform ${year}${kw}`;
    if (!out.includes(q1)) out.push(q1);
    i += 1;
  }
  return out;
}

async function learnedExamples(huntId: number): Promise<{ good: string[]; bad: string[] }> {
  const [good, bad] = await Promise.all([
    q<{ title: string }>("select title from sales_radar_items where hunt_id = $1 and (deal_id is not null or status in ('contacted','converted')) order by found_at desc limit 6", [huntId]),
    q<{ title: string }>("select title from sales_radar_items where hunt_id = $1 and (status = 'skipped' or (status = 'rejected' and score >= 40)) order by found_at desc limit 6", [huntId]),
  ]);
  return { good: good.map((r) => r.title.slice(0, 140)), bad: bad.map((r) => r.title.slice(0, 140)) };
}

/** Asks the AI for this run's queries. Falls back to templates. Exported for tests. */
export async function planQueries(h: HuntRow, budgetMs: number): Promise<{ queries: string[]; by: "ai" | "template" }> {
  const cfg = await salesConfig();
  const focus = await currentFocus(cfg);
  const past = (await q<{ queries: string[] }>("select queries from sales_hunt_runs where hunt_id = $1 order by started_at desc limit 8", [h.id])).flatMap((r) => r.queries);
  const salt = (await one<{ n: number }>("select count(*)::int as n from sales_hunt_runs where hunt_id = $1", [h.id]))?.n ?? 0;
  const keywordQueries = h.keywords.slice(0, 5);
  const n = Math.max(1, h.queries_per_run - keywordQueries.length);
  if (llmConfigured()) {
    try {
      const { good, bad } = await learnedExamples(h.id);
      const out = await llmJson<{ queries?: string[] } | string[]>(
        `You plan web searches that find buyers for ${cfg.owner.company}, an AI agency run by ${cfg.owner.name}.
OFFERS: ${cfg.offers.join("; ")}.
Write ${n} DIFFERENT web search queries that surface, right now, businesses or people publicly showing buying intent for those offers.
Rules: each query is under 20 words; mix wording and platforms (site:reddit.com, site:linkedin.com/posts, site:upwork.com, news, job boards, forums);
favour posts from the last two weeks (add the year or "this week" when it helps); aim at the buyer, not at competitors or tutorials;
cover the signals asked for and spread across the countries and industries given. Do not repeat or lightly reword the queries already used.
Return {"queries": ["...", ...]}.`,
        [
          `HUNT BRIEF: ${h.brief || "(none: use the keywords)"}`,
          `SIGNALS TO COVER: ${h.signals.map((s) => `${s} = ${SIGNAL_HINT[s]}`).join(" | ")}`,
          `COUNTRIES: ${(h.countries.length ? h.countries : [focus.country]).join(", ")}`,
          `INDUSTRIES: ${(h.industries.length ? h.industries : [focus.industry]).join(", ")}`,
          h.cities.length ? `CITIES: ${h.cities.join(", ")}. Every query must name one of these cities: leads elsewhere are useless. Use local wording and local sites too (for India: site:linkedin.com/posts, local news, "${h.cities[0]}" with the business type).` : "",
          h.exclude.length ? `NEVER TARGET: ${h.exclude.join(", ")}` : "",
          h.kind === "trip" && h.trip_from ? `CONTEXT: the owner visits ${placeOf(h)} from ${h.trip_from} to ${h.trip_to} and wants businesses there to meet in person. Favour local businesses with a visible need over remote gigs.` : "",
          good.length ? `LEADS THE OWNER KEPT (find more like these):\n- ${good.join("\n- ")}` : "",
          bad.length ? `LEADS THE OWNER REJECTED (avoid this kind):\n- ${bad.join("\n- ")}` : "",
          past.length ? `QUERIES ALREADY USED (do not repeat):\n- ${past.slice(0, 30).join("\n- ")}` : "",
        ].filter(Boolean).join("\n\n"),
        { maxTokens: 900, totalMs: Math.max(10_000, Math.min(25_000, budgetMs)) },
      );
      const list = (Array.isArray(out) ? out : out.queries ?? []).map((x) => String(x).trim().slice(0, 240)).filter(Boolean);
      const fresh = [...new Set(list)].filter((x) => !past.includes(x)).slice(0, n);
      if (fresh.length) return { queries: [...keywordQueries, ...fresh], by: "ai" };
    } catch (e) {
      console.warn("[hunt] query planning failed, using templates:", (e as Error).message);
    }
  }
  return { queries: [...keywordQueries, ...templateQueries(h, focus, n, salt)], by: "template" };
}

/** One run: plan, search, store. Scoring continues through the radar's qualify job, then a report is sent. */
export async function runHunt(id: number, trigger = "schedule", budgetMs = 45_000): Promise<{ runId: number; found: number; searched: number }> {
  const h = await one<HuntRow>("select * from sales_hunts where id = $1", [id]);
  if (!h) throw new UserError("That hunt no longer exists.");
  const started = Date.now();
  const run = await one<{ id: number }>("insert into sales_hunt_runs (hunt_id, trigger) values ($1,$2) returning id", [id, trigger]);
  const runId = run!.id;
  await q("update sales_hunts set last_run_at = now() where id = $1", [id]);
  let found = 0;
  let searched = 0;
  try {
    const plan = await planQueries(h, budgetMs / 3);
    await q("update sales_hunt_runs set queries = $2 where id = $1", [runId, plan.queries]);
    // a trip looks for events around its dates once a day, in its own job
    if (h.kind === "trip") await queueTripEvents(h.id).catch(() => {});
    const tag = `[hunt: ${h.name}] `;
    const keep = <T extends { title: string; body: string }>(xs: T[]) => (h.exclude.length ? xs.filter((x) => !isExcluded(h.exclude, `${x.title}\n${x.body}`)) : xs);
    // three at a time: fast enough for the time budget, gentle enough for free search tiers
    for (let i = 0; i < plan.queries.length; i += 3) {
      if (Date.now() - started > budgetMs - 8_000) break;
      const results = await Promise.allSettled(plan.queries.slice(i, i + 3).map((query) => webSearch(query, 10, `hunt: ${h.name}`)));
      for (const r of results) {
        searched += 1;
        if (r.status !== "fulfilled") continue;
        found += await storeHunted(h.id, runId, keep(r.value.map((x) => ({ title: x.title, url: x.url, body: `${tag}${x.snippet}`, posted_at: x.date ?? null }))));
      }
    }
    // a place: local news (free) and local businesses that fit the offers, each one named in a search result
    if (h.cities.length && Date.now() - started < budgetMs - 10_000) {
      const news = await cityNews(h).catch(() => []);
      found += await storeHunted(h.id, runId, keep(news.map((x) => ({ title: x.title, url: x.url, body: `${tag}${x.body}`, posted_at: x.date }))), "news");
    }
    if (h.prospects && h.cities.length && Date.now() - started < budgetMs - 20_000) {
      const runs = (await one<{ n: number }>("select count(*)::int as n from sales_hunt_runs where hunt_id = $1", [h.id]))?.n ?? 0;
      const list = await findProspects(h, runs, budgetMs - (Date.now() - started) - 6_000).catch((e) => { console.warn("[hunt] prospects:", (e as Error).message); return []; });
      searched += list.length ? 3 : 0;
      found += await storeHunted(h.id, runId, keep(list.map((p) => ({
        title: `${p.company}, ${h.cities.find((c) => `${p.evidence}`.toLowerCase().includes(c.toLowerCase())) ?? h.cities[0]}${p.industry ? ` (${p.industry})` : ""}`,
        url: p.website ?? p.evidence_url,
        key: `prospect:${h.id}:${p.company.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        body: `${tag}Local business found for this target${p.website ? `. Website: ${p.website}` : ""}.\nWhy it could fit: ${p.why}\nWhere it was found: ${p.evidence} (${p.evidence_url})`,
        poster: { name: p.company, city: h.cities[0], country: h.countries[0] ?? null, profile_url: p.website },
      }))), "prospect");
    }
    if (h.sweep_sources && Date.now() - started < budgetMs - 15_000) {
      const sweep = await runRadar(Math.max(8_000, budgetMs - (Date.now() - started) - 5_000), { force: true, categories: h.signals });
      found += sweep.added;
    }
    const keyless = searchConfigured().length === 1;
    const noteErr = !found && keyless ? "No search provider key is set, so only the keyless fallback ran. Add TAVILY_API_KEY or SERPER_API_KEY for real coverage." : null;
    await q("update sales_hunt_runs set status = $2, finished_at = now(), searched = $3, found = $4, error = $5 where id = $1", [runId, noteErr ? "error" : "ok", searched, found, noteErr]);
  } catch (e) {
    await q("update sales_hunt_runs set status = 'error', finished_at = now(), searched = $2, found = $3, error = $4 where id = $1", [runId, searched, found, (e as Error).message.slice(0, 300)]);
    throw e;
  }
  // scoring and the Telegram report follow, outside this run's time budget
  await enqueue("radar_qualify", {}, { dedupeKey: "radar_qualify" });
  await enqueue("hunt_report", { runId }, { dedupeKey: `hunt_report:${runId}`, runAfter: new Date(Date.now() + 90_000) });
  return { runId, found, searched };
}

/** storeItems that also tags each new item with the hunt and the run that found it, and what kind of lead it is. */
async function storeHunted(huntId: number, runId: number, items: Parameters<typeof storeItems>[1], kind: "post" | "prospect" | "news" = "post"): Promise<number> {
  return storeItems(null, items, { huntId, runId, kind });
}

/** Scores what the run found, then tells you about it (once). */
export async function reportHunt(runId: number): Promise<void> {
  const run = await one<HuntRun & { name: string; notify: boolean; kind: HuntRow["kind"]; trip_from: string | null; trip_to: string | null }>(
    "select r.*, h.name, h.notify, h.kind, h.trip_from, h.trip_to from sales_hunt_runs r join sales_hunts h on h.id = r.hunt_id where r.id = $1", [runId],
  );
  if (!run) return;
  await qualifyPending(30_000);
  const items = await q<{ id: number; title: string; score: number | null; status: string }>(
    "select id, title, score, status from sales_radar_items where hunt_run_id = $1 and status in ('qualified','contacted','converted') order by score desc nulls last limit 5",
    [runId],
  );
  if (!run.notify || !items.length) return;
  const lines = items.slice(0, 3).map((t, i) => `${i + 1}. <b>${t.score ?? "?"}</b> ${esc(t.title.slice(0, 110))}`);
  const trip = tripPhase(run, calendarDate(new Date(), await tz()));
  await push(`🔎 <b>${esc(run.name)}</b>${trip.label ? ` (${esc(trip.label.toLowerCase())})` : ""} found ${items.length}${items.length === 5 ? "+" : ""} qualified lead${items.length === 1 ? "" : "s"}\n${lines.join("\n")}`, {
    inline_keyboard: [[{ text: "Open radar", url: `${baseUrl()}/sales/radar` }]],
  });
}

/** Starter hunts so the page is not empty. Created disabled-free but only once, the first time the page is opened. */
export async function seedHunts(): Promise<void> {
  const n = (await one<{ n: number }>("select count(*)::int as n from sales_hunts"))?.n ?? 0;
  if (n) return;
  await saveHunt({
    name: "Daily deep sweep", brief: "Founders and operators at small and mid-size businesses who need AI agents, automation, custom software or a voice agent, and are saying so publicly or are hiring for work an automation could replace.",
    schedule: "at", at_time: "08:30", days: [1, 2, 3, 4, 5, 6, 7], queries_per_run: 8, signals: ["requirement", "hiring", "funding", "review"], sweep_sources: true, notify: true, enabled: true,
  });
}
