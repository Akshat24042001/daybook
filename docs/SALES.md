# Sales

The Sales section of Daybook: capture every conversation with as little typing as possible, always know the next move,
find at least one qualified opportunity a day, and track every quote until the money is in.

## Screens

| Screen | What it is for |
|---|---|
| **Moves** (`/sales`) | Everything that needs you, ranked: replies waiting, promises, follow-ups, hot quotes, money, new radar leads. Draft in your voice, send in one tap, it logs itself. |
| **Pipeline** | Board by stage with drag and drop (allowed stages light up while you drag, the rest fade), or a list ranked by priority. Sort cards by priority, value, last touch, time in stage or newest. Stages also move by themselves as conversations happen. |
| **Deal** | Where we are (auto-written), timeline across every channel, last touch per channel, promises both ways, documents and their opens, money, people (decision makers, referrer, intermediary), research, stage history. |
| **Radar** | Leads found on the internet, scored against your offers, with the angle to open with. Sources on/off and their hit rates. |
| **Accounts** | Companies and people, with 50+ researched fields each. Merge duplicates, import from Contacts. |
| **Documents** | Tracked quotes (with revisions), opportunity briefs, files and links. |
| **Review** | The honest numbers: conversations started, reply rate by channel, where deals die, cash, promises broken. |
| **Insights** | Your monthly target with pace and forecast, the weekly activity it takes, the funnel, win rate by service, country, source and deal size, quotes, what gets replies, and how fast you respond. |
| **Playbook** | Your offers (with packages and prices), proof (case studies), the objections you hear with your best answers, and the do-not-contact list. Drafts and the radar use all of it. |
| **Settings** | The state machine, your voice, targeting, rhythm, phone escalation, keys, Google, bookmarklet, iPhone Shortcut. |

## The state machine

Stages and allowed moves live in the database and are editable in **Sales, Settings**. Automation only targets stages by
their built-in *role*, so renaming or reordering never breaks it. Custom stages can be added; automation leaves deals in
them alone.

| Stage (role) | Kind | Win % | Limit | Means |
|---|---|---|---|---|
| New | open | 5 | 2d | Found or captured, not contacted |
| Contacted | open | 10 | 21d | First touch sent, no reply yet |
| In conversation (engaged) | open | 20 | 7d | They replied |
| Discovery | open | 35 | 10d | Meeting booked or held |
| Proposal sent | open | 50 | 7d | A quote is with them |
| Negotiation | open | 65 | 7d | Price, scope or terms being worked out |
| Won, advance pending | won | 90 | 7d | They said yes, no money yet |
| Project live (active) | won | 100 | | Advance received |
| Delivered, balance due | won | 100 | 14d | Handed over, final payment pending |
| Paid in full | won | 100 | | Every payment received |
| Nurture (not now) | parked | | | Interested later: needs a revisit date |
| Ghosted | parked | | | No reply after the full sequence |
| On hold | parked | | | Client paused: needs a revisit date |
| Lost | lost | | | Needs a reason |
| Disqualified | lost | | | Not a fit: needs a reason |

**Automatic moves** (only along allowed edges):

| Event | From | To |
|---|---|---|
| You send something | New | Contacted |
| They reply | New, Contacted, Ghosted, Nurture, On hold, Lost | In conversation |
| Meeting booked or held (calendar, transcript, or said in a chat) | New, Contacted, In conversation, Nurture, On hold, Ghosted | Discovery |
| Quote sent | New, Contacted, In conversation, Discovery, Nurture, On hold, Ghosted | Proposal sent |
| Revised quote sent | Proposal sent | Negotiation |
| Price objection in a conversation | Proposal sent | Negotiation |
| Client clicks Accept on the quote page | any open stage | Won (forced: the client is ground truth) |
| First payment received | Won | Project live |
| Last payment received | Won, Live, Delivered | Paid in full |
| Follow-up sequence exhausted, never a reply | Contacted | Ghosted (revisit date set) |

**Rules**
- A manual move must follow an allowed edge and meet its requirement: Lost and Disqualified need a reason, Nurture and On
  hold need a revisit date, Proposal needs a sent quote (or a note saying how you sent it).
- The AI may move a deal **forward**, but never closes one. "Not now", "we went with someone else" or "sounds good, go
  ahead" become a one-tap suggestion in Telegram, not a silent stage change.
