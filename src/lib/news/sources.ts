/**
 * Where the news is read from. The backbone is Google News searches (it gathers thousands of publishers worldwide, and
 * its feed is free and reliable from a server), aimed at what matters to the owner: AI tools and models, sales and
 * revenue tech, voice agents, robotics and computer vision, the Indian and global economy and markets, policy, their
 * clients' industries and countries. Next to it, publishers' own feeds that are known to work, and Hacker News.
 * Every source keeps its health (last success, last error), so a feed that stops working shows on the News page.
 */
import { q } from "../db";

export const TOPICS = {
  ai_tools: "AI tools and launches",
  ai_models: "Models and platforms",
  sales_tech: "Sales and revenue tech",
  robotics: "Robotics and computer vision",
  india_ai: "India: AI and startups",
  markets_india: "Markets: India",
  india_economy: "Economy and policy: India",
  markets_global: "Markets: world",
  global_economy: "Economy and policy: world",
  policy: "AI rules and regulation",
  clients: "Your clients' industries and countries",
  competitors: "Agencies and IT services",
  funding: "Funding and deals",
  other: "Other",
} as const;
export type Topic = keyof typeof TOPICS;

export interface SourceDef { key: string; name: string; kind: "gnews" | "rss" | "hn"; config: Record<string, unknown>; topic: Topic }

const gn = (key: string, name: string, q: string, topic: Topic, ed: "IN" | "US" = "US"): SourceDef => ({ key: `gn_${key}`, name, kind: "gnews", config: { q, ed }, topic });
const rss = (key: string, name: string, url: string, topic: Topic): SourceDef => ({ key: `rss_${key}`, name, kind: "rss", config: { url }, topic });

