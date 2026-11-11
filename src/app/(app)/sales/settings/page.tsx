import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { one } from "@/lib/db";
import { salesConfig, salesRow } from "@/lib/sales/config";
import { baseUrl } from "@/lib/sales/links";
import { listStages, listTransitions } from "@/lib/sales/stages";
import { SettingsView } from "@/components/sales/settings-view";
import { listCustomFields } from "@/lib/sales/custom-fields";
import { listPipelines, listTeam } from "@/lib/sales/org";

export const metadata: Metadata = { title: "Sales settings" };
export const dynamic = "force-dynamic";

const has = (...keys: string[]) => keys.every((k) => !!process.env[k]?.trim());

export default async function SalesSettingsPage() {
  const [cfg, row, stages, transitions] = await Promise.all([salesConfig(), salesRow(), listStages(true), listTransitions()]);
  const last = await one<{ t: string | null }>(
    "select greatest((select max(created_at) from sales_captures where source in ('email','meet')), (select max(created_at) from sales_meetings where external_id like 'gcal:%')) as t",
  );
  let script = "";
  try {
    script = fs.readFileSync(path.join(process.cwd(), "integrations", "daybook-sales.gs"), "utf8");
  } catch {
    script = "// integrations/daybook-sales.gs was not found in this deployment";
  }
  const env = [
    { key: "GEMINI_API_KEY", ok: has("GEMINI_API_KEY"), what: "Best free AI, and Google Search for deep research (Google AI Studio)", free: "free tier" },
    { key: "OPENROUTER_API_KEY", ok: has("OPENROUTER_API_KEY"), what: "Free open models, already used by Daybook; fallback when Gemini is busy", free: "free models" },
    { key: "TAVILY_API_KEY", ok: has("TAVILY_API_KEY"), what: "Web search for the radar and research", free: "1,000 searches / month free" },
    { key: "SERPER_API_KEY", ok: has("SERPER_API_KEY"), what: "Google results, second search provider", free: "2,500 searches free (one time)" },
    { key: "BRAVE_API_KEY", ok: has("BRAVE_API_KEY"), what: "Third search provider (optional)", free: "free plan" },
    { key: "REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET", ok: has("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"), what: "Reliable Reddit access (servers are often blocked without it)", free: "free script app" },
    { key: "ADZUNA_APP_ID + ADZUNA_APP_KEY", ok: has("ADZUNA_APP_ID", "ADZUNA_APP_KEY"), what: "Hiring signals by country (US, UK, CA, AU, SG, DE, NL, IN)", free: "free" },
    { key: "DEEPGRAM_API_KEY", ok: has("DEEPGRAM_API_KEY"), what: "Voice notes and debriefs (already in Daybook)", free: "$200 free credit" },
    { key: "OMNIDIM_API_KEY + OMNIDIM_AGENT_ID + OWNER_PHONE", ok: has("OMNIDIM_API_KEY", "OMNIDIM_AGENT_ID", "OWNER_PHONE"), what: "Emergency phone call to you", free: "free tier" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", ok: has("SUPABASE_SERVICE_ROLE_KEY") || has("SUPABASE_SECRET_KEY"), what: "File uploads for tracked files (already used by the scratchpad)", free: "free tier" },
    { key: "APP_BASE_URL", ok: has("APP_BASE_URL"), what: "Your https address, used in every link you send", free: "" },
    { key: "JINA_API_KEY", ok: has("JINA_API_KEY"), what: "Web search and reading JavaScript-heavy websites", free: "free key, 1M tokens" },
  ];
  return (
    <SettingsView
      d={{
        cfg, stages, transitions, captureToken: row.capture_token, googleSecret: row.google_secret, appsScriptUrl: row.apps_script_url,
        baseUrl: baseUrl(), env, lastGoogle: last?.t ? new Date(last.t).toISOString() : null, script, customFields: await listCustomFields(undefined, true),
        pipelines: await listPipelines(true), team: await listTeam(true),
      }}
    />
  );
}
