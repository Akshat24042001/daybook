/**
 * The radar's source catalogue. Synced into sales_radar_sources on every cold start (new sources appear, your on/off
 * switches are kept). Placeholders: {country} = this week's target country, {industry} = today's industry, {year}.
 *
 * Kinds:
 *   reddit      { sub, q? }          Reddit (OAuth if REDDIT_CLIENT_ID/SECRET are set, else the public feed)
 *   hn          { q, tags? }         Hacker News via the free Algolia API
 *   hn_freelancer {}                 the monthly "Freelancer? Seeking freelancer?" thread, SEEKING FREELANCER posts only
 *   rss         { url }              any RSS or Atom feed
 *   gnews       { q }                Google News RSS (keyless), localised to the target country
 *   json        { api, q? }          free job/project APIs: remoteok, remotive, arbeitnow, jobicy, himalayas, freelancer, adzuna
 *   search      { q }                web search (Tavily/Serper/Brave free tiers, DuckDuckGo fallback); covers sites with no feed
 *   email       { domains }          alert emails in your Gmail (sent by the Apps Script), e.g. Upwork or tender alerts
 */

export type SourceKind = "reddit" | "hn" | "hn_freelancer" | "rss" | "gnews" | "json" | "search" | "email" | "discourse";
export type SourceCategory = "requirement" | "hiring" | "funding" | "review" | "tender" | "launch" | "content";

export interface CatalogSource {
  key: string;
  name: string;
  kind: SourceKind;
  category: SourceCategory;
  config: Record<string, unknown>;
  interval_hours: number;
  enabled?: boolean;
  note?: string;
}

const NEED = '(need OR "looking for" OR hire OR hiring OR "build me" OR automate OR developer OR agency)';

const reddit = (sub: string, q?: string, enabled = true): CatalogSource => ({
  key: `reddit_${sub.toLowerCase()}`,
  name: `Reddit r/${sub}`,
  kind: "reddit",
  category: "requirement",
  config: { sub, ...(q ? { q } : {}) },
  interval_hours: 3,
  enabled,
});

const email = (key: string, name: string, domains: string[], category: SourceCategory = "requirement", note?: string): CatalogSource => ({
  key: `email_${key}`, name: `${name} alerts (Gmail)`, kind: "email", category, config: { domains }, interval_hours: 1,
  note: note ?? `Turn on ${name} email alerts for your keywords; the Apps Script forwards them here.`,
});

const search = (key: string, name: string, q: string, category: SourceCategory, interval = 24, enabled = true): CatalogSource => ({
  key: `search_${key}`, name, kind: "search", category, config: { q }, interval_hours: interval, enabled,
});

/** A tool's community forum (Discourse): people post paid work for n8n, Make, Bubble and the like, and anyone can reply. */
const forum = (key: string, name: string, base: string, q: string[], interval = 6): CatalogSource => ({
  key: `forum_${key}`, name: `${name} community: paid work`, kind: "discourse", category: "requirement", config: { base, q }, interval_hours: interval,
  note: "Free to reply: answer on the forum or message the poster there.",
});
const HIRE_Q = ["hiring", "looking for developer", "paid project", "looking for freelancer"];

const rss = (key: string, name: string, url: string, category: SourceCategory, interval = 6): CatalogSource => ({
  key: `rss_${key}`, name, kind: "rss", category, config: { url }, interval_hours: interval,
});

const gnews = (key: string, name: string, q: string, category: SourceCategory, interval = 12): CatalogSource => ({
  key: `gnews_${key}`, name, kind: "gnews", category, config: { q }, interval_hours: interval,
});