- Closed or parked deals stop generating chase moves. Parked deals come back as a "Revisit" move on their date.
- Intermediaries: a deal can have a referrer and an intermediary (agency, broker, consultant, partner) with commission
  (percent or fixed). Turn on "follow-ups go to the intermediary" when the client only talks through them.

## How replying works (every button, everywhere)

- A button only appears when it can do what its label says. No LinkedIn profile saved means no "LinkedIn" button;
  you get **Find on LinkedIn** (a real LinkedIn people search) instead.
- Radar leads are answered where they were posted: **Reply on Reddit / Hacker News / X**, **Open the job on Upwork**,
  **Open the LinkedIn post**. The draft is written for that platform (a helpful comment, or a proposal).
- Signals (hiring, funding, bad reviews) have nobody to reply to yet: **Find who decides at <company>** opens a search
  for the founder or operations head, and **Their website** opens the site.
- **WhatsApp** opens your chat with the text typed in. **Email** opens your mail app, or **Send from Gmail** sends it for
  real once Google is connected. **LinkedIn profile** copies the text and opens the profile (LinkedIn cannot pre-fill
  messages: press Message and paste).
- Opening anything never counts as sending. The card asks **Did you send it on …?** and only **Yes, sent** logs it.
  In Telegram the same is the **✅ Sent it** button. **Done another way** closes a move without logging a message.
- The AI's company, contact and website for a radar lead are kept only if they appear in the post itself, and drafts
  may only use facts from the conversation or post.

## Priority

Every deal has a priority from 0 to 100, recomputed every 10 minutes, with the reasons shown and a trend arrow against
yesterday. Hot is 70+, Warm 45+, Steady 20+, Cold below.

| Part | Points | What drives it |
|---|---|---|
| Engagement | 0 to 35 | How recently they engaged, this person or anyone at the same company; fades over about a week |
| Momentum | 0 to 10 | Replies in the last 14 days; minus a bit when they are cooling compared to the 14 days before |
| Intent | 0 to 15 | Quote opened in the last 48 hours (3+ opens counts more), a meeting in the next 3 days |
| Value | 0 to 15 | Deal size on a log scale |
| Stage | 0 to 15 | How far along it is |
| Urgency | 0 to 10 | Overdue moves, your promises due now |
| Comeback | +15 | They, or their company, wrote again after 60+ days of silence |

Parked and lost deals stay low until there is fresh contact; finished projects stay low unless something needs you.
So a lead that went quiet for six months jumps back to the top the day they write again.

## Capture: how logging happens without you typing

| Channel | How it gets in | Your effort |
|---|---|---|
| Gmail | Apps Script in your Google account pushes new mail every 5 minutes. Known people and companies are matched by email and domain; unknown senders are judged by AI and confirmed with one tap. | none |
| Calendar | Same script. Meetings with known people move the deal to Discovery; a meeting with a new person creates a lead. You get a brief 15 minutes before and a debrief prompt after. | none |
| Google Meet | Transcripts and "Notes by Gemini" docs are picked up and filed to the meeting's deal (needs transcription on your Workspace plan). | none |
| Email you send from Daybook | Sent from your Gmail through the script and logged with Gmail's id. | one tap |
| WhatsApp / LinkedIn / call links from Daybook | The one-tap link logs the touch, then opens the app with the draft ready. Marked "via link" because Daybook cannot see the app send it. | one tap |
| WhatsApp (your number) | Export chat (Without media) and share it to the Telegram bot. Re-exporting the same chat only adds new messages. Or forward single messages to the bot. | 5 seconds |
| LinkedIn / Instagram DMs | Screenshot to the Telegram bot (AI reads the image), or the bookmarklet on desktop. | 3 seconds |
| Calls and in-person meetings | Voice note to the bot ("met Priya, she wants...") or reply to the debrief prompt. iPhone call recording transcripts can be shared from Notes with the Shortcut. | 30 seconds |
| Anything else | Paste it into any "Log it" box, or the iPhone Shortcut from the share sheet. | seconds |

Every capture becomes: the right person (identity matching on email, phone, LinkedIn, Instagram, then name), the right
deal, timeline entries, promises both ways, an updated "where we are", stage moves, and fresh moves. Every capture card
has **Wrong person** and **Undo**.

**What is not possible, honestly:** personal WhatsApp and LinkedIn have no official API. Tools that read them automatically
break their terms and risk a ban on the accounts you sell with, so Daybook does not do it. iPhone does not let apps read
the call log.

## Lead radar