export const DEFAULT_SOURCES: SourceDef[] = [
  // AI tools, models and platforms
  gn("ai_launch", "New AI tools launched", "\"launches\" AI tool OR \"AI agent\" OR \"AI assistant\" when:1d", "ai_tools"),
  gn("ai_models", "AI model releases", "(OpenAI OR Anthropic OR Gemini OR \"Meta AI\" OR Llama OR Mistral OR DeepSeek OR Qwen) (releases OR launches OR announces) when:1d", "ai_models"),
  gn("ai_pricing", "AI API prices and limits", "(OpenAI OR Gemini OR Claude OR OpenRouter) API (price OR pricing OR \"rate limit\" OR free tier) when:3d", "ai_models"),
  gn("ai_agents", "AI agents and automation", "\"AI agents\" (enterprise OR business OR automation) launch when:1d", "ai_tools"),
  gn("voice_ai", "Voice AI and voice agents", "(\"voice AI\" OR \"voice agent\" OR \"AI calling\" OR \"conversational AI\") when:2d", "ai_tools"),
  gn("open_source_ai", "Open source AI", "\"open source\" (model OR LLM OR agent) release when:2d", "ai_models"),
  // sales and revenue tech
  gn("sales_ai", "AI for sales", "(\"AI SDR\" OR \"sales AI\" OR \"AI for sales\" OR \"sales automation\") when:2d", "sales_tech"),
  gn("crm", "CRM and revenue platforms", "(Salesforce OR HubSpot OR Zoho OR Pipedrive OR Apollo.io) AI (launch OR feature OR acquires) when:2d", "sales_tech"),
  gn("whatsapp_biz", "WhatsApp for business", "(\"WhatsApp Business\" OR \"WhatsApp API\" OR \"WhatsApp AI\") when:3d", "sales_tech"),
  // robotics and vision
  gn("robotics", "Robotics", "(humanoid OR robotics OR \"industrial robot\") (launch OR raises OR deploys) when:1d", "robotics"),
  gn("vision", "Computer vision in industry", "\"computer vision\" (factory OR retail OR safety OR quality OR manufacturing) when:3d", "robotics"),
  // India
  gn("india_ai", "AI in India", "India AI (startup OR launch OR mission OR government) when:1d", "india_ai", "IN"),
  gn("india_it", "Indian IT services and AI", "(Infosys OR TCS OR Wipro OR HCLTech OR \"Tech Mahindra\") AI when:2d", "competitors", "IN"),
  gn("india_markets", "Sensex and Nifty", "(Sensex OR Nifty) today when:1d", "markets_india", "IN"),
  gn("india_rbi", "RBI, rupee and rates", "(RBI OR \"repo rate\" OR rupee) when:1d", "india_economy", "IN"),
  gn("india_economy", "Indian economy", "India (GDP OR inflation OR GST OR exports OR \"economic growth\") when:1d", "india_economy", "IN"),
  gn("india_policy", "Indian policy for tech and MSMEs", "India (MSME OR startup OR IT OR \"data protection\" OR DPDP) policy when:2d", "india_economy", "IN"),
  // world
  gn("us_markets", "US markets", "(\"stock market\" OR Nasdaq OR \"S&P 500\") today when:1d", "markets_global"),
  gn("ai_stocks", "AI stocks and chips", "(Nvidia OR AMD OR TSMC OR \"AI stocks\" OR \"AI chips\") when:1d", "markets_global"),
  gn("fed_rates", "Interest rates and inflation", "(\"Federal Reserve\" OR \"interest rates\" OR \"US inflation\" OR ECB) when:1d", "global_economy"),
  gn("trade", "Trade, tariffs and the global economy", "(tariffs OR \"trade deal\" OR \"global economy\" OR recession) when:1d", "global_economy"),
  gn("gulf", "Gulf economy and tech", "(UAE OR Dubai OR Saudi OR \"Abu Dhabi\") (AI OR technology OR economy) when:2d", "clients"),
  gn("ai_rules", "AI regulation", "(\"AI Act\" OR \"AI regulation\" OR \"AI policy\" OR \"AI law\") when:2d", "policy"),
  gn("agencies", "AI agencies and outsourcing", "(\"AI agency\" OR \"AI automation agency\" OR \"software outsourcing\") when:3d", "competitors"),
  gn("funding_ai", "AI funding rounds", "AI startup raises (seed OR \"Series A\" OR \"Series B\") when:1d", "funding"),
  // publishers' own feeds (known to work, or listed as their official feeds)
  rss("techcrunch_ai", "TechCrunch: AI", "https://techcrunch.com/category/artificial-intelligence/feed/", "ai_tools"),
  rss("openai", "OpenAI news", "https://openai.com/news/rss.xml", "ai_models"),
  rss("google_ai", "Google AI blog", "https://blog.google/technology/ai/rss/", "ai_models"),
  rss("producthunt", "Product Hunt launches", "https://www.producthunt.com/feed", "ai_tools"),
  rss("robot_report", "The Robot Report", "https://www.therobotreport.com/feed/", "robotics"),
  rss("rbi", "RBI press releases", "https://www.rbi.org.in/pressreleases_rss.xml", "india_economy"),
  rss("inc42", "Inc42 (India)", "https://inc42.com/feed/", "india_ai"),
  rss("yourstory", "YourStory (India)", "https://yourstory.com/feed", "india_ai"),
  rss("crunchbase", "Crunchbase News", "https://news.crunchbase.com/feed/", "funding"),
  { key: "hn_front", name: "Hacker News front page", kind: "hn", config: {}, topic: "ai_tools" },
];

/** Adds the default sources the first time, and any new default later; yours are never touched. */
export async function seedNewsSources(): Promise<void> {
  for (const s of DEFAULT_SOURCES) {
    await q("insert into news_sources (key, name, kind, config, topic) values ($1,$2,$3,$4,$5) on conflict (key) do nothing", [s.key, s.name, s.kind, JSON.stringify(s.config), s.topic]);
  }
}

/** The Google News feed for a search. Pure. */
export function gnewsUrl(query: string, ed: "IN" | "US" = "US"): string {
  const e = ed === "IN" ? "hl=en-IN&gl=IN&ceid=IN:en" : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${e}`;
}