export const CATALOG: CatalogSource[] = [
  // ---------------------------------------------------------------- posted requirements: Reddit
  reddit("forhire", "hiring"),
  reddit("slavelabour", "task"),
  reddit("hiring"),
  reddit("HireaProgrammer"),
  reddit("freelance_forhire", "hiring"),
  reddit("jobbit", "hiring"),
  reddit("DoneDirtCheap", "task"),
  reddit("automation", NEED),
  reddit("n8n", "(hire OR hiring OR paid OR freelancer OR \"looking for\")"),
  reddit("zapier", "(hire OR hiring OR paid OR expert OR \"looking for\")"),
  reddit("nocode", "(hire OR hiring OR paid OR \"looking for\" OR developer)"),
  reddit("AI_Agents", "(hire OR hiring OR paid OR \"looking for\" OR client)"),
  reddit("Entrepreneur", "(\"looking for a developer\" OR \"need a developer\" OR \"automate\" OR \"build an app\")"),
  reddit("smallbusiness", "(automate OR \"need a website\" OR \"need an app\" OR software OR \"too much time\")"),
  reddit("startups", "(\"looking for a developer\" OR \"technical cofounder\" OR \"dev agency\" OR outsource)"),
  reddit("SaaS", "(\"looking for a developer\" OR outsource OR \"dev agency\" OR \"build my mvp\")"),
  reddit("ecommerce", "(automate OR \"need a developer\" OR shopify OR integration OR \"customer support\")"),
  reddit("shopify", "(hire OR \"need a developer\" OR \"custom app\" OR automate)"),
  reddit("computervision", "(hire OR freelance OR paid OR contract OR \"looking for\")"),
  reddit("robotics", "(hire OR freelance OR contract OR \"looking for\" OR paid)"),
  reddit("restaurateur", "(software OR automate OR app OR system OR \"too much time\")"),
  reddit("sweatystartup", "(software OR automate OR app OR scheduling OR crm)"),
  reddit("EntrepreneurRideAlong", "(developer OR automate OR \"build\" OR outsource)"),
  reddit("microsaas", "(\"looking for a developer\" OR outsource OR \"build\")"),
  reddit("dubai", "(developer OR app OR website OR software OR automation)", false),
  reddit("WebDeveloperJobs", "(hiring OR \"looking for\" OR paid OR budget)"),
  reddit("AiAutomations", "(hire OR hiring OR paid OR \"looking for\" OR budget)"),
  reddit("SideProject", "(\"looking for a developer\" OR \"need a developer\" OR hire OR paid)"),
  reddit("cofounder", "(\"technical cofounder\" OR developer OR \"build the mvp\" OR paid)"),
  reddit("indianstartups", "(\"need a developer\" OR \"looking for\" OR agency OR outsource OR app)"),
  reddit("smallbusinessuk", "(website OR app OR automate OR software OR \"looking for\")"),
  reddit("PropertyManagement", "(software OR automate OR app OR system OR \"too much time\")"),
  reddit("agency", "(\"white label\" OR outsource OR subcontract OR \"looking for a dev\")"),
  reddit("msp", "(\"looking for\" developer OR automation OR outsource OR \"white label\")"),
  reddit("Bubbleio", "(hire OR hiring OR paid OR \"looking for\")"),
  reddit("FlutterDev", "(hire OR hiring OR paid OR freelance OR \"looking for\")"),

  // ---------------------------------------------------------------- tool communities: people asking for paid help, free to reply
  forum("n8n", "n8n", "https://community.n8n.io", HIRE_Q),
  forum("make", "Make", "https://community.make.com", HIRE_Q),
  forum("bubble", "Bubble", "https://forum.bubble.io", HIRE_Q),
  forum("flutterflow", "FlutterFlow", "https://community.flutterflow.io", HIRE_Q),
  forum("glide", "Glide", "https://community.glideapps.com", HIRE_Q, 12),
  forum("weweb", "WeWeb", "https://community.weweb.io", HIRE_Q, 12),
  forum("retool", "Retool", "https://community.retool.com", HIRE_Q, 12),
  forum("uipath", "UiPath", "https://forum.uipath.com", ["freelance", "hiring", "paid project"], 12),
  forum("webflow", "Webflow", "https://discourse.webflow.com", ["hiring", "looking for webflow developer", "paid"], 12),
  forum("openai", "OpenAI developers", "https://community.openai.com", ["hiring", "looking for developer", "paid project"], 12),

  // ---------------------------------------------------------------- posted requirements: Hacker News
  { key: "hn_freelancer", name: "HN: Seeking freelancer thread", kind: "hn_freelancer", category: "requirement", config: {}, interval_hours: 12 },
  { key: "hn_looking_dev", name: "HN: looking for a developer", kind: "hn", category: "requirement", config: { q: "looking for developer contract", tags: "comment" }, interval_hours: 12 },
  { key: "hn_ask_agency", name: "HN: Ask HN agency / outsource", kind: "hn", category: "requirement", config: { q: "outsource development agency", tags: "ask_hn" }, interval_hours: 24 },

  // ---------------------------------------------------------------- posted requirements: free job / project APIs
  { key: "json_remoteok", name: "RemoteOK (contract dev roles)", kind: "json", category: "requirement", config: { api: "remoteok" }, interval_hours: 6 },
  { key: "json_remotive", name: "Remotive (software dev)", kind: "json", category: "requirement", config: { api: "remotive" }, interval_hours: 6 },
  { key: "json_arbeitnow", name: "Arbeitnow (EU tech roles)", kind: "json", category: "hiring", config: { api: "arbeitnow" }, interval_hours: 12 },
  { key: "json_jobicy", name: "Jobicy (remote dev)", kind: "json", category: "requirement", config: { api: "jobicy" }, interval_hours: 12 },
  { key: "json_himalayas", name: "Himalayas (remote jobs)", kind: "json", category: "hiring", config: { api: "himalayas" }, interval_hours: 12 },
  { key: "json_hn_jobs", name: "YC startups hiring (HN jobs)", kind: "json", category: "hiring", config: { api: "hn_jobs" }, interval_hours: 12, note: "Named companies: approach them for the work instead of the job." },
  { key: "json_themuse", name: "The Muse: companies hiring developers", kind: "json", category: "hiring", config: { api: "themuse", category: "Software Engineering" }, interval_hours: 12 },
  { key: "json_themuse_data", name: "The Muse: companies hiring data / IT", kind: "json", category: "hiring", config: { api: "themuse", category: "Data and Analytics" }, interval_hours: 24 },
  { key: "json_workingnomads", name: "Working Nomads (remote dev roles)", kind: "json", category: "hiring", config: { api: "workingnomads" }, interval_hours: 12 },
  { key: "json_worldbank_sw", name: "World Bank tenders: software", kind: "json", category: "tender", config: { api: "worldbank", q: "software development" }, interval_hours: 24 },
  { key: "json_worldbank_ai", name: "World Bank tenders: digital / AI", kind: "json", category: "tender", config: { api: "worldbank", q: "digital platform" }, interval_hours: 24 },
  { key: "json_freelancer", name: "Freelancer.com projects", kind: "json", category: "requirement", config: { api: "freelancer", q: "AI automation chatbot app development" }, interval_hours: 4 },
  { key: "json_adzuna_ops", name: "Adzuna: manual ops roles ({country})", kind: "json", category: "hiring", config: { api: "adzuna", q: "data entry" }, interval_hours: 24, note: "Needs ADZUNA_APP_ID and ADZUNA_APP_KEY (free)." },
  { key: "json_adzuna_support", name: "Adzuna: support roles ({country})", kind: "json", category: "hiring", config: { api: "adzuna", q: "customer support executive" }, interval_hours: 24, note: "Needs ADZUNA_APP_ID and ADZUNA_APP_KEY (free)." },
  rss("wwr_programming", "We Work Remotely: programming", "https://weworkremotely.com/categories/remote-programming-jobs.rss", "requirement"),
  rss("wwr_fullstack", "We Work Remotely: full stack", "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss", "requirement"),
  rss("wwr_devops", "We Work Remotely: devops / sysadmin", "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss", "hiring", 12),
  rss("jobspresso", "Jobspresso (remote dev roles)", "https://jobspresso.co/feed/?post_type=job_listing", "hiring", 12),
  rss("remotive_rss", "Remotive: software dev (RSS)", "https://remotive.com/remote-jobs/feed/software-dev", "hiring", 12),

  // ---------------------------------------------------------------- posted requirements: platforms with no feed, via search
  search("upwork_ai", "Upwork: AI automation jobs", "site:upwork.com/freelance-jobs (\"AI agent\" OR \"AI automation\" OR n8n OR \"voice agent\")", "requirement", 12),
  search("upwork_app", "Upwork: app and software jobs", "site:upwork.com/freelance-jobs (\"mobile app\" OR \"web application\" OR \"custom software\") {year}", "requirement", 24),
  search("freelancer_ai", "Freelancer.com: AI projects", "site:freelancer.com/projects (\"AI agent\" OR chatbot OR automation OR \"computer vision\")", "requirement", 24),
  search("pph", "PeoplePerHour: automation jobs", "site:peopleperhour.com/freelance-jobs (automation OR AI OR app OR software)", "requirement", 24),
  search("guru", "Guru: software jobs", "site:guru.com/work (automation OR AI OR \"mobile app\" OR software)", "requirement", 48),
  search("twine", "Twine: projects (free to pitch)", "site:twine.net/projects (developer OR app OR website OR automation OR AI)", "requirement", 24),
  search("workana", "Workana: projects", "site:workana.com/job (app OR software OR automation OR AI OR website)", "requirement", 48),
  search("truelancer", "Truelancer: projects", "site:truelancer.com/freelance-project (app OR software OR automation OR AI)", "requirement", 48),
  search("malt", "Malt: projects", "site:malt.com (\"looking for\" OR \"mission\") (developer OR automation OR AI)", "requirement", 72),
  search("indiehackers", "Indie Hackers: looking for a developer", "site:indiehackers.com (\"looking for a developer\" OR \"looking for a technical\" OR \"need a developer\")", "requirement", 48),
  search("quora_dev", "Quora: who can build this", "site:quora.com (\"looking for a developer\" OR \"looking for an agency\" OR \"need someone to build\") {year}", "requirement", 72),
  search("craigslist_gigs", "Craigslist: computer gigs", "site:craigslist.org (cpg OR \"computer gigs\") (app OR website OR automation OR developer)", "requirement", 48),
  search("fb_groups_dev", "Facebook groups: looking for a developer", "site:facebook.com/groups (\"looking for a developer\" OR \"need an app developer\" OR \"recommend an agency\") {country}", "requirement", 48),
  search("contra", "Contra: opportunities", "site:contra.com/opportunity (AI OR automation OR app OR developer)", "requirement", 48),
  search("li_posts_dev", "LinkedIn posts: looking for a developer", "site:linkedin.com/posts (\"looking for a developer\" OR \"looking for an agency\" OR \"need a developer\") {country}", "requirement", 12),
  search("li_posts_ai", "LinkedIn posts: need AI / automation", "site:linkedin.com/posts (\"looking for\" OR \"need\") (\"AI automation\" OR \"AI agent\" OR \"automate\") {country}", "requirement", 12),
  search("x_posts_dev", "X posts: looking for a developer", "site:x.com (\"looking for a developer\" OR \"need a developer\" OR \"looking for an AI agency\")", "requirement", 24),
  search("rfp_ai", "RFPs: AI and automation", "(\"request for proposal\" OR RFP OR \"expression of interest\") (\"artificial intelligence\" OR chatbot OR automation) {country} {year}", "tender", 48),
  search("ungm", "UN tenders: software / IT", "site:ungm.org (software OR \"information technology\" OR digital OR AI) {year}", "tender", 72),
  search("ted_eu", "EU tenders (TED): software", "site:ted.europa.eu (software OR \"artificial intelligence\" OR \"mobile application\") {year}", "tender", 72),
  search("gem_india", "India GeM / CPPP: software", "(site:gem.gov.in OR site:eprocure.gov.in) (software OR \"mobile app\" OR AI) {year}", "tender", 72),
  search("rfp_software", "RFPs: software development", "(\"request for proposal\" OR RFP) (\"software development\" OR \"mobile app\" OR \"AI\") {country} {year}", "tender", 24),
  search("need_website_industry", "Need a website/app: {industry}", "(\"looking for\" OR \"need\") (website OR app OR software OR automation) {industry} business {country}", "requirement", 24),
  search("cv_industry", "Computer vision need: {industry}", "(\"computer vision\" OR \"camera AI\" OR \"video analytics\") (pilot OR vendor OR \"looking for\") {industry} {country}", "requirement", 48),
  search("voice_agent_need", "Voice agent need", "(\"AI receptionist\" OR \"voice agent\" OR \"AI phone\") (\"looking for\" OR need OR recommend) {country}", "requirement", 48),

  // ---------------------------------------------------------------- tenders
  search("tender_uk", "UK Contracts Finder: software", "site:contractsfinder.service.gov.uk (software OR \"digital\" OR \"AI\") {year}", "tender", 48),
  search("tender_us", "SAM.gov: software / AI", "site:sam.gov (\"software development\" OR \"artificial intelligence\") {year}", "tender", 48),
  search("tender_au", "AusTender: software", "site:tenders.gov.au (software OR digital OR AI) {year}", "tender", 72),
  search("tender_ca", "CanadaBuys: software", "site:canadabuys.canada.ca (software OR \"artificial intelligence\") {year}", "tender", 72),
  search("tender_uae", "UAE tenders: software / AI", "(tender OR RFP) (\"software\" OR \"AI\" OR \"mobile app\") (Dubai OR \"Abu Dhabi\" OR UAE) {year}", "tender", 72),
  search("tender_ksa", "Saudi tenders: software / AI", "(tender OR RFP OR etimad) (\"software\" OR \"AI\") Saudi {year}", "tender", 72),

  // ---------------------------------------------------------------- hiring signals (they are hiring for work you can automate)
  search("hire_data_entry", "Hiring data entry ({country})", "site:linkedin.com/jobs (\"data entry\" OR \"back office executive\") {country}", "hiring", 24),
  search("hire_support", "Hiring support agents ({country})", "site:linkedin.com/jobs (\"customer support executive\" OR \"call center agent\" OR \"chat support\") {industry} {country}", "hiring", 24),
  search("hire_ops_industry", "Hiring ops / coordinators: {industry}", "site:linkedin.com/jobs (\"operations coordinator\" OR \"order processing\" OR \"inventory executive\") {industry} {country}", "hiring", 24),
  search("hire_quality_cv", "Hiring QC inspectors (vision signal)", "site:linkedin.com/jobs (\"quality inspector\" OR \"visual inspection\" OR \"QC inspector\") {industry} {country}", "hiring", 48),
  search("hire_first_dev", "First developer hire (outsourcing signal)", "site:linkedin.com/jobs (\"first engineer\" OR \"founding engineer\" OR \"in-house developer\") {country}", "hiring", 48),
  search("hire_indeed_ops", "Indeed: manual admin roles ({country})", "site:indeed.com (\"data entry clerk\" OR \"admin assistant\" OR \"order entry\") {industry} {country}", "hiring", 48),
  search("hire_receptionist", "Hiring receptionists (voice agent signal)", "site:linkedin.com/jobs (receptionist OR \"front desk\" OR \"appointment setter\") {industry} {country}", "hiring", 48),

  // ---------------------------------------------------------------- funding news (fresh money, pressure to scale)
  gnews("seed_country", "Seed rounds in {country}", "startup raises seed round {country}", "funding"),
  gnews("seriesa_country", "Series A in {country}", "\"Series A\" raises {country}", "funding"),
  gnews("funding_industry", "Funding: {industry}", "{industry} company raises funding", "funding", 24),
  gnews("expansion_industry", "Expansion: {industry} in {country}", "{industry} expands new plant OR new stores OR new facility {country}", "funding", 24),
  rss("techcrunch_startups", "TechCrunch startups", "https://techcrunch.com/category/startups/feed/", "funding"),
  rss("crunchbase_news", "Crunchbase News", "https://news.crunchbase.com/feed/", "funding"),
  rss("eu_startups", "EU-Startups", "https://www.eu-startups.com/feed/", "funding", 12),
  rss("tech_eu", "Tech.eu", "https://tech.eu/feed/", "funding", 12),
  rss("uktn", "UKTN (UK tech news)", "https://www.uktech.news/feed", "funding", 12),
  rss("betakit", "BetaKit (Canada)", "https://betakit.com/feed/", "funding", 12),
  rss("startupdaily", "Startup Daily (Australia)", "https://www.startupdaily.net/feed/", "funding", 12),
  rss("inc42", "Inc42 (India)", "https://inc42.com/feed/", "funding", 12),
  rss("entrackr", "Entrackr (India)", "https://entrackr.com/feed/", "funding", 12),
  rss("yourstory", "YourStory (India)", "https://yourstory.com/feed", "funding", 12),
  rss("krasia", "KrASIA (Asia)", "https://kr-asia.com/feed", "funding", 12),
  rss("pandaily", "Pandaily (China)", "https://pandaily.com/feed/", "funding", 24),
  gnews("gcc_funding", "GCC startup funding", "startup raises funding (UAE OR Saudi OR Qatar OR Bahrain)", "funding", 12),
  gnews("tech_partner", "Seeking a technology partner ({country})", "\"technology partner\" OR \"seeks vendor\" OR \"invites bids\" software {country}", "tender", 24),
  gnews("digital_push_industry", "Going digital: {industry} in {country}", "{industry} launches app OR \"digital transformation\" OR automation {country}", "funding", 24),

  // ---------------------------------------------------------------- bad review mining (pain you can show them)
  search("rev_no_response", "Reviews: no response ({industry})", "site:trustpilot.com {industry} (\"no response\" OR \"never replied\" OR \"never called back\") {country}", "review", 48),
  search("rev_slow", "Reviews: slow / lost orders ({industry})", "site:trustpilot.com {industry} (\"slow delivery\" OR \"lost my order\" OR \"no tracking\") {country}", "review", 48),
  search("rev_booking", "Reviews: booking chaos ({industry})", "(\"couldn't book\" OR \"double booked\" OR \"no one answers the phone\") {industry} reviews {country}", "review", 72),
  search("rev_reddit_service", "Reddit: worst service ({industry})", "site:reddit.com {industry} (\"worst customer service\" OR \"never answer\" OR \"no one replies\") {country}", "review", 72),
  search("rev_yelp", "Yelp: unanswered calls ({industry})", "site:yelp.com {industry} (\"never answered\" OR \"no call back\" OR \"voicemail full\")", "review", 72),

  // ---------------------------------------------------------------- launches (new businesses that will need systems)
  rss("producthunt", "Product Hunt launches", "https://www.producthunt.com/feed", "launch", 12),
  { key: "hn_show", name: "HN: Show HN launches", kind: "hn", category: "launch", config: { q: "", tags: "show_hn" }, interval_hours: 24, enabled: false },
  gnews("new_business_industry", "New {industry} businesses in {country}", "{industry} launches new brand OR opens first store {country}", "launch", 24),

  // ---------------------------------------------------------------- alert emails parsed from Gmail (turn the alerts on at each site)
  email("upwork", "Upwork", ["upwork.com"]),
  email("linkedin_jobs", "LinkedIn job", ["linkedin.com"], "hiring", "Set LinkedIn job alerts for roles like data entry, support, operations in your target countries."),
  email("google_alerts", "Google", ["google.com"], "requirement", "Create Google Alerts for phrases like \"looking for a developer\" or \"need an app built\"."),
  email("freelancer", "Freelancer.com", ["freelancer.com"]),
  email("pph", "PeoplePerHour", ["peopleperhour.com"]),
  email("guru", "Guru", ["guru.com"]),
  email("contra", "Contra", ["contra.com"]),
  email("fiverr", "Fiverr", ["fiverr.com"]),
  email("malt", "Malt", ["malt.com", "malt.uk"]),
  email("workana", "Workana", ["workana.com"]),
  email("bark", "Bark.com", ["bark.com"], "requirement", "Bark sends local service requests (UK, US, CA, AU). Create a seller profile for web/app/automation."),
  email("clutch", "Clutch", ["clutch.co"], "requirement", "Clutch inquiries and RFP alerts land here."),
  email("goodfirms", "GoodFirms", ["goodfirms.co"]),
  email("designrush", "DesignRush", ["designrush.com"]),
  email("sortlist", "Sortlist", ["sortlist.com"]),
  email("truelancer", "Truelancer", ["truelancer.com"]),
  email("wellfound", "Wellfound", ["wellfound.com", "angel.co"], "hiring"),
  email("indeed", "Indeed", ["indeed.com"], "hiring"),
  email("gem", "GeM tender", ["gem.gov.in"], "tender"),
  email("tendersinfo", "TendersInfo", ["tendersinfo.com", "tendersontime.com", "tenderdetail.com"], "tender"),
  email("contractsfinder", "UK Contracts Finder", ["contractsfinder.service.gov.uk", "find-tender.service.gov.uk"], "tender"),
  email("samgov", "SAM.gov", ["sam.gov"], "tender"),
];