- 111 sources out of the box: 25 subreddits, Hacker News (including the monthly "Seeking freelancer" thread), free job
  and project APIs (RemoteOK, Remotive, Arbeitnow, Jobicy, Himalayas, Freelancer.com, Adzuna), platforms without feeds
  through search (Upwork, Freelancer, PeoplePerHour, Guru, Contra, LinkedIn and X posts), tenders (UK, US, Australia,
  Canada, UAE, Saudi), hiring signals (companies hiring data entry, support, coordinators, receptionists, QC inspectors,
  a first developer), funding news (Google News per country plus 13 startup news feeds), bad-review mining (Trustpilot,
  Yelp, Reddit), launches (Product Hunt), and 22 alert-email sources parsed from Gmail (Upwork, Bark, Clutch, GeM, ...).
- Every item is scored by AI against your offers. Hot ones (85+, fresh) are pushed to Telegram within the 15-minute cycle.
- **At least one a day:** the morning digest counts qualified items from the last 24 hours. If short, it hunts with
  intent-signal searches for this week's country and today's industry, twice. If even that fails, it says so plainly and
  keeps hunting through the day. It never inflates a score to fill the quota.
- One country per week and one industry per day, chosen adaptively from results (see below); the lists are editable.
- Replying to a radar lead from Daybook turns it into a tracked deal automatically.

## Hunts: scheduled AI lead hunting

Radar > **Hunts**. A hunt is an AI that searches the web for buyers on a schedule you set. Make as many as you like.

- **Brief**: who you want to find, in plain words. The AI turns it into fresh, high-intent search queries every run and
  scores every result against it (on top of your offers).
- **Where**: countries, industries and exact phrases (always searched word for word). Empty countries/industries use
  the radar's weekly and daily rotation. Pick the signals: asking for help, hiring for manual work, funding and
  launches, broken-process complaints, tenders. Optionally sweep the radar's feeds in the same run.
- **When**: every N hours (optionally only between two hours, for example 8 to 20), or at a set time on chosen days.
  Presets: every hour, hourly 8 to 20, every 3 hours, daily 09:00, weekdays 09:00. Your timezone. **Run now** any time.
- **It learns**: leads you turned into deals or kept steer the next queries toward more like them; leads you skipped
  steer them away. Queries used in recent runs are never repeated.
- **Results** land in Radar > Qualified, tagged with the hunt, with Draft reply and Make it a lead as usual. Strong
  ones reach Telegram; each run ends with a short report. Every run is logged with the exact queries it used.
- **Cost**: the form shows roughly how many searches a day a schedule spends. Paid providers (Tavily, Serper, Brave)
  stop at your daily cap in Settings; after that the free DuckDuckGo fallback runs, which is much weaker. Hourly
  hunts with many searches need a paid plan or a higher cap.
- **Plan & platforms** shows exactly what the radar is doing: this week's country and today's industry, the next 7 days of rotation, every platform and whether it is on, paid-search spending, what each source looks at today and when it runs next, every hunt's schedule and last queries, and a log of the last 60 searches that really ran.
- **Hide** any lead (or a whole list) to tuck it away; tick "Show hidden leads" to see and restore them.
- A starter hunt, "Daily deep sweep" at 08:30, is created the first time you open the page. Edit or delete it freely.

## Deep research on leads

Every lead can be researched, and the result is one tap away at any time: Radar > a lead > **Research**. Strong leads
(score 70 and up, changeable in Settings) are researched automatically the moment they are scored. It uses public
sources only and runs in stages, so you can watch it work and nothing is lost if a step is slow.

1. **Their website**: the home page plus about, team, contact, careers, services, pricing and news pages. It pulls out
   emails, phones, social profiles, addresses and the company's own structured data (staff count, founders, rating).
   It also reads the domain: registration date and age, registrar, where their email runs (Google Workspace,
   Microsoft 365...) and which tools they send email with. These facts come straight off the pages and DNS, never from the AI.
2. **The web**: twelve targeted searches on revenue, size, leadership, reviews and complaints, news, funding, hiring,
   competitors and customers, plus people searches.
3. **The profile**: the AI writes 60-plus company facts from that evidence only, each with its source and a confidence,
   and estimates revenue when it is not published (marked as an estimate, with the maths).
4. **The people**: named leadership and key people become contacts; each decision maker is researched in turn (career,
   background, what they care about, an opening line). Their work email is worked out from how colleagues' addresses look
   and is always labelled a **guess, unverified**.

