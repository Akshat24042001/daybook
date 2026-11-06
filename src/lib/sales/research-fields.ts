/** The fields a research profile fills in. Pure data, so client components can import it (enrich.ts talks to the database). */
export interface Field {
  v: string | number | boolean | null;
  src?: string | null;
  conf?: "high" | "medium" | "low";
  est?: boolean;
}
export type Enrichment = Record<string, Field>;

export const COMPANY_FIELDS: { group: string; fields: [string, string][] }[] = [
  { group: "Identity", fields: [
    ["legal_name", "Legal name"], ["brand_names", "Brands"], ["website", "Website"], ["founded_year", "Founded"], ["company_age_years", "Age (years)"],
    ["hq_city", "HQ city"], ["hq_country", "HQ country"], ["other_locations", "Other locations"], ["company_type", "Type (private, family, public, subsidiary)"],
    ["listed", "Listed?"], ["stock_exchange", "Exchange"], ["ticker", "Ticker"], ["parent_company", "Parent company"], ["subsidiaries", "Subsidiaries"],
  ] },
  { group: "Size and money", fields: [
    ["employees", "Employees"], ["employee_range", "Employee range"], ["revenue_usd", "Revenue (USD / yr)"], ["revenue_range", "Revenue range"],
    ["revenue_method", "How revenue was found or estimated"], ["growth_signal", "Growth signal"], ["funding_total", "Total funding"],
    ["last_funding", "Last round (type, amount, date)"], ["investors", "Investors"], ["pricing_model", "Pricing model"], ["avg_ticket_size", "Typical order / deal size"],
    ["budget_capacity", "Realistic budget for a project with you"],
  ] },
  { group: "Market", fields: [
    ["industry", "Industry"], ["sub_industry", "Sub-industry"], ["products_services", "Products and services"], ["industries_served", "Industries served"],
    ["customer_type", "Customers (B2B, B2C, D2C, B2G)"], ["target_markets", "Markets they sell to"], ["key_customers", "Known customers"],
    ["competitors", "Competitors"], ["differentiation", "What makes them different"], ["market_position", "Market position"],
  ] },
  { group: "People", fields: [
    ["ceo", "CEO / MD"], ["founders", "Founders"], ["key_decision_makers", "Key decision makers"], ["tech_or_ops_head", "Head of tech / ops"],
    ["hiring_now", "Open roles"], ["departments_hiring", "Teams hiring"], ["people_found", "People found"],
  ] },
  { group: "Digital footprint", fields: [
    ["tech_stack", "Tech stack seen"], ["ecommerce_platform", "E-commerce platform"], ["crm_signal", "CRM / marketing tools"], ["chat_on_site", "Chat on site"],
    ["booking_on_site", "Online booking"], ["whatsapp_on_site", "WhatsApp on site"], ["mobile_app", "Mobile app"], ["social_profiles", "Social profiles"],
    ["recent_campaigns", "Recent campaigns"], ["ad_activity", "Ads running"], ["content_activity", "Content activity"], ["website_quality", "Website quality"],
  ] },
  { group: "Contact and location", fields: [
    ["public_emails", "Emails on their site"], ["generic_email", "General inbox"], ["public_phones", "Phones on their site"], ["whatsapp_number", "WhatsApp"],
    ["address", "Address"], ["opening_hours", "Opening hours"], ["contact_page", "Contact page"],
  ] },
  { group: "Reputation", fields: [
    ["review_rating", "Rating"], ["review_count", "Number of reviews"], ["review_themes", "What customers say"], ["complaints", "Common complaints"],
    ["awards", "Awards and recognition"], ["press_mentions", "Press mentions"],
  ] },
  { group: "Domain and email", fields: [
    ["domain_registered", "Domain registered"], ["domain_age_years", "Domain age (years)"], ["registrar", "Registrar"], ["email_provider", "Email runs on"],
    ["sending_tools", "Tools they send email with"], ["nameservers", "Nameservers"],
  ] },
  { group: "Signals and pain", fields: [
    ["recent_news", "Recent news"], ["expansion_signals", "Expansion signals"], ["pain_points", "Likely pain points"],
    ["automation_opportunities", "Automation opportunities"], ["ai_maturity", "AI maturity"], ["money_leak_estimate", "What the pain costs them (est.)"],
    ["best_entry_offer", "Best first offer"], ["best_entry_person", "Who to approach"], ["risks", "Risks / red flags"], ["summary", "One-paragraph summary"],
  ] },
];

export const PERSON_FIELDS: { group: string; fields: [string, string][] }[] = [
  { group: "Who", fields: [
    ["full_name", "Full name"], ["first_name", "First name"], ["current_title", "Title"], ["seniority", "Seniority"], ["department", "Department"],
    ["company", "Company"], ["is_decision_maker", "Decision maker?"], ["decision_role", "Role in the decision"], ["reports_to", "Reports to"], ["team_size", "Team size"],
  ] },
  { group: "Career", fields: [
    ["tenure_at_company_years", "Years at company"], ["start_date_at_company", "Joined"], ["years_experience", "Years of experience"],
    ["previous_companies", "Previous companies"], ["career_timeline", "Career journey"], ["career_summary", "Background"], ["education", "Education"],
    ["graduation_year", "Graduated"], ["board_roles", "Board / advisory roles"], ["side_businesses", "Other ventures"], ["investments", "Angel investments"],
  ] },
  { group: "Personal (public only)", fields: [
    ["estimated_age", "Age (est.)"], ["age_basis", "How age was estimated"], ["location_city", "City"], ["location_country", "Country"], ["timezone", "Timezone"],
    ["languages", "Languages"], ["estimated_net_worth", "Net worth (rough est.)"], ["net_worth_basis", "How net worth was estimated"], ["interests", "Interests"], ["causes", "Causes"],
  ] },
  { group: "Public presence", fields: [
    ["linkedin_url", "LinkedIn"], ["twitter", "X / Twitter"], ["instagram", "Instagram"], ["personal_site", "Website / blog"], ["public_email", "Public email"],
    ["public_phone", "Public phone"], ["publications_talks", "Talks / articles"], ["podcasts_interviews", "Podcasts / interviews"], ["awards", "Awards"],
    ["recent_posts_topics", "What they post about"],
  ] },
  { group: "Reach them", fields: [
    ["email_found", "Email (found)"], ["email_guess", "Email (best guess)"], ["email_pattern_basis", "How the guess was made"], ["phone_found", "Phone (found)"],
    ["other_profiles", "Other profiles (GitHub, Medium, YouTube...)"], ["linkedin_snippet", "What their LinkedIn says"],
  ] },
  { group: "How to sell to them", fields: [
    ["what_they_care_about", "What they care about"], ["communication_style", "Communication style"], ["personality_read", "Personality read"],
    ["likely_objections", "Likely objections"], ["talking_points", "Talking points"], ["best_channel", "Best channel"], ["best_time", "Best time to reach"],
    ["opener", "Opening line idea"], ["risk_notes", "Watch-outs"], ["summary", "One-paragraph summary"],
  ] },
];
