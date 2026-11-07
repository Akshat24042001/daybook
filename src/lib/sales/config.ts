/** Sales settings: one row, a JSON config merged over these defaults so new options appear without a migration. */
import { one, q } from "../db";
import { offerLines } from "./offers";

export type Autonomy = "suggest" | "draft" | "auto";

export interface SalesConfig {
  owner: {
    name: string;
    /** how you appear in chat exports and transcripts ("Akshat", "You") */
    aliases: string[];
    emails: string[];
    phones: string[];
    company: string;
    website: string;
    title: string;
    signature: string;
    timezone_note: string;
    /** your Calendly / Cal.com link; drafts offer it whenever the next step is a call */
    booking_url: string;
  };
  offers: string[];
  /** extra voice rules on top of the built-in style guide */
  voice_rules: string;
  /** weekly country rotation for the radar's signal hunt */
  countries: string[];
  /** daily industry rotation */
  industries: string[];
  /** days after the first touch for each follow-up; the last one is the breakup message */
  followup_days: number[];
  /** days without any reply after the first touch before a deal is marked Ghosted */
  ghost_after_days: number;
  /** a warm conversation that went quiet gets a re-engage move after this many days */
  reengage_days: number;
  /** hours you allow yourself to reply to an inbound message before it becomes urgent */
  reply_within_hours: number;
  /** days to wait before revisiting a ghosted deal */
  ghost_revisit_days: number;
  radar: {
    min_score: number;
    /** at least this many qualified opportunities per day; the hunt keeps searching until it gets them */
    daily_min: number;
    digest_hour: number;
    alert_score: number;
    search_daily_cap: number;
    enrich_queries: number;
    /** qualified radar leads at or above this score are researched automatically (company, contacts, people); 101 turns it off */
    auto_research_score: number;
    /** adaptive: countries and industries that bring results get more turns; rotate: the old even rotation */
    targeting: "adaptive" | "rotate";
    /** share of turns (percent) given to the least-tested country or industry when adaptive */
    explore_pct: number;
  };
  /** what you are aiming for; 0 means not set */
  targets: {
    monthly_revenue_usd: number;
    weekly_conversations: number;
    daily_outreach: number;
  };
  /** after the work is delivered: client check-ins (days after delivery), an upsell nudge, and a retainer offer */
  post_sale: {
    checkin_days: number[];
    upsell_after_days: number;
    retainer: boolean;
  };
  brief_hour: number;
  review_dow: number;
  review_hour: number;
  autonomy: Record<string, Autonomy>;
  escalation: {
    enabled: boolean;
    max_per_day: number;
    on: string[];
  };
  /** value of 1 unit in USD */
  fx: Record<string, number>;
  default_currency: string;
  /** what to do with email threads from unknown senders: ask in the digest, create a lead, or ignore */
  unknown_email: "ask" | "auto" | "off";
}

export const DEFAULT_CONFIG: SalesConfig = {
  owner: {
    name: "Akshat Shah",
    aliases: ["Akshat", "Akshat Shah", "You", "Me"],
    emails: ["akshat.shah@aivaura.com"],
    phones: ["+919664911105"],
    company: "Aivaura",
    website: "aivaura.com",
    title: "CEO",
    signature: "Akshat\nAivaura | aivaura.com",
    timezone_note: "India (IST)",
    booking_url: "",
  },
  offers: [
    "AI agents and AI automation for operations, sales and support",
    "Custom software, web applications and full stack products",
    "Mobile applications (iOS and Android)",
    "Websites that convert",
    "Workflow automation across the tools a business already uses",
    "Voice agents for calls, bookings and follow-ups",
    "Computer vision: worker productivity, quality checks, safety, counting",
    "Hardware and robotics integration",
    "Business growth systems: lead capture, CRM, reporting",
  ],
  voice_rules: "",
  countries: ["United States", "United Arab Emirates", "United Kingdom", "Canada", "Australia", "Singapore", "Saudi Arabia", "Germany", "Netherlands", "China"],
  industries: [
    "jewellery", "mining", "manufacturing", "e-commerce", "retail", "production", "food and beverage", "travel",
    "real estate", "logistics", "healthcare clinics", "hospitality", "construction", "education", "legal",
    "automotive dealers", "textiles and apparel", "agriculture", "insurance", "accounting firms",
  ],
  followup_days: [3, 8, 15],
  ghost_after_days: 21,
  reengage_days: 7,
  reply_within_hours: 3,
  ghost_revisit_days: 60,
  radar: { min_score: 60, daily_min: 1, digest_hour: 9, alert_score: 85, search_daily_cap: 25, enrich_queries: 5, auto_research_score: 70, targeting: "adaptive", explore_pct: 20 },
  targets: { monthly_revenue_usd: 0, weekly_conversations: 15, daily_outreach: 5 },
  post_sale: { checkin_days: [30, 90], upsell_after_days: 45, retainer: true },
  brief_hour: 9,
  review_dow: 7,
  review_hour: 18,
  autonomy: {
    reply: "draft",
    follow_up: "draft",
    first_touch: "draft",
    meeting_recap: "draft",
    payment_reminder: "draft",
    referral_ask: "draft",
    radar_reply: "draft",
    meeting_confirm: "draft",
  },
  escalation: { enabled: true, max_per_day: 2, on: ["quote_accepted", "hot_inbound", "proposal_hot"] },
  fx: { USD: 1, INR: 0.012, AED: 0.2723, GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, SGD: 0.74, SAR: 0.2666, CNY: 0.14 },
  default_currency: "USD",
  unknown_email: "ask",
};

export interface SalesSettingsRow {
  config: Partial<SalesConfig>;
  capture_token: string;
  google_secret: string;
  apps_script_url: string | null;
  last_brief_on: string | null;
  last_review_on: string | null;
  last_radar_digest_on: string | null;
}

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && typeof v === "object" && !Array.isArray(v) ? merge(b, v) : v;
  }
  return out as T;
}

export async function salesRow(): Promise<SalesSettingsRow> {
  let row = await one<SalesSettingsRow>("select * from sales_settings where id = 1");
  if (!row) {
    await q("insert into sales_settings (id) values (1) on conflict do nothing");
    row = (await one<SalesSettingsRow>("select * from sales_settings where id = 1"))!;
  }
  return row;
}

export async function salesConfig(): Promise<SalesConfig> {
  const row = await salesRow();
  const cfg = merge(DEFAULT_CONFIG, row.config ?? {});
  // the offer catalogue (Sales > Playbook) is the source of truth once it has anything in it
  const lines = await offerLines();
  if (lines.length) cfg.offers = lines;
  return cfg;
}

export async function updateSalesConfig(patch: Partial<SalesConfig>): Promise<SalesConfig> {
  const current = await salesConfig();
  const next = merge(current, patch);
  await q("update sales_settings set config = $1, updated_at = now() where id = 1", [JSON.stringify(next)]);
  return next;
}

export function toUsd(cfg: SalesConfig, amount: number | null | undefined, currency: string | null | undefined): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return null;
  const rate = cfg.fx[(currency ?? "USD").toUpperCase()] ?? null;
  return rate === null ? null : Math.round(Number(amount) * rate);
}

/** ISO week number, used to rotate the target country weekly. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}

export function focusFor(cfg: SalesConfig, now: Date): { country: string; industry: string } {
  const countries = cfg.countries.length ? cfg.countries : DEFAULT_CONFIG.countries;
  const industries = cfg.industries.length ? cfg.industries : DEFAULT_CONFIG.industries;
  const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000);
  return { country: countries[isoWeek(now) % countries.length], industry: industries[dayOfYear % industries.length] };
}
