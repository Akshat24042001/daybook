# AI-first and lightweight CRMs vs. Daybook's sales module (solo consultants, small agencies, India)

Research date: 2026-11-23. Method note: page fetching was blocked in this session (lightfield.app, day.ai, attio.com and breakcold.com all failed DNS resolution in the sandbox), so every finding below comes from web-search result snippets. Many of them come from third-party or competitor-written pages, such as Coffee writing about Day.ai or Breakcold and folk writing about rivals. Vendor pricing pages could not be opened directly. Treat every price as "check the live page before quoting it". Where sources conflicted, both figures are given.

## Q1. AI-native CRMs: do they exist, what AI do they have now, and what do they cost?

### Takeaway
All the named products exist and are active in 2026. The serious "AI does the data entry" players are Day.ai, Lightfield, Attio and Clarify, all US-centric and email/meeting/calendar-first, and all priced in USD at roughly $30-$100 per seat per month. None of them is built around WhatsApp, screenshots or Indian pricing. Breakcold is the only AI-leaning CRM in this set that is built around WhatsApp, LinkedIn and Telegram inboxes.

### Cited Findings
**Day.ai (Day AI)**
- Raised a $20M Series A led by Sequoia on 2 Feb 2026 and went generally available at the same time. Greenoaks, Conviction, Sound Ventures and Permanent Capital participated, Pat Grady joined the board, and the company had about 120 customers after more than a year of private testing, [Upstarts Media](https://www.upstartsmedia.com/p/day-ai-sequoia-ai-crm); [Day AI blog](https://www.day.ai/resources/series-a-and-the-beginning-of-the-shift-in-crm); [founder post on X](https://x.com/markitecht/status/2018327176508997948)
- An earlier ~$4M seed led by Sequoia was raised around 2024, [Times Magazine](https://thetimesmag.com/day-ai-revolutionizes-crm-with-4m-seed-led-by-sequoia/). CEO Christopher O'Donnell and cofounder Michael Pici are both ex-HubSpot, [Upstarts Media](https://www.upstartsmedia.com/p/day-ai-sequoia-ai-crm)
- Features, per vendor pages:
  - Agents keep person and company records current from email and meetings, and there is a "CRM Data Entry Specialist" agent template.
  - A notetaker records Zoom, Meet and Teams calls and writes each meeting into the record.
  - An "Actions" list collects commitments you made in meetings, email and Slack.
  - It auto-drafts follow-up messages for you to edit.
  - Proposed CRM changes go to a rep for approval.
  
  Sources: [Day AI: is Day AI a CRM](https://day.ai/guides/is-day-ai-a-crm); [Day AI: best call recorder](https://day.ai/guides/best-call-recorder-that-syncs-to-crm); [folk review of Day AI](https://www.folk.app/articles/day-ai-review)
- Pricing is unclear and sources conflict. Reported figures include about $30 per seat or per "assistant" to start, a "Pro" tier from $40/mo priced per Assistant, $60 Pro, and custom Enterprise. Breakcold says the price is "custom and usage based, not publicly listed", [Coffee (competitor)](https://coffee.ai/articles/day-ai-crm-pricing-comparison); [PricingSaaS](https://pricingsaas.com/companies/day); [Breakcold (competitor)](https://www.breakcold.com/uk/alternatives/day-ai). **Unverified.**

**Lightfield (formerly Tome)**
- Tome was an AI presentation app with 25M users and about $80M raised. Founders Keith Peiris and Henri Liriani cut staff from 70 to 7 and pivoted to an AI-native CRM, launched in Nov 2025, [SaaStr](https://www.saastr.com/saastr-ai-app-of-the-week-lightfield-the-ai-native-crm-that-killed-tomes-25-million-users-to-build-something-better/); [Runtime Wire](https://runtimewire.com/article/tome-founders-lightfield-47m-series-a-agent-crm)
- $47M Series A led by a16z, reported around Sept 2026 (dates vary across sources). The company says more than 5,000 businesses have signed up, which is company-reported, [Dealroom](https://dealroom.co/news/149823-ai-crm-startup-lightfield-raises-47m-series-a-led-by-a16z/); [Quasa](https://quasa.io/insights/lightfield-raises-47m-its-series-a-follows-a-seven-person-reset)
- Features:
  - Matches emails and meetings to contacts, accounts and deals.
  - Has its own call recorder.
  - You choose which fields auto-update and which stay behind review, and each change is linked to the point in the conversation it came from.
  - Updates arrive about 5-10 minutes after a call.
  - Drafts post-meeting follow-ups.
  - Offers an MCP server, REST API and CLI.
  
  Sources: [Lightfield execution page](https://lightfield.com/solutions/execution); [Lightfield data capture](https://lightfield.app/product/crm-data-capture); [Lightfield blog](https://lightfield.com/blog/automate-crm-data-entry-from-sales-calls); [folk review (competitor)](https://www.folk.app/articles/lightfield-crm-review)
- Pricing conflicts across sources:
  - Starter at about $89/user/mo or a Startup tier at $59/user/mo.
  - Pro at $899/mo per workspace with forward-deployed support, per Lightfield's own llms.txt as summarised by search.
  - Plans are built around "capture seats", per a support article updated 15 Sep 2026.
  
  Sources: [usecarly](https://www.usecarly.com/blog/lightfield-crm/); [Lightfield llms.txt](https://lightfield.app/llms.txt); [Lightfield support](https://support.lightfield.app/articles/9815515424-how-lightfield-s-pricing-works). **Unverified exact tiers.**

**Attio**
- Ask Attio, a conversational interface over records, notes, calls and email, launched on 4 Feb 2026. The official MCP server at mcp.attio.com/mcp has been GA since 19 Feb 2026. It is OAuth-only and has about 37 tools, [tl;dv](https://tldv.io/blog/attio-crm/); [reply.io](https://reply.io/blog/attio-mcp/). These are third-party sources; no primary Attio changelog was found.
- Pricing:
  - The most common figures are Plus $35 and Pro $79 per seat per month billed annually, or $44 and $99 billed monthly. Older figures of $29 and $69 are reported as out of date, [ahoy.ai](https://ahoy.ai/ai-native-crm/pricing-index/attio/); [Capterra](https://www.capterra.com/p/259360/Attio/pricing/)
  - One source says that as of 15 Nov 2026 the plans were restructured: Plus is $40 per workspace with 1 user included plus $35 per extra user, and Pro is $100 with 1 user plus $79 per extra user, [dupple](https://dupple.com/learn/attio-pricing). **Conflicting.**
  - There is a free plan. Ask Attio is metered by credits: 100, 500, 1,000 or 2,500 a month on Free, Plus, Pro and Enterprise. The MCP server is included on all plans, [dupple](https://dupple.com/learn/attio-pricing)
  - Attio prices locally in USD, GBP and EUR. No INR pricing was found, [attio.com/pricing/gbp](https://attio.com/pricing/gbp)

**Clarify ("autonomous CRM", Seattle)**
- $15M Series A in June 2025, led by USVP and Gradient (or co-led with Madrona, depending on the source). Clarify acquired Seam AI in July 2026, [GeekWire 2025](https://www.geekwire.com/2025/seattle-startup-clarify-lands-15m-to-take-on-salesforce-with-ai-native-autonomous-crm/); [GeekWire 2026](https://www.geekwire.com/2026/seattles-clarify-acquires-s-f-startup-seam-ai-joining-forces-to-challenge-crm-stalwarts/); [Madrona](https://www.madrona.com/the-autonomous-crm-has-arrived-why-we-invested-in-clarify/)
- Model: a free CRM where you "pay only when the AI agent works for you", with unlimited seats. A Starter plan at $50/mo is reported and Growth pricing is undisclosed. An older figure of a $20/mo base plus credits also circulates, [PricingSaaS](https://pricingsaas.com/companies/clarify); [Breakcold review](https://www.breakcold.com/blog/clarify-ai-crm-review)
- Auto-enrichment from connected email and calendar is confirmed (title, company, LinkedIn, funding), [Product Hunt](https://www.producthunt.com/p/clarify-6/clarify-7?page=1). Meeting-notes and next-step features were not verified.

**folk (folk.app)**
- Pricing: Standard about $24, Premium $48 and Custom from $80 per member per month on annual billing (about 20% cheaper than monthly), with a 14-day trial, [G2](https://www.g2.com/products/folk-folk/pricing); [Lightfield blog (competitor)](https://lightfield.app/blog/folk-crm-pricing)
- AI: a Follow-up Assistant drafts follow-ups from interaction history, alongside Recap and Research assistants. Sources disagree on whether these are on Standard or a higher tier, [getdex review](https://getdex.com/blog/folk-crm-review/)
- Official hosted MCP at https://mcp.folk.app/mcp with OAuth and read/write access, [folk help center](https://help.folk.app/en/articles/15503108-how-to-connect-folk-to-ai-tools-claude-chatgpt-with-mcp); [folk changelog](https://www.folk.app/changelog/meet-folk-mcp)
- Do not confuse folk.app with folk.com, an unrelated texting assistant from Nozomio, [eesel](https://www.eesel.ai/de/blog/folk-ai-assistant-preise)

**Breakcold**
- Positions itself as a CRM with a multichannel inbox covering LinkedIn, WhatsApp, Telegram, Gmail and Outlook, and lists "Claude, ChatGPT & MCP integrations", [Breakcold pricing](https://breakcold.com/pricing); [Breakcold WhatsApp](https://breakcold.com/crm/whatsapp); [Breakcold for Claude](https://breakcold.com/crm/claude)
- Pricing is contradictory even across Breakcold's own pages: one $99/mo plan with the first seat included and $10 per extra seat; $49/seat; or "$59/mo the only plan". Third parties list $29 and $59 per seat. 14-day trial, [Breakcold pricing](https://breakcold.com/pricing); [gappsy](https://gappsy.com/tools/breakcold/); [Capterra](https://www.capterra.com/p/10011093/Breakcold/pricing/). **Unverified.**

**Close**
- Plans: Solo $9, Essentials $35, Growth $99 and Scale $139 per month billed yearly, or $19, $49, $109 and $149 billed monthly. Calling and AI usage are billed on top, [Reachkit](https://reachkit.ai/directory/tools/close); [G2](https://www.g2.com/products/close/pricing)
- The AI sales agent is reported to be available from the $9 plan, [AI Agent Index](https://theaiagentindex.com/agents/close-crm). It has a remote MCP server with OAuth (see Q4).

**Pipedrive**
- Lite $14, Growth $39, Premium $59 and Ultimate $79 per seat per month billed annually, checked 14 Nov 2026. Monthly billing is about $24 for Lite and $49 for Growth. Prices vary by country: Growth showed $24 from Malaysia versus $39 from the US. No INR figure was found, [Toolradar](https://toolradar.com/tools/pipedrive/pricing.md); [Markaicode](https://markaicode.com/pricing/pipedrive-pricing/)
- The in-app AI "Sales Assistant" is reported as beta for selected users, [usecarly](https://www.usecarly.com/blog/best-ai-assistants-for-pipedrive/)

**HubSpot (Breeze)**
- Starter Customer Platform is $20 per seat per month list price, with promos of $15 or $9 on annual billing. INR pricing was not found, [Resonate](https://www.resonatehq.com/hubspot-pricing); [Sonary](https://sonary.com/content/hubspot-starter-customer-platform-review/)
- Breeze Assistant is on every plan including Free and uses no credits; it is rate-limited by requests per day instead, [default.com](https://www.default.com/post/hubspot-breeze-ai-review-and-pricing); [stackswap](https://stackswap.ai/hubspot-breeze-credits-explained)
- Breeze agents use credits:
  - Starter includes 500 credits a month, Professional 3,000 and Enterprise 5,000.
  - A Prospecting Agent lead costs 100 credits.
  - Extra credits cost about $10 per 1,000.
  
  Source: [marketingmary](https://www.marketingmary.ai/blog/how-hubspot-breeze-credits-work), checked 16 Oct 2026. Sources conflict on whether the allowance is per seat or per account.

**Salesforce**
- Starter Suite is $25/user/mo. Pro Suite is $100/user/mo on an annual contract. Agentforce is not in Starter; it is an add-on from $125/user/mo or comes with top editions from $550/user/mo, [Tech.co](https://tech.co/crm-software/salesforce-pricing-how-much-does-salesforce-cost); [meetergo](https://meetergo.com/en/magazine/salesforce-starter-suite-pricing)

**Capsule and Copper**
- Capsule: Starter about $18/user/mo. AI features (summaries, enrichment, Email Assist, Pipeline Generator) are reported on Growth at about $36. One review says no plan includes AI, [Capsule blog](https://capsulecrm.com/blog/top-rated-ai-crm-tools/); [dupple](https://dupple.com/pricing/capsule-crm). **Conflicting.**
- Copper: Gmail-centric. AI is on the Professional and Business tiers. Entry pricing is reported as $9 or $23 depending on the source, [DecisionWire](https://decisionwire.com/compare/capsule-crm-vs-copper/). **Conflicting.**

**Twenty**
- Open-source CRM. No 2026 information on its AI features or pricing turned up in search. **Gap.**

### Inferences
- The AI-native segment (Day.ai, Lightfield, Attio, Clarify) is well funded: Sequoia, a16z, $20M-$47M rounds. The core promise, "the CRM fills itself from your conversations and you approve the diffs", is now table stakes in that segment. Lightfield's per-field "auto-update vs review" toggle with source citations is the closest analogue to Daybook's "AI files each detail into fields, with field history".
- Every one of these products ingests email, calendar and meeting recordings. None of them was found to ingest WhatsApp chats, Instagram DMs or screenshots, which is where Indian solo consultants' deals actually happen.
- Pricing for a solo user ranges from roughly $9 (Close Solo, HubSpot promo) to $89 (Lightfield). Day.ai and Lightfield are priced for funded US startups, not for an Indian solo consultant.

### Gaps
- Live pricing pages for Day.ai, Lightfield, Attio and Breakcold could not be opened because fetch was blocked, so exact tiers remain unverified.
- Twenty's AI features and pricing were not found.
- No INR pricing was found for any US AI-native CRM. Attio is confirmed to show USD, GBP and EUR only.

## Q2. Which CRMs capture deals from WhatsApp or extract them from screenshots? India-focused CRMs and INR pricing

### Takeaway
Many Indian CRMs offer WhatsApp *integration*: messaging, chat sync, and lead capture via the Business API or a Chrome extension. Almost none was found to *extract structured deal fields from conversation content*. No CRM was found that ingests WhatsApp, LinkedIn or Instagram **screenshots** and turns them into deal fields. That combination looks genuinely rare.

### Cited Findings
**Screenshot and conversation extraction**
- A targeted search found no tool that works from a WhatsApp screenshot; every result described live chat ingestion, [search results incl. Albato](https://albato.com/blog/publications/whatsapp-crm-integration)
- Chrome extensions for WhatsApp Web come closest to Daybook's "AI files it into fields":
  - Chat Quotient scans selected WhatsApp Web chats, detects buying intent and auto-creates deals, with AI-drafted title, stage, priority and value, [Chrome Web Store](https://chromewebstore.google.com/detail/crm-for-whatsapp-business/ggldbbnlmbklkdollmmoahijpjkpfkne); [CQ site](https://the-cq-website-gilt.vercel.app/en/whatsapp-crm/)
  - Instant Reply creates leads when a customer shares a name, email or phone number, and pushes them to HubSpot or Pipedrive on its Pro tier, [instantreply.co](https://www.instantreply.co/features/whatsapp-crm)
  - Both are vendor claims and unverified.

**Breakcold**
- Native WhatsApp, LinkedIn and Telegram inbox inside the CRM, [Breakcold WhatsApp](https://breakcold.com/crm/whatsapp). It was not verified whether its AI extracts fields from those messages.

**Zoho Bigin (India)**
- Zoho's own India page says Bigin starts at ₹400/user/mo, [bigin.com](https://www.bigin.com/articles/bigin-india-pricing-clarification.html)
- Third-party INR prices, billed yearly before 18% GST: Express ₹400, Premier ₹720, Bigin 360 ₹1,080. Billed monthly: ₹550, ₹900 and ₹1,260. The free plan covers 1 user, [itforsme](https://www.itforsme.in/pricing/zoho-bigin-india)
- The WhatsApp integration comes with the paid Express, Premier and Bigin 360 editions. Meta bills conversations separately, [productgrowth.in](https://productgrowth.in/tools/crm-sales/zoho-bigin/)
- Zoho MCP for Bigin is available and lets Claude, Cursor and others fetch and filter records and trigger workflows, [Zoho community](https://help.zoho.com/portal/en-gb/community/topic/introducing-zoho-mcp-for-bigin)

**Kylas (India)**
- Flat ₹12,999/mo (about ₹15,339 with GST) for unlimited users, or ₹38,997 per quarter. 15-day trial, [kylas.io](https://kylas.io/kylas-sales-crm); [Techjockey](https://www.techjockey.com/detail/kylas); [rmdialer](https://rmdialer.com/blog/crm-pricing-india-per-user-cost-explained/)
- Uneconomical for 1-3 users; roughly break-even around 12, [neersoft](https://neersoft.com/crm-price-india/)

**TeleCRM (India)**
- About ₹799/user/mo billed annually or ₹1,099 quarterly, with a 3-user minimum (₹599 also appears on one TeleCRM page). One-time WhatsApp API setup of ₹1,999, and WhatsApp chat sync at +₹200/user/mo. Calling-heavy, [TeleCRM blog](https://telecrm.in/blog/best-crm-with-whatsapp-integration/); [TeleCRM LP](https://digital.telecrm.in/competitor-lp-v2); [vivelead](https://vivelead.com/blog/whatsapp-crm-india/)

**Privyr**
- Mobile CRM that works through the phone's own WhatsApp, with no Business API needed, [yespress](https://yespress.io/privyr)
- Free plan for up to 3 members, limited to engaging your most recent lead. Pro is about US$10/user/mo billed yearly or about US$22 monthly; other sources say about $35. Billed in USD, and no INR found, [Capterra](https://www.capterra.com/p/10031573/Privyr/); [closingfox (competitor)](https://closingfox.com/crm-comparisons/privyr-vs-closingfox/)

**Freshsales (India)**
- INR prices conflict across third parties:
  - Growth ₹999, Pro ₹2,799, Enterprise ₹4,999
  - ₹1,099 / ₹3,599 / ₹6,099
  - ₹1,299 / ₹3,399 / ₹6,399
  
  All per user per month plus GST, [itforsme](https://www.itforsme.in/pricing/freshsales-india); [aidukan](https://aidukan.in/is-freshsales-worth-it-india/). **Unverified.**
- AI email writing, contact scoring and deal insights are on Pro and Enterprise. The Freddy AI Agent is $49 per 100 sessions, [destackd](https://destackd.com/posts/freshsales-review-2026/)

**LeadSquared (India)**
- Sales Pro ₹2,500 and Sales Super ₹5,000 per user per month billed annually, read on 22 Oct 2026 by a competitor. An earlier source lists Lite at ₹1,250. No free plan; priced for larger teams, [HelloGrowthCRM (competitor)](https://hellogrowthcrm.com/in/compare/leadsquared); [productgrowth.in](https://productgrowth.in/tools/crm-sales/leadsquared/)

**WhatsApp-API platforms with light CRM (Interakt, WATI, DoubleTick)**
- Interakt Starter about ₹3,499 per quarter. WATI Growth about ₹2,199/mo billed yearly. DoubleTick about ₹3,000/mo for 3 agents. Meta message fees come on top for all three, [codingclave](https://codingclave.com/blog/interakt-pricing-india-2026); [itforsme](https://www.itforsme.in/best/whatsapp-crm-india); [lioncrm](https://lioncrm.site/doubletick-alternatives-whitelabel-whatsapp-crm/)
- These tools are built for broadcast and support, not consultative deal tracking.

**Refrens (India)**
- Quotation tool that shows when a client opened a quote and whether it has gone cold. It links leads to quotes and next actions, and imports leads from IndiaMART, TradeIndia and Meta Lead Ads, [Refrens](https://www.refrens.com/rf-quote-software-with-lead-management-system); [Refrens quotation](https://www.refrens.com/free-online-quotation-generator)
- The Sales CRM ("Refrens ABC") is about $150/yr per listings, [Capterra](https://www.capterra.com/p/204191/Refrens/)

### Inferences
- The Indian CRM market treats WhatsApp as a messaging pipe, through the Business API with per-message fees, not as a data source that AI reads to fill deal fields. Daybook's "paste a chat or screenshot and AI files it into fields" has no verified equivalent among Indian CRMs.
- For a solo consultant, the realistic Indian alternatives are:
  - Bigin at ₹400-720/mo
  - Privyr at about $10/mo, USD-billed
  - Refrens, for quotes
  
  Kylas, LeadSquared and TeleCRM are priced or structured for teams.
- The real threat is a general LLM (Claude or ChatGPT) plus an MCP-connected CRM, where the user pastes a screenshot into Claude and has it write to Bigin, folk or Attio. The search results said as much: "you'd likely need a vision-capable AI model … then a CRM API call."

### Gaps
- NoPaperForms was not researched; it is education-admissions-focused and likely out of scope.
- Zoho CRM's own INR pricing and Zia AI features were not verified.
- No primary-source INR pricing could be fetched for any vendor.
- Whether Breakcold's AI extracts fields from WhatsApp or LinkedIn messages is unverified.

## Q3. Which offer "next best action" or AI follow-up drafting in the user's own voice?

### Takeaway
Auto-drafted follow-ups are now common: Day.ai, Lightfield, folk, Superhuman and Shortwave all offer them. A *ranked inbox of commitments and follow-ups* exists in Day.ai's "Actions" list. Voice-matching is claimed mainly by email clients (Superhuman Business, Shortwave's Ghostwriter), not by CRMs. No product was found that combines a ranked "what needs you" inbox with voice-matched drafts across WhatsApp, LinkedIn and Instagram.

### Cited Findings
- **Day.ai** has an "Actions" list that gathers the commitments you made in meetings, email and Slack, and it automatically drafts the right message for you to edit and send, [Day AI guide](https://day.ai/guides/best-call-recorder-that-syncs-to-crm); [folk review](https://www.folk.app/articles/day-ai-review). This is the closest match to Daybook's "Moves" inbox, including tracked promises.
- **Lightfield** drafts post-meeting follow-up emails for review, and some pages say it can also send outreach, [Lightfield execution](https://lightfield.com/solutions/execution)
- **folk** has a Follow-up Assistant that drafts follow-up emails from interaction history, [getdex](https://getdex.com/blog/folk-crm-review/)
- **HubSpot** Breeze Assistant is free on all plans. Breeze agents such as the Prospecting Agent are credit-metered, [stackswap](https://stackswap.ai/hubspot-breeze-credits-explained)
- **Superhuman** "Auto Drafts" (automatic follow-up drafts) and Ask AI are reported as Business-tier only, at about $40/mo or about $33 billed annually, [fast.io](https://fast.io/resources/superhuman-ai-review-2026/); [usecarly](https://www.usecarly.com/blog/superhuman-vs-shortwave-vs-carly/)
- **Shortwave** has a voice-matched "Ghostwriter" that drafts on request. Business is $30/seat/mo ($24 billed annually) and it is Gmail-only, [get-alfred](https://get-alfred.ai/blog/superhuman-vs-shortwave); [swizero](https://www.swizero.com/blog/superhuman-vs-hey-vs-shortwave-2026)
- **Attio**: Ask Attio is conversational Q&A over records, calls and emails. No dedicated next-best-action inbox was verified, [tl;dv](https://tldv.io/blog/attio-crm/)

### Inferences
- "Next best action with drafted replies" is converging into a standard feature. Day.ai is the strongest direct comparison and should be benchmarked first. The other close matches are Lightfield for capture plus follow-up drafts, and Superhuman for voice-matched auto-drafts in email only.
- Daybook's angle is the channel: drafts for WhatsApp, LinkedIn and Instagram replies in the user's voice. Promise tracking is also differentiated, but less so, because Day.ai tracks commitments.

### Gaps
- Day.ai's and Lightfield's voice-matching claims are unverified.
- Whether Close's AI agent drafts in the user's voice is unverified.
- Not investigated: Clarify's next-step features, and HubSpot's deal-level "next best action" recommendations.

## Q4. Which have official MCP servers?

### Takeaway
An official MCP server is now **commodity**. HubSpot, Salesforce, Pipedrive, Attio, folk, Close, Zoho Bigin and Lightfield all have one, mostly free on every plan, and Breakcold markets Claude/MCP integration. Daybook's MCP server is table stakes, not a differentiator.

### Cited Findings
- **HubSpot**: remote MCP server GA from 13 Apr 2026 for all accounts. OAuth 2.1 with PKCE. Writes to contacts, companies, deals, tickets and custom objects, [HubSpot developer changelog](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available). A separate developer MCP went GA on 19 Feb 2026, [Scalekit](https://www.scalekit.com/blog/hubspot-mcp-server)
- **Salesforce**: hosted MCP servers GA in April 2026 for Enterprise Edition and above. Beta was Oct 2025, [Salesforce developer blog](https://developer.salesforce.com/blogs/2026/04/salesforce-hosted-mcp-servers-are-now-generally-available); [beta post](https://developer.salesforce.com/blogs/2025/10/salesforce-hosted-mcp-servers-are-in-beta-today). Not available on Starter, per that blog.
- **Pipedrive**: native MCP server announced 30 Jun 2026, available on all plans at mcp.pipedrive.ai/mcp, and listed in Claude's connector directory. Some setup screens still label it "BETA", [Pipedrive newsroom](https://www.pipedrive.com/en/newsroom/pipedrive-launches-native-mcp-server-bringing-crm-workflows-directly-into-ai-assistants); [BusinessWire](https://www.businesswire.com/news/home/20260630723066/en/Pipedrive-Launches-Native-MCP-Server-Bringing-CRM-Workflows-Directly-Into-AI-Assistants)
- **Attio**: mcp.attio.com/mcp, GA since 19 Feb 2026, OAuth-only, on all plans including Free, [reply.io](https://reply.io/blog/attio-mcp/); [dupple](https://dupple.com/learn/attio-pricing). Third-party sources only.
- **folk**: official hosted server at https://mcp.folk.app/mcp with read/write access over OAuth, [folk help center](https://help.folk.app/en/articles/15503108-how-to-connect-folk-to-ai-tools-claude-chatgpt-with-mcp)
- **Close**: remote MCP server with OAuth, on every plan at no extra fee, [AI Agent Index](https://theaiagentindex.com/agents/close-crm); [Reachkit](https://reachkit.ai/directory/tools/close)
- **Zoho Bigin**: Zoho MCP for Bigin, [Zoho community](https://help.zoho.com/portal/en-gb/community/topic/introducing-zoho-mcp-for-bigin)
- **Lightfield**: MCP server, [Beri](https://www.beri.net/tools/lightfield)
- **Capsule**: MCP-based AI integration, [Capsule blog](https://capsulecrm.com/blog/top-rated-ai-crm-tools/)
- **Breakcold**: "Claude, ChatGPT & MCP integrations", [Breakcold pricing](https://breakcold.com/pricing)

### Inferences
- With Pipedrive, HubSpot, Attio and folk all listed in Claude's connector directory, a user can already run "paste screenshot into Claude, update CRM" on top of these products. That partially undercuts Daybook's capture moat. The difference is that it is DIY, with no opinionated fields, no Moves inbox and no voice.

### Gaps
- Official MCP status was not verified for Day.ai, Freshsales, Kylas, LeadSquared, Copper or Twenty.

## Q5. Quote and proposal tracking tools that overlap

### Takeaway
Quote and proposal tracking with open and view analytics is a mature, commodity category, at $19-$55 per user per month in the US. In India, Refrens offers quote open-tracking linked to leads at low cost. Daybook's tracked quotes with revisions are useful but not rare.

### Cited Findings
- **PandaDoc**: Free (limited docs), Starter $19 and Business $49 per seat per month billed annually. Per-recipient and per-page analytics need Business; Free and Starter get open notifications, [toolradar](https://toolradar.com/tools/pandadoc/pricing); [portant](https://www.portant.co/blog/pandadoc-vs-qwilr-vs-proposify/)
- **Qwilr**: Starter $35/user/mo annual ($49 monthly) with 60-day analytics. Growth $55 with a 5-user minimum. No free plan, [portant](https://www.portant.co/blog/pandadoc-vs-qwilr-vs-proposify/)
- **Proposify**: Build about $39/user/mo billed yearly ($468 a year), with document analytics. Grow is $780 per user per year. No free plan, [hummingdeck](https://hummingdeck.com/blog/proposal-tracking-software-comparison-2026)
- **Refrens (India)**: quote open and "gone cold" tracking, and sent/approved/rejected/expired status tracking, linked to lead next actions, [Refrens](https://www.refrens.com/rf-quote-software-with-lead-management-system)
- **Zoho Quotes**: not verified as a standalone product. Quotes are a module inside Zoho CRM and Bigin, **unverified**.

### Gaps
- Zoho's quote open-tracking was not verified.
- INR pricing for PandaDoc, Qwilr and Proposify was not found.

## Q6. Synthesis: which Daybook sales features are commodity, and which are rare?

### Takeaway
Commodity: pipeline, custom fields, CSV import and export, multi-currency, quote tracking, MCP server, AI summaries and follow-up drafts from email or meetings, and team role permissions. Rare or unverified anywhere: AI deal capture from pasted chats and **screenshots** of WhatsApp, LinkedIn and Instagram; stage changes driven by those chats; a ranked "Moves" inbox with voice-matched drafts for messaging channels; a Telegram voice bot to update leads; and INR-first pricing aimed at a solo consultant.

### Cited Findings (evidence base; see Q1-Q5 for full citations)
- Several CRMs auto-update fields from email and meetings with human review: Lightfield, Day.ai and Attio, [Lightfield](https://lightfield.com/solutions/execution); [Day AI](https://day.ai/guides/is-day-ai-a-crm)
- No screenshot-to-CRM product was found, [search incl. Albato](https://albato.com/blog/publications/whatsapp-crm-integration)
- MCP is on every plan at HubSpot, Pipedrive, Attio, folk and Close, [HubSpot](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available); [Pipedrive](https://www.pipedrive.com/en/newsroom/pipedrive-launches-native-mcp-server-bringing-crm-workflows-directly-into-ai-assistants)
- Quote open tracking is widespread: PandaDoc, Qwilr, Proposify and Refrens, [portant](https://www.portant.co/blog/pandadoc-vs-qwilr-vs-proposify/); [Refrens](https://www.refrens.com/rf-quote-software-with-lead-management-system)
- Day.ai's Actions list tracks commitments, which overlaps with Daybook's "promises", [Day AI guide](https://day.ai/guides/best-call-recorder-that-syncs-to-crm)

### Inferences
**Feature matrix.** Key: Y = has it; P = partial; N = not found or lacks it; ? = unverified.

| Daybook feature | Day.ai | Lightfield | Attio | folk | Breakcold | HubSpot | Pipedrive | Bigin | Privyr | TeleCRM/Kylas |
|---|---|---|---|---|---|---|---|---|---|---|
| AI fills fields from email/meetings | Y | Y | P (AI attributes/Ask) | P | ? | P (Breeze) | P | ? | N | N |
| AI capture from pasted chat/screenshot (WA/LI/IG) | N | N | N | N | ? | N | N | N | N | N |
| WhatsApp channel | N | N | N | N | Y | via integrations | via integrations | Y | Y | Y |
| Auto stage moves from conversations | ? | P | ? | ? | ? | ? | ? | N | N | N |
| Ranked next-action inbox | Y (Actions) | P | N | N | ? | P | P | N | P (reminders) | P |
| Drafted replies in user's voice | P | P (email) | ? | P (email) | ? | P | ? | N | N | N |
| Quote tracking with open tracking | N | N | N | N | N | Y (Quotes) | via add-on | ? | N | ? |
| MCP server | ? | Y | Y | Y | Y | Y | Y | Y | ? | ? |
| INR pricing | N | N | N | N | N | ? | ? | Y | N (USD) | Y |
| Solo-friendly price | ? | N | Y (free tier) | Y | Y | Y | Y | Y | Y | N |

**Closest matches**
- "AI does the data entry from conversations": Lightfield (per-field auto-update with source citations) and Day.ai (data-entry agent with an approval queue). Both are email- and meeting-only.
- "Next best action with drafted replies": Day.ai (Actions list plus auto-drafts), then Superhuman Business (auto-drafts, email only). Shortwave and folk draft only when asked.

**Positioning**
- Daybook's defensible wedge is narrow but real: messaging-app-native capture (screenshots and pasted chats), for Indian solo consultants, priced in INR. Every well-funded AI CRM is email- and meeting-first and priced in USD. Every Indian CRM uses WhatsApp for messaging, not for AI field extraction.
- The main competitive risks:
  - Claude or ChatGPT plus an existing CRM's MCP connector can already approximate "paste a screenshot, update the CRM".
  - A WhatsApp Web extension such as Chat Quotient already claims AI deal creation from chats.
- Commodity or low-value differentiators: custom fields, CSV import and export, multi-currency, team portal, closing checklists, a playbook of offers and case studies (folk, HubSpot and Attio all cover parts of this), insights and forecasting, and deal sharing to WhatsApp.

### Gaps
- Several matrix cells are "?" because vendor pages could not be fetched. They need hands-on verification, especially:
  - Breakcold's AI extraction
  - Auto-stage movement at Day.ai, Lightfield and Attio
  - HubSpot and Bigin conversation extraction
- No competitor with a Telegram voice-bot lead-update feature was found. The search was not exhaustive, so this is "not found", not "does not exist".
