/**
 * Everything the radar is doing and about to do, gathered for Radar > Plan: this week's focus and the rotation ahead,
 * the platforms in use (and which keys are missing), search spending, what each source looks at today, the hunts, and
 * a log of the searches that really ran.
 */
import { q } from "../db";
import { getSettings } from "../settings";
import { focusFor, salesConfig } from "./config";
import { currentFocus, focusOutlook, periodKeys, type FocusPick } from "./focus";
import type { Weighted } from "./focus-calc";
import { googleConfigured } from "./google";
import { listHunts, type HuntView } from "./hunts";
import { describeSource, type SourceRow } from "./radar";
import { searchConfigured } from "./search";

export interface PlanSource {
  id: number; name: string; kind: string; category: string; enabled: boolean; interval_hours: number; target: string;
  last_run_at: string | null; next_run_at: string | null; last_error: string | null; items_found: number; items_qualified: number;
}
export interface Platform { name: string; role: string; on: boolean; hint?: string }
export interface RadarPlan {
  now: { country: string; industry: string };
  /** a value that is not decided yet is the likeliest one, marked so the screen can say "decided on the day" */
  rotation: { date: string; country: string; industry: string; today: boolean; countryDecided: boolean; industryDecided: boolean }[];
  targeting: { mode: "adaptive" | "rotate"; explorePct: number; why: { country: FocusPick; industry: FocusPick }; countries: Weighted[]; industries: Weighted[] };
  platforms: Platform[];
  searches: { used24h: number; paid24h: number; cap: number; byProvider: { provider: string; n: number }[]; month: number };
  rhythm: { sweepEveryMin: number; digestHour: number; dailyMin: number; alertScore: number; minScore: number; countries: string[]; industries: string[] };
  sources: PlanSource[];
  hunts: HuntView[];
  recent: { at: string; provider: string; query: string; hits: number; label: string | null; error: string | null }[];
  timezone: string;
}

export async function radarPlan(): Promise<RadarPlan> {
  const [cfg, settings] = await Promise.all([salesConfig(), getSettings()]);
  const now = new Date();
  const focusNow = await currentFocus(cfg, now);
  const adaptive = cfg.radar.targeting !== "rotate";
  const outlook = await focusOutlook(cfg);
  // what an undecided period will most likely get: the leader by results, else the even rotation
  const likely = (rows: Weighted[], fallback: string) => (rows[0] && rows[0].points > 0 ? rows[0].value : fallback);
  const rotation = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86_400_000);
    const sameWeek = periodKeys(d, settings.timezone).country === periodKeys(now, settings.timezone).country;
    const even = focusFor(cfg, d);
    return {
      date: d.toISOString().slice(0, 10), today: i === 0,
      country: sameWeek ? focusNow.country : adaptive ? likely(outlook.countries, even.country) : even.country,
      industry: i === 0 ? focusNow.industry : adaptive ? likely(outlook.industries, even.industry) : even.industry,
      countryDecided: sameWeek || !adaptive,
      industryDecided: i === 0 || !adaptive,
    };
  });
  const has = (k: string) => !!process.env[k]?.trim();
  const providers = searchConfigured();
  const platforms: Platform[] = [
    { name: "Tavily", role: "Web search (best results; 1,000 a month free)", on: providers.includes("tavily"), hint: "Add TAVILY_API_KEY" },
    { name: "Serper (Google results)", role: "Web search, second provider (2,500 free)", on: providers.includes("serper"), hint: "Add SERPER_API_KEY" },
    { name: "Brave Search", role: "Web search, third provider", on: providers.includes("brave"), hint: "Add BRAVE_API_KEY" },
    { name: "DuckDuckGo", role: "Free fallback search. Weak from servers and often blocked", on: true },
    { name: "Reddit", role: "Posts from 25 business and freelance subreddits", on: has("REDDIT_CLIENT_ID") && has("REDDIT_CLIENT_SECRET"), hint: "Works without keys but is often blocked; add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET" },
    { name: "Hacker News", role: "Hiring and “seeking freelancer” threads", on: true },
    { name: "Google News", role: "Funding and expansion news per country", on: true },
    { name: "Job APIs", role: "RemoteOK, Remotive, Arbeitnow, Jobicy, Himalayas, Freelancer.com", on: true },
    { name: "Adzuna", role: "Hiring signals per country", on: has("ADZUNA_APP_ID") && has("ADZUNA_APP_KEY"), hint: "Add ADZUNA_APP_ID and ADZUNA_APP_KEY" },
    { name: "Gmail alerts", role: "Upwork, Bark, Clutch, tender alert emails (via your Google Apps Script)", on: false, hint: "Set up the Google integration in Sales > Settings" },
    { name: "AI scoring", role: "Gemini or OpenRouter scores every lead against your offers", on: has("GEMINI_API_KEY") || has("OPENROUTER_API_KEY"), hint: "Add GEMINI_API_KEY or OPENROUTER_API_KEY" },
    { name: "Telegram", role: "Hot-lead alerts and the daily digest", on: has("TELEGRAM_BOT_TOKEN"), hint: "Add TELEGRAM_BOT_TOKEN" },
  ];
  const [gmail, sources, hunts, usage, recent] = await Promise.all([
    googleConfigured().catch(() => false),
    q<SourceRow & { last_error: string | null; items_found: number; items_qualified: number }>("select * from sales_radar_sources order by enabled desc, category, name"),
    listHunts(),
    q<{ provider: string; n: number; month: number }>(
      `select provider, count(*) filter (where at > now() - interval '24 hours')::int as n, count(*) filter (where at > now() - interval '30 days')::int as month
       from sales_search_log group by provider`,
    ),
    q<RadarPlan["recent"][number]>("select at, provider, query, hits, label, error from sales_search_log order by id desc limit 60"),
  ]);
  const gm = platforms.find((p) => p.name === "Gmail alerts");
  if (gm) gm.on = gmail;
  const interval = (s: SourceRow) => s.interval_hours * 3_600_000;
  return {
    now: { country: focusNow.country, industry: focusNow.industry },
    rotation,
    targeting: { mode: adaptive ? "adaptive" : "rotate", explorePct: cfg.radar.explore_pct, why: focusNow.why, countries: outlook.countries, industries: outlook.industries },
    platforms,
    searches: {
      used24h: usage.reduce((a, u) => a + u.n, 0),
      paid24h: usage.filter((u) => u.provider !== "duckduckgo").reduce((a, u) => a + u.n, 0),
      cap: cfg.radar.search_daily_cap,
      byProvider: usage.filter((u) => u.n > 0).map((u) => ({ provider: u.provider, n: u.n })),
      month: usage.reduce((a, u) => a + u.month, 0),
    },
    rhythm: {
      sweepEveryMin: 15, digestHour: cfg.radar.digest_hour, dailyMin: cfg.radar.daily_min, alertScore: cfg.radar.alert_score, minScore: cfg.radar.min_score,
      countries: cfg.countries, industries: cfg.industries,
    },
    sources: sources.map((s) => ({
      id: s.id, name: s.name, kind: s.kind, category: s.category, enabled: s.enabled, interval_hours: s.interval_hours, target: describeSource(s, { country: focusNow.country, industry: focusNow.industry }),
      last_run_at: s.last_run_at, last_error: s.last_error, items_found: s.items_found, items_qualified: s.items_qualified,
      next_run_at: s.enabled && s.kind !== "email" ? new Date(s.last_run_at ? new Date(s.last_run_at).getTime() + interval(s) : Date.now()).toISOString() : null,
    })),
    hunts,
    recent,
    timezone: settings.timezone,
  };
}