The research sheet shows the company, how to reach them, every person, all the facts, **where each came from** (every
page and search used) and a plain log of what the researcher did. A lead that names no company says so and lets you type
one. "Wrong company?" re-runs it on the right one. The same profile appears on the deal and the account.

## Tracked documents

Send links, not attachments. Quotes, opportunity briefs, files and any URL (Loom, Drive, a case study) get an unguessable
link with no password. Every open is recorded (time, city, device, seconds on page, revision), bots and link previews are
ignored, your own opens never count, and a fresh open pings Telegram. A quote opened 3 times in 2 hours triggers a "call
now" move (and an emergency call if you enabled it). Sent revisions are locked; changes make a new revision, and the
client sees what changed. The client can **Accept** on the page: the deal becomes Won and the payment plan becomes
payments with due dates.

## Telegram

- **💼 Sales** key (send `/start` once to refresh the keyboard): moves, radar, pipeline.
- Forwarded messages, photos, chat exports and texts starting with `lead:` go to Sales. Voice notes about clients are
  recognised automatically.
- Morning brief at 9:00, radar digest at 9:00, pre-call brief 15 minutes before meetings, debrief prompt after them,
  quote opens, accepted quotes, Sunday review at 18:00.

## Phone escalation

OmniDimension calls your phone only for: a quote accepted, a proposal opened 3+ times in 2 hours, a hot inbound lead.
At most `max_per_day` calls (default 2), never twice for the same thing, never in quiet hours.

## Environment variables

Already set for Daybook: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD`,
`APP_BASE_URL`, `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

New, all free or free tier:

| Variable | Needed for | Where |
|---|---|---|
| `GEMINI_API_KEY` | Strongly recommended: screenshots, long transcripts, research. Free tier. | aistudio.google.com, Get API key |
| `TAVILY_API_KEY` | Web search for radar and research (1,000 / month free, no card) | tavily.com |
| `SERPER_API_KEY` | Second search provider (2,500 free) | serper.dev |
| `BRAVE_API_KEY` | Optional third search provider | brave.com/search/api |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reliable Reddit (servers are often blocked without it) | reddit.com/prefs/apps, create "script" app |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Hiring signals per country | developer.adzuna.com |
| `OMNIDIM_API_KEY`, `OMNIDIM_AGENT_ID`, `OWNER_PHONE` | Emergency calls to you (`OWNER_PHONE` like `+919664911105`) | omnidim.io |
| `JINA_API_KEY` | Optional: more reads of JavaScript-heavy websites | jina.ai |
| `GEMINI_MODELS`, `AI_VISION_MODELS` | Optional model overrides | |

Without any search key the radar still runs on its keyless sources (Reddit, HN, RSS, Google News, job APIs) and a
DuckDuckGo fallback, but search-based sources and research will be thin.

## Updates on deploy

Nothing to run by hand. On every cold start Daybook applies new `db/migrations/*.sql`, seeds defaults, and syncs the radar
source catalogue from `src/lib/sales/radar-catalog.ts` (new sources appear, your on/off switches are kept). Sales work runs
inside the existing every-minute tick.

## Learning from results

Daybook records what every message was for and how it went, and uses that everywhere.

**Which messages got a reply.** A message sent from a move remembers the move (first message, follow-up 2, re-engage...),
the channel, and whether you sent the AI draft as is, edited it, or wrote your own (compared with the AI's original
words, kept separately from your edits). One-tap WhatsApp or LinkedIn links count as sends, but "edited" stays unknown for
them: Daybook cannot see what you changed inside the app. A message counts as answered when
they reply (or you speak) before your next message, within 14 days. Messages less than 3 days old with no answer are left
out until they have had a fair chance. Several messages within 30 minutes count as one send. Insights shows reply rates by
purpose, channel, time of day, weekday, length and draft use; a finding is only stated with at least 5 sends and a real
gap. **Drafts use it:** each new draft is shown your real messages of the same kind that got replies, closest first.

**Adaptive targeting.** Each country (weekly) and industry (daily) on your lists earns points over 120 days: 1 per
qualified lead, 3 per conversation, 10 per deal won, divided by how many turns it already had as the focus. The leader gets
most turns, 20% of turns (changeable) go to the least-tested entry, and with no results yet it rotates evenly. Each choice is
stored with its reason, shown in Radar > Plan along with the full results table. Switch back to even rotation in Settings.

