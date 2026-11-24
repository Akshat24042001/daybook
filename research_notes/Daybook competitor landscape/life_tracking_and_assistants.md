# Daybook competitor landscape: life tracking, journaling, personal CRM, AI briefs and messaging assistants

Research date: 2026-11-23. All prices in USD unless noted. Indian (INR) pricing was not checked for any product. Most pricing below comes from third-party trackers or App Store listings, because the vendor sites exist.io and techcrunch.com could not be fetched from this session (network allowlist). Search snippets were used instead. Treat every price as "check before quoting".

Daybook life-tracking features used as the comparison checklist:
(A) daily numeric logging (sleep, steps, screen/Instagram minutes), (B) daily score, (C) hours worked + day timeline, (D) exercise catalog + workout log, (E) diary/journal, (F) keep-in-touch personal CRM, (G) periodic review, (H) stats/charts/insights/correlations, (I) AI-generated daily newspaper PDF on Telegram, (J) AI chat that acts on all data, (K) Telegram bot as main mobile UI, (L) voice notes transcribed, (M) MCP server for Claude (read + write).

## Quantified-self, mood and habit trackers (multi-metric, daily score, correlations)

### Takeaway
Multi-metric tracking with correlations and a mood/health score is a mature, cheap category (Exist, Bearable, Daylio, Gyroscope, Welltory, all at roughly $3-13/month). None of them use Telegram as the interface, and none bundle a work timeline, personal CRM, or news brief. Exist.io is the closest conceptual match on the tracking side. Gyroscope is the closest on "health score + AI coach".