## Target, forecast and the activity it takes (Insights)

Set a monthly revenue target in Sales settings. Insights shows won this month (deals that reached a Won stage), where you
should be today if it came in evenly, cash received, and a projection: won plus the open deals likely to land this month
(expected to close this month, or already at proposal or negotiation), weighted by their win chance. It then works
backwards from **your own** conversion rates (average won deal, proposal to win, conversation to proposal, contacted to
conversation, over 180 days) to the deals, proposals, conversations and outreach needed: to close this month's gap, and
every week to sustain the target. A rate with fewer than 5 cases is replaced by a stated assumption, marked as one.

Win rate means won divided by closed, where closed is won, lost, disqualified or ghosted. The funnel is cumulative.
Quotes show acceptance with and without a discount, by number of revisions and by size. Speed shows time to first message
for leads that came to you or the radar found (not deals you started), with conversation rates per speed band, and your
reply time against your standard. The Sunday Telegram review adds the month against target and the strongest findings.

## Currency

INR is the default. Sales settings > Currency has two choices and the rates:

- **Default currency** (INR): what a new deal, quote, offer package and payment starts in. Every one of them has its own
  currency picker, so a USD or AED client is entered in USD or AED. An amount the AI picks out of a conversation without a
  currency named (no $, ₹, Rs) is taken to be in the default currency.
- **Report currency** (INR): what every total is shown in: the revenue target, Insights, Stats, pipeline column totals,
  the Moves tiles, the weekly review and the Telegram summaries. Rupees use Indian grouping (₹12,50,000), and deal size
  bands are in lakhs (under ₹1L, ₹1L to ₹5L, ₹5L to ₹20L, ₹20L and up).
- **Rates**: the value of 1 unit in USD (INR=0.012). Each deal keeps the amount and currency it was agreed in; totals mix
  currencies by converting through these rates, so update them when they drift.

The revenue target is stored in the report currency. Switching the report currency converts the target at the rates
(₹20,00,000 becomes $24,000 at 0.012). Migration 037 moved saved settings to INR and turned an old USD target into rupees.
Deals and payments already recorded keep the currency they were entered in. A company's revenue from research stays in USD.

## Playbook

- **Offers.** Your catalogue: each offer has a one-line description and optional packages (line items, scope, timeline,
  currency). It is the single source of truth for what you sell. A quote on a deal can start from any package, best fit first.
  The first visit copies your old plain list in, once; after that, deleting offers never brings the old list back.
- **Proof.** Every delivered or paid deal gets a draft case study written from its own record; results are only taken
  from what was said or logged, never invented. Nothing is used until you approve it. Approved proof that matches a lead
  (shared service or industry) may be cited, once, in follow-ups, re-engages, revisits, upsells and stuck-deal nudges.
  Never in a first message or a breakup.
- **Objections.** Objections are picked out of every conversation. Once a day they are grouped (the same objection said
  different ways becomes one entry), with how those deals ended. Write your best answer, or ask for one drawn from the
  deals you won. Answers go into the context of every deal that raised it, so drafts and pre-call briefs use them.
- **Do not contact.** Domains, emails, phones, companies or people you never want to pitch. Matching radar leads are
  dropped before they can alert you; deals with them get no outreach moves (their messages to you are still logged).
  Add from the Playbook, from a radar lead (Never contact) or from a deal (Do not contact).

## Known contacts on the radar

A radar lead that matches someone already in Sales (same email, website domain, company name, or full name) is tagged
"You already know them", with the deal and its stage. Making it a lead adds it to that deal when the deal is still running
(open or parked). If they are a client you already won, it starts a new deal marked as repeat business; if the deal was
lost, it starts a fresh attempt with the same company.

## After the sale

Delivered or paid deals get moves for revenue from people who already paid you: check-ins (30 and 90 days after delivery
by default), one suggestion of an offer they have not bought (45 days, skipped if they already have another open deal), and a
monthly retainer offer at delivery. Each happens once, only in a window around its date. Change them in Settings > After the sale.

## Outreach goal

Outreach is a message that opens or pushes a conversation (not your reply to someone who wrote). Today shows outreach sent
against your daily goal, with replies waiting and outreach moves due. Stats has a Sales section with outreach per day
against the goal, replies received and won value.

## Booking link

Add your Calendly or Cal.com link in Settings. Drafts offer it whenever a call is the natural next step, never in a first
message, a breakup, a radar reply or a payment reminder.