### Cited Findings
**Exist.io (exist.io)**
- Pricing: $6.99/month or $62.90/year (25% off), with unlimited connections, data points, and insights, on web, Android, and iOS. The page is undated, so it is unverified whether this is the 2026 price., [Exist "Our values" page](https://jenny.exist.io/about/values)
- MCP: no official Exist MCP server found. Third-party hosted MCP connectors exist from Composio (a hosted server you add to Claude Code or Claude Desktop/Cowork as a custom connector), Metorial, and Scalekit., [Composio Exist toolkit](https://composio.dev/toolkits/exist); [Composio Claude Code guide](https://composio.dev/toolkits/exist/framework/claude-code); [Metorial](https://metorial.com/integrations/exist); [Scalekit](https://www.scalekit.com/connectors/exist)
- (Exist's feature set, such as integrations, mood rating, and correlations, could not be fetched directly. See Gaps.)

**Bearable (bearable.app)**
- Pricing: optional subscription at $34.99/year or $6.99/month, with the annual plan frequently discounted to $18.99., [Bearable pricing & principles](https://bearable.app/pricing)
- Free tier: unlimited custom symptom and "other factors" tracking, plus CSV export. Premium adds the Impacts tab with correlation reports, a correlations grid across health outcomes, and 60/90/365-day report windows. Free users only get the Comparison Graph., [Bearable free vs premium](https://bearable.app/support/common-questions/bearable-free-vs-premium-features/)
- Third-party IAP tracker shows a range of $4.49-$49.99 (July 2026 snapshot), probably regional or promo variants., [AppPricingLab](https://apppricinglab.com/iap/apple/1482581097)

**Daylio (daylio.net)**
- Premium: $4.99/month or $35.99/year with a 7-day trial (2026 review). Lifetime is $59.99 (third-party, March 2026 IAP snapshot). Prices vary by region (NZ store shows $39.99)., [ChoosingTherapy review](https://www.choosingtherapy.com/daylio-app-review/); [AppPricingLab](https://apppricinglab.com/iap/apple/1194023242)
- A free unlimited version remains. Premium adds advanced stats, unlimited moods, and PIN lock., [Daylio premium features](https://daylio.net/faq/docs/daylio-faq/about/daylio-premium-features/)

**Gyroscope (gyrosco.pe)**
- Still live in 2026: the US App Store listing is active, the seller is Gyroscope Innovations, Inc., and the copyright line reads 2026. No shutdown found., [App Store](https://apps.apple.com/app/id1104085053); [Gyroscope FAQ](https://about.gyrosco.pe/faqs/i-got-a-new-phone-now-gyroscope-doesnt-open)
- Features: a "Health Score" with grades, insights, and trends, plus optional AI coaches that review all of your data (weight loss or muscle gain)., [App Store](https://apps.apple.com/us/app/id1104085053)
- Pricing is inconsistent across storefronts. US listings show an AI membership at $59.99, AI+ at $299, and human coaching at $399. Other listings show "Gyroscope One (Unlimited AI)" at $24.99. Unverified., [App Store](https://apps.apple.com/us/app/id1104085053)

**Welltory**
- HRV/stress-focused, with auto stress measurement via Apple Watch and AI insights. Free download with HRV measurement. A 2025-era US listing shows 1-year premium at $159.99, lifetime at $499.99, and the AI health coach add-on at $159.99/year (2021 listing: $99.99 / $299.99). No 2026 price confirmed., [App Store](https://apps.apple.com/app/welltory-heart-rate-monitor/id1074367771)

**Habit trackers (Streaks, Habitica, Loop)**
- Streaks: one-time purchase, reported as $4.99 or $5.99 (sources conflict). Habitica: freemium, with reported subscriptions from $4.99/month or $47.99/year (sources conflict). Loop Habit Tracker: free, open source, Android only. These are affiliate-style sources with conflicting data., [Toggl blog](https://toggl.com/blog/best-habit-tracker-apps); [CRM.org Habitica review](https://crm.org/news/habitica-an-organizational-tool-for-retro-gamers); [Toolradar Habitica](https://toolradar.com/tools/habitica/pricing)

**Automatic time tracking (Rize, RescueTime, Timing)**
- Rize: about $12.99-13/month entry tier (aggregators). A Professional tier at about $24/month is reported. Team plans run $29.99/seat/month (Rize's own page) with a 2-seat minimum. Free plan status conflicts across sources. 7-day trial., [Rize pricing](https://www.rize.io/pricing); [Rize small teams](https://www.rize.io/for/small-teams); [Rize llms.txt](https://www.rize.io/llms.txt); [Toolradar](https://toolradar.com/tools/rize/pricing)
- RescueTime: restructured into Solo Focus / Solo+ / Team / Team+ tiers. Costbench (Aug 2026) lists $7 / $12 / $10 / $16 per user per month. Older $6.50 and $9 listings are outdated., [RescueTime community: pricing changes](https://community.rescuetime.com/t/future-pricing-changes/1631); [Costbench](https://www.costbench.com/software/time-tracking/rescuetime/)
- Timing (Mac): no 2026 pricing found in this session.

**Open-source Telegram quantified-self bots (architecturally the closest to Daybook)**
- FxLifeSheet (Felix Krause): MIT-licensed, self-hosted Telegram bot that logs mood, wake/sleep, sleep duration and quality, body weight, and more via commands. It feeds a public dashboard (howisFelix.today)., [GitHub krausefx/FxLifeSheet](https://github.com/krausefx/fxlifesheet); [Irithys fork](https://github.com/Irithys/FxLifeSheet)
- Others: telegram-mood-tracker (mood + sleep only), radical-data/self-chatbot, and IFTTT applets that bridge Fitbit sleep or Beeminder with Telegram., [twaslowski/telegram-mood-tracker](https://github.com/twaslowski/telegram-mood-tracker); [IFTTT Beeminder/Telegram](https://ifttt.com/applets/qXgN4WQw-add-beeminder-datapoint-when-you-send-a-sleepearly-message-on-telegram)

**New-wave "AI life tracker" iOS apps (2025-2026, low-signal)**
- Jot (voice/text/photo journal + mood, energy, habit, and sleep tracking + Apple Health + AI coach), TalkTrack (conversational check-ins turned into mood/sleep/habit trackers), MyLifeInsight (speak to log sleep, diet, and mood), Mio AI Agent, and "E.Y.E." (marketed as a Life OS). These are developer claims only, with few ratings., [Jot](https://apps.apple.com/app/id6760969880); [TalkTrack](https://apps.apple.com/app/id6781355203); [MyLifeInsight](https://chrome-stats.com/d/id6759821221); [Mio](https://apps.apple.com/app/id6757940474)

### Inferences
- Feature coverage: Exist covers A, B (mood rating), and H. Bearable covers A, H (strongest correlations UX), and partly E. Daylio covers B (mood), E (micro-journal), and H. Gyroscope covers A, B (Health Score), H, and partly J (AI coach). Rize, RescueTime, and Timing cover C automatically. None of them have F, I, K, or a native M.
- Daybook's manual numeric logging plus daily score plus correlations is commodity. Exist and Bearable do the analytics better, with passive integrations instead of manual entry. Daybook's "Instagram minutes" field is just a manual version of what Screen Time, Exist, and RescueTime capture passively.
- Hours worked and a day timeline: RescueTime and Rize do this automatically. Manual logging through Telegram is lower-friction to build, but it is a weaker product.
- The new AI "speak your day and it becomes tracked data" iOS apps (Jot, TalkTrack, MyLifeInsight) are the same idea as Daybook's voice-note-to-log flow. That idea is being commoditised by low-quality indie apps right now.

### Gaps
- exist.io could not be fetched. Its 2026 integrations list, mood/score mechanics, and API details are unverified (Exist has historically had a public developer API; that is prior knowledge, not checked here).
- Timing (Mac) pricing, Welltory 2026 pricing, and Streaks' exact price are unverified.
- Gyroscope's official 2026 pricing could not be confirmed (App Store data conflicts).
- Oura, Whoop, Apple Health, and Google Fit "readiness/recovery scores" were not researched. They are direct competitors to a "daily score" and should be covered by whoever handles wearables.

## AI journaling apps

### Takeaway
AI journaling is crowded and well funded (Rosebud raised $6M in 2025; Day One added an AI tier in 2026). Every major player has AI reflection, chat-with-your-journal, and voice. Day One has an official MCP server, which neutralises Daybook's "Claude can read my diary" angle for journaling specifically.

### Cited Findings
**Day One (dayoneapp.com)**
- Gold tier launched in version 2026.7 on March 30, 2026, at $74.99/year. It includes Daily Chat (conversational journaling, with a voice mode reported), Entry Highlights, Go Deeper, title suggestions, AI image generation, and multi-entry summary. Silver (the renamed Premium) is $49.99/year. AI features have daily usage limits., [Day One pricing guide](https://dayoneapp.com/guides/premium-subscription/day-one-pricing-features-guide/); [9to5Mac, Apr 2026](https://9to5mac.com/2026/04/08/day-one-journaling-app-introduces-gold-plan-with-ai-summaries-and-daily-chat/); [Day One release notes](https://dayoneapp.com/releases/2026-7/)
- An official Day One MCP server ships with the Mac app (Labs setting, per-journal access control). Claude Desktop, ChatGPT, and others can read, search, and create entries. The official repo is bloom/dayone-mcp-server. It will not start if the password lock is on, and it requires a subscription., [Day One MCP guide](https://dayoneapp.com/guides/day-one-for-mac/day-one-mcp-server/); [GitHub bloom/dayone-mcp-server](https://github.com/bloom/dayone-mcp-server)
- Criticism (July 2026): upgrade prompts for Gold still appear even with AI turned off., [Michael Tsai blog](https://mjtsai.com/blog/2026/07/21/the-enshaittification-of-day-one/)

**Rosebud (rosebud.app)**
- Raised $6M (June 2025) for interactive AI journaling., [TechCrunch, Jun 2025](https://techcrunch.com/2025/06/04/rosebud-lands-6m-to-scale-its-interactive-ai-journaling-app)
- A competitor's review says Rosebud retired its free plan on Sept 30, 2026. Paid tiers are Bloom at $12.99/month or $107.99/year, plus Thrive 2x and Thrive 5x with higher AI budgets. This is a competitor source (Life Note blog), so it is unverified against the official page., [Life Note: Rosebud review 2026](https://blog.mylifenote.ai/rosebud-review/); [Makerstack review](https://makerstack.co/reviews/rosebud-review/)
- Do not confuse it with rosebud.ai (an AI game maker)., [summerengine](https://www.summerengine.com/ja/blog/rosebud-ai-pricing.md)

**Reflection (reflection.app)**
- iOS app "Reflection: AI Journal & Coach": free with in-app purchases. The developer is listed as Journal Better Inc. / Holstee. No pricing figures were found., [App Store](https://apps.apple.com/app/id1504547616)

**Mindsera, Stoic, Life Note**
- Mindsera: positioned as a thinking and reflection tool (voice conversation, entry analysis, emotion detection; typing, voice, and handwritten capture). Stoic: positioned as a mental health companion with AI Mentors. Life Note: AI mentors drawn from 1,000+ historical figures. All sources are vendor-written comparisons., [Mindsera article](https://mindsera.com/articles/the-7-best-ai-journaling-apps-in-2026-tested); [Life Note comparison](https://blog.mylifenote.ai/ai-journaling-apps-compared/); [Reflection: Mindsera vs Stoic](https://www.reflection.app/best-journaling-apps-compared/mindsera-vs-stoic)

### Inferences
- Daybook's diary (E), periodic review (G), and voice transcription (L) are fully commodity. Day One Gold ($74.99/year) does conversational AI journaling, summaries, voice, and MCP access better than a solo builder can.
- Prices in this category cluster at $50-130/year. Rosebud dropping its free tier suggests LLM costs are pressuring the freemium model.
- No journaling app found combines the journal with numeric life metrics, a work timeline, or a CRM in one AI context. That cross-domain context is Daybook's only real wedge here.

### Gaps
- Official pricing for Reflection, Mindsera, Stoic, and Life Note was not verified. Every comparison found was written by a competitor.
- Whether Rosebud, Mindsera, or Stoic offer an MCP server or public API was not found. Treat as unverified or likely no.
- Apple Journal (built into iOS) was not researched.

## AI personal assistants via messaging (Telegram, WhatsApp, iMessage, SMS)

### Takeaway
"An AI assistant you text" is now a hot, venture-funded category. Poke (Telegram, WhatsApp, iMessage, SMS; first Apple-approved Messages for Business agent, June 2026), Lindy Assistant (iMessage, $29.99+), Martin (SMS, WhatsApp, calls; about $21-49/month), plus indie bots (Coco, Tomo, Notis, AI Secretary). Daybook's "Telegram bot as main interface" is no longer novel. These assistants focus on email, calendar, and reminders, not life metrics.

### Cited Findings
**Poke (poke.com, The Interaction Company of California)**
- Palo Alto startup founded in 2024 by Marvin von Hagen and Felix Schlegel. Public launch dates conflict: Sept 8, 2025 (Dealroom) vs March 2026 (other outlets)., [Dealroom](https://dealroom.co/companies/poke/); [TechCrunch, Apr 2026](https://techcrunch.com/2026/04/08/poke-makes-ai-agents-as-easy-as-sending-a-text/)
- First third-party AI agent approved for Apple Messages for Business (June 2026)., [9to5Mac](https://9to5mac.com/2026/06/04/apples-messages-app-on-iphone-now-has-a-third-party-ai-agent/); [AppleInsider](https://appleinsider.com/articles/26/06/04/first-ai-agent-for-messages-business-chat-approved-by-apple)
- Works in iMessage, SMS, WhatsApp, and Telegram with no app. Connects Gmail and Outlook email and calendar, does reminders, handles voice memos, and supports group chats., [NewsBytes](https://www.newsbytesapp.com/news/science/poke-ai-launched-march-2026-operates-via-imessage-sms-telegram/tldr); [Saner.ai Poke review](https://blog.saner.ai/poke-reviews/)
- Pricing: Free, Pro, and Ultra tiers. Famous for the AI "negotiating" upgrade price in chat. The top tier is reportedly $199/month (unverified)., [Poke pricing](https://poke.com/pricing); [Layer3Labs guide](https://www.layer3labs.io/guides/poke-ai-explained)
- A Unite.AI claim that Cognition acquired Poke in 2026 is single-source and unverified., [Unite.AI](https://www.unite.ai/?p=464197)

**Lindy Assistant (lindy.ai)**
- Assistant launched over iMessage in 2026 (dates conflict: Feb, Apr 9, or May 4, 2026). Early pricing was Plus at $49.99/month with iMessage access. An Aug 2026 move to per-seat pricing made it Plus $29.99, Pro $99.99, Max $199.99 per user/month (trackers)., [Lindy blog](https://www.lindy.ai/blog/lindy-assistant-launch); [Linq case study](https://linqapp.com/blog/how-lindy-shipped-an-ai-assistant-into-imessage); [UsagePricing tracker](https://usagepricing.com/blueprint/activity/lindy-2026-08-11-packaging)

**Martin (trymartin.com)**
- Reached by SMS, phone call, WhatsApp, email, or Slack. Makes calls and sends texts on your behalf, and manages inbox and calendar. Basic is about $21/month and Pro $30/month billed yearly (Oct 2026 review). Monthly prices are reported at $35 and $49. A $499 lifetime option has been listed., [eesel Martin review](https://www.eesel.ai/blog/martin-ai-review); [App Store](https://apps.apple.com/app/id6453473083)

**Saner.ai (saner.ai)**
- ADHD-focused AI notes, tasks, and assistant. Free plan, with paid tiers at about $8 and $16/month (third-party; one source says $12)., [eesel Saner pricing](https://www.eesel.ai/blog/saner-ai-pricing); [AISO Tools](https://aisotools.com/pricing/saner-ai)

**Indie Telegram/WhatsApp assistants**
- Coco: WhatsApp, and Telegram since Feb 2026. Reminders for you and friends, Google/Outlook calendar, shared lists. Tomo: WhatsApp + Telegram. Notis: WhatsApp, Telegram, iMessage, organises your life into Notion. AI Secretary: a Telegram bot for notes and reminders., [Coco on Product Hunt](https://www.producthunt.com/products/coco-4/launches/coco-ai); [Tomo](https://www.producthunt.com/p/tomo-3/tomo-5); [Notis (Alphr)](https://www.alphr.com/notis-ai-assistant-seamless-ai-support-for-both-telegram-and-whatsapp/); [AI Secretary](https://www.producthunt.com/posts/ai-secretary-telegram-bot)
- TechCrunch ran a roundup, "All the AI agents that can live in your text messages" (Oct 10, 2026), which confirms this is a recognised category. The full text could not be fetched., [TechCrunch](https://techcrunch.com/2026/10/10/all-the-ai-agents-that-can-live-in-your-text-messages/)

**Limitless / Rewind**
- Meta acquired Limitless (formerly Rewind) on Dec 5, 2025. Pendant ($99) sales stopped, the Rewind app was discontinued (capture reportedly disabled around Dec 19, 2025), existing users got a free unlimited plan for a year, and service ended in the EU/UK., [TechCrunch](https://www.techcrunch.com/2025/12/05/meta-acquires-ai-device-startup-limitless/); [9to5Mac](https://9to5mac.com/2025/12/05/rewind-limitless-meta-acquisition/); [TechInformed](https://techinformed.com/meta-acquires-limitless-pendant-users-moved-to-free-unlimited-plan/)

### Inferences
- Feature coverage: Poke covers K (Telegram), J (partly: acts on email and calendar), and L (voice memos). Martin and Lindy cover J (email, calendar, calls) but not Telegram. None track life metrics, journals, scores, or workouts. Notis is the closest to "chat to log into a structured life database", because it writes to Notion.
- Daybook's Telegram interface is commodity in 2026. The differentiator would be that the bot writes to a typed personal dataset (sleep, steps, workouts, contacts, time segments), not that it is on Telegram.
- Poke and Lindy compete for the same "proactive morning message" slot that Daybook's newspaper fills.
- Limitless leaving the market removes the main "life recorder" competitor and shows the risk in this space: acqui-hire exits and discontinued products.

### Gaps
- Dola, Ava, Mem (Mem 2.0 pricing and status), and Meta AI on WhatsApp were not verified in this session. Do not cite them without checking.
- Poke's exact Pro/Ultra prices and whether Poke exposes MCP (it is reported to integrate with MCP servers; not verified here).

## Personal CRM / keep-in-touch apps

### Takeaway
Keep-in-touch reminders are a solved, cheap category. Dex ($12/month) and Mesh (the former Clay, about $10/month Pro, free up to 1,000 contacts) lead. Monica is open source and self-hostable, with v3 being rebuilt for late 2026. Covve is active, and UpHabit looks stagnant.

### Cited Findings
- Clay (clay.earth) is now Mesh (me.sh). It is the same app under a new name, and the clay.earth domain redirects. Mesh's own story dates the rename to March 2026, though some reviews say 2024. It is not Clay.com, the B2B enrichment tool., [Mesh story, Mar 2026](https://me.sh/stories/mesh); [Product Hunt "Clay is now Mesh"](https://www.producthunt.com/p/clay/clay-is-now-mesh); [App Store](https://apps.apple.com/us/app/mesh-contacts-crm/id1463073824)
- Mesh pricing: the free Personal plan is capped at 1,000 contacts, there is a 14-day Pro trial, and Pro is about $10/month annual. Team pricing conflicts ($40 vs $49 per seat). It prompts you to reach out to contacts who have gone quiet. No Android app., [Mesh pricing](https://me.sh/pricing); [Dex: Mesh review](https://getdex.com/blog/mesh-review/); [Happenstance guide](https://happenstance.ai/guides/best-personal-crm)
- Dex: keep-in-touch frequency per person or group, auto-updates from email, meetings, and messages, and daily or calendar-based reminders to log interactions. $12/month billed annually. A free version exists, but reminders may be behind Premium (unverified)., [Dex pricing](https://getdex.com/pricing.md); [Capterra](https://www.capterra.com/p/275020/Dex/); [App Store](https://apps.apple.com/app/id1472132715)
- Monica: open source (AGPL-3.0, about 25.7K GitHub stars), self-hostable or hosted, single-user, with notes, journal, reminders, and activity history. Its site says v3 is "rebuilt from scratch" and coming before the end of 2026., [monicahq.com](https://monicahq.com/); [Monica rebuild blog](https://monicahq.com/en/blog/we-are-rebuilding-monica); [OpenAlternative](https://openalternative.co/monica)
- Covve: active in 2026, mobile-first, from $12.99/month (Software Advice). UpHabit: App Store shows a "Super Connector" plan at $24.99/month and a © 2025 copyright, with no 2026 activity found., [Software Advice Covve](https://www.softwareadvice.com/crm/covve-profile/); [UpHabit App Store](https://apps.apple.com/us/app/id1335632832)

### Inferences
- Daybook's keep-in-touch reminders (F) are commodity. Dex and Mesh add email, LinkedIn, and calendar sync that Daybook almost certainly lacks.
- Monica is notable as the only one with a built-in journal next to the CRM, which is the closest to Daybook's "diary + people" mix, but it has no metrics or AI.

### Gaps
- Whether Dex or Mesh ship an MCP server or public API was not verified. Mesh describes itself as "personal AI-friendly CRM built on open source principles", which suggests an API, but this is unconfirmed.

## Personalized AI news briefs / newspapers (PDF?)

### Takeaway
AI daily briefings are now built into the big assistants (ChatGPT scheduled tasks after Pulse was retired; Google Daily Listen; Huxe audio briefs; Particle digests). No current commercial product was found that delivers a personalised AI-written newspaper as a PDF, let alone over Telegram. Only DIY open-source tools (Morning Paper, GPT Newspaper) and dead print services (PaperLater, niiu). This is Daybook's most unusual feature, but it is easy to replicate.

### Cited Findings
- ChatGPT Pulse launched Sept 25, 2025 as a Pro-only, mobile-only proactive morning brief. OpenAI's help page now says Pulse is being retired. Users can instead ask ChatGPT to schedule a daily briefing via scheduled tasks (memory must be on)., [TechCrunch, Sep 2025](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs); [OpenAI help: ChatGPT Pulse](https://help-lb.openai.com/en/articles/12293630-chatgpt-pulse)
- Google Daily Listen: a Search Labs experiment (early 2025) that makes an approximately 5-minute personalised audio episode from topics you follow in Search/Discover. US Labs only at launch., [TechRadar](https://techradar.com/phones/google-discovers-new-experimental-daily-listen-feature-turns-your-news-feed-into-a-podcast); [Android Authority](https://www.androidauthority.com/daily-listen-3514525/)
- Huxe: built by ex-NotebookLM developers (Sept 2025). An audio daily briefing from your email, calendar, and interests, which you can interrupt with questions., [TechCrunch, Sep 2025](https://techcrunch.com/2025/09/23/former-notebooklm-devs-new-app-huxe-taps-audio-to-help-you-with-news-and-research); [App Store](https://apps.apple.com/app/id6743417504)
- Particle: personalised news app with daily digests. Free with in-app purchases, reportedly $2.99/month or $29.99/year (paywall tracker, possibly outdated)., [App Store](https://apps.apple.com/us/app/6683283775); [Adapty paywall library](https://adapty.io/paywall-library/particle/)
- Readwise Reader: no free tier, about $9.99/month annual or $12.99/month monthly. It is read-later, and no scheduled news digest was found (competitor claim)., [Readless](https://www.readless.app/blog/readwise-reader-pricing-2026)
- PDF newspapers: "Morning Paper" is an open-source Python CLI that builds a print-ready personalised daily PDF from Hacker News and RSS. GPT Newspaper is open source (LangChain sub-agents). Pocket Dispatch emails or sends to Kindle. PaperLater (UK, printed, mailed, 2014) and niiu (Berlin, 2009) are historical. July 2026 coverage describes developers DIY-generating personal newspapers with Codex., [PyPI morning-paper](https://pypi.org/project/morning-paper/0.4.4/); [GPT Newspaper README](https://raw.githubusercontent.com/rotemweiss57/gpt-newspaper/master/README.md); [Pocket Dispatch](https://www.producthunt.com/p/pocket-dispatch); [Kursiv, Jul 2026](https://kz.kursiv.media/en/2026-07-23/engk-yeri-how-ai-is-helping-gen-z-build-a-print-news-revolution/)

### Inferences
- The "AI newspaper PDF on Telegram" format is rare as a product, but anyone can replicate it with ChatGPT scheduled tasks, Claude scheduled tasks, or Morning Paper plus a Telegram bot in an afternoon. It is a delightful feature, not a defensible moat.
- The niche topic mix (AI, China tech, chips, India business) is unusual. No product found targets an India-based tech or business reader with such a brief. That is a positioning angle, not a technology moat.

### Gaps
- Artifact's shutdown (prior knowledge: closed in early 2024, tech acquired by Yahoo) was not re-verified in this session. Perplexity Discover and Feedly AI were not researched.
- Google Daily Listen's 2026 status (graduated, expanded, or killed) is unknown.

## "Life OS" bundles and MCP / API availability

### Takeaway
No product found bundles Daybook's full combination (metrics + score + work timeline + workouts + journal + CRM + newspaper + AI agent + Telegram + MCP). The market is split into vertical leaders. MCP access exists for Day One (official) and Exist (third-party via Composio, Metorial, Scalekit). Notion-based setups (Notis) are the closest "chat into one life database" pattern.

### Cited Findings
- Lunatask: freemium "all-in-one" planner with tasks, habits (7 on free), a mood tracker with energy and busy levels, a journal, and notes. The free plan has 2 Areas of Life. Paid is monthly or yearly (yearly saves 2 months). A 2022 lifetime deal was $49 (outdated). The current price was not found., [Lunatask](https://lunatask.app); [App Store](https://apps.apple.com/us/app/lunatask/id1583719331)
- Official MCP: Day One (Mac)., [Day One MCP guide](https://dayoneapp.com/guides/day-one-for-mac/day-one-mcp-server/)
- Third-party MCP: Exist (Composio, Metorial, Scalekit)., [Composio](https://composio.dev/toolkits/exist)
- Notis: chat-based (WhatsApp, Telegram, iMessage) assistant that organises life into Notion., [Alphr](https://www.alphr.com/notis-ai-assistant-seamless-ai-support-for-both-telegram-and-whatsapp/)

### Inferences

**Closest overall matches (ranked):**
1. **FxLifeSheet + a DIY stack** (open source Telegram logger with dashboards). Same architecture as Daybook: Telegram-first manual logging of sleep and mood with charts. It lacks AI, CRM, a newspaper, and MCP. This is the "someone already built this as a hobby project" signal.
2. **Exist.io + MCP (Composio).** Multi-metric, correlations, mood score, and Claude-readable. It lacks Telegram, journal depth, CRM, workouts, and a newspaper.
3. **Gyroscope.** Health Score plus AI coach over all health data. It lacks Telegram, CRM, work time, and a newspaper.
4. **Poke** (or Notis). Telegram-native AI assistant with reminders and voice. It lacks a structured life dataset, scores, and charts.
5. **Day One Gold + MCP.** Best AI journal, Claude-accessible. It lacks metrics, CRM, and Telegram.
6. **Lunatask.** Bundles habits, mood, journal, and tasks in one app. It lacks AI chat, Telegram, and a CRM with cadence.

**Commodity vs rare for each Daybook feature:**

| Daybook feature | Verdict | Who already does it (better) |
|---|---|---|
| (A) Sleep, steps, screen logging | Commodity | Exist, Gyroscope, Bearable (passive integrations beat manual entry) |
| (B) Daily score | Commodity | Daylio and Exist (mood), Gyroscope Health Score, wearables |
| (C) Hours worked / timeline | Commodity | Rize, RescueTime (automatic) |
| (D) Exercise catalog / workout log | Commodity | Not researched here (Strong, Hevy and others) |
| (E) Diary + (L) voice transcription | Commodity | Day One Gold, Rosebud, Mindsera |
| (F) Keep-in-touch CRM | Commodity | Dex, Mesh, Monica |
| (G) Periodic review, (H) stats/correlations | Commodity | Bearable, Exist |
| (K) Telegram bot interface | Becoming commodity | Poke, Coco, Tomo, Notis |
| (J) AI agent acting across all personal domains | Uncommon | Assistants cover email and calendar, trackers cover metrics; nobody spans both |
| (M) MCP server with write access to life metrics | Uncommon | Day One (journal only), Exist (third-party) |
| (I) AI newspaper PDF on Telegram, India/China/chips focus | Rare as a product | Trivially replicable |

- Brutal summary: every individual life-tracking feature in Daybook is commodity. The only defensible thing is one unified, typed personal dataset across health, work, people, and journal, writable from Telegram and readable/writable by Claude via MCP. Even that is replicable by Exist + Day One + Dex, each with MCP or Composio connectors, wired into Claude. The integration and the single-user fit are the product, not any one feature.

### Gaps
- Capacities, Reflect, Amie, and Notion "Life OS" templates were not researched in this session. Their MCP and API status is unverified (Notion has an official MCP; that is prior knowledge, not checked here).
- MCP or API status for Bearable, Daylio, Gyroscope, Rosebud, Dex, Mesh, Poke, and Lunatask was not verified.
- No India-specific competitors (INR-priced or India-built life OS or assistant apps) were researched. That is a notable gap given the founder's market.
