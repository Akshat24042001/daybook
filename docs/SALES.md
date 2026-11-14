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

## The deal record

Every field a deal has is defined once in `src/lib/sales/fields.ts`, and the edit form, the details panel, the pipeline
columns, the closing checklists and the history all read that list. Why the qualification fields are the ones they are
(BANT, MEDDPICC, gap selling, Ziglar's five obstacles) is in [SALES_METHODS.md](SALES_METHODS.md).

- **Details** (deal page): grouped as Basics (type, source, value, win chance, expected close, services, industry,
  tags), Location (city, state, country, address), The need (requirement, problem today, what they use now, what they
  want instead, what it is worth to them, why now, budget, timeline), How they decide (who signs, champion, how they
  will choose, steps to a yes, paperwork, competitors, risks), and Notes. A qualification meter counts the 12 answers a
  qualified deal has, and each missing one opens the form at the right tab. **Edit details** has a tab per group; only
  what you change is saved.
- **History**: every change to a field (old value, new value, when, and whether it was you, the AI reading a
  conversation, or Telegram) is a `field` event. The running "where we are" summary is not tracked (it changes on every
  capture).
- **Journey**: every stage move with its date and time, who made it, the reason or note, the time spent in the stage it
  left, and a marker on moves backwards. Totals per stage sit on top (the current one "so far"). Any move can be given a
  reason or note afterwards. Field changes can be shown in the same timeline.
- **Activity log**: log a call, meeting, site visit, WhatsApp, email, LinkedIn, Instagram, SMS or a remark at the date
  and time it happened (back-dating is fine, the future is refused), with who started it, duration, outcome, the person,
  what was discussed (one point per line) and the next step. Remarks are internal and do not count as a touch. Any
  timeline entry can be corrected (date, channel, direction, words, outcome, duration); the deal's last-touch dates are
  recomputed and the entry is marked edited. The "Log something" box is still there for pasting a chat for the AI.
- **Closing checklists** (`src/lib/sales/closing.ts`), on the deal page and when dragging on the board:
  - *Won*: point of contact (someone on the deal or someone new), final amount and currency, start date, delivery date
    or delivery time, exact scope (prefilled from the requirement), payment terms, contract or PO number, why they chose
    you, competitors considered, and your own fields marked "needed to win". An advance % sets up the advance and balance
    payments if none are planned. Required: contact, amount, delivery, scope, reason.
  - *Lost*: why (from your list), lost to, what happened, the lesson, an optional date to try again.
  - *Disqualified*: why it was never a real deal. *Parked*: why, and the date to come back. *Reopened*: why.
  - Nothing is written until every check passes, including the flow's own rules (a move the flow does not allow writes
    nothing). Deals won outside the checklist (Telegram, a client accepting a quote) show what their closing record is
    missing, with a Complete button.
- **Reasons** (Sales settings > Reasons): the lists for won, lost, disqualified, parked and reopened. Insights shows
  "Why you win and lose" from them, and names the biggest loss reason once there are 5 losses.
- **Your fields** (Sales settings > Fields): add any field to deals, companies or people: short or long text, number,
  amount, date, pick one, pick several, yes/no, link, phone, email. Each gets a key that never changes (renaming is safe);
  hiding one keeps its values. Deal fields can be required to close as won, and appear as pipeline columns.
- **Companies and people**: edit from the deal page. Companies have address, PIN code, state, office phone and email,
  and GST / tax ID; people have department, seniority, WhatsApp, best way to reach, language, whether they decide on the
  money, and notes. New emails, phones and LinkedIn become identities, so their messages find them.
- **Documents**: an upload asks what it is (proposal, signed contract, PO, scope of work, NDA, invoice, receipt, brief,
  design, deck, other) and whether it is internal. Internal papers open only for you, are never served as a tracked link,
  and never count as a client view.
- **Pipeline**: the List view has a column chooser (any field above, your own fields, days in stage, qualification) and
  sorts by any column; Filters (source, type, city, country, tag, service, expected close, untouched for N days, low
  qualification) apply to the board and the list. Search also matches city, industry and tags.
- **New lead** asks for city, state, industry, type, services and expected close too.

## Fit, items, recurring revenue, pipelines, playbooks, reports, bulk, team

- **Fit** (`lib/sales/fit-calc.ts`, deal page and pipeline): 0 to 100, graded A (75+), B (55+), C (35+), D. Seven
  parts, each listed with the reason it gave or lost points: industry 25 (one of yours, plus up to 10 for your own
  results there from the radar plan), location 15 (India, your home market from your time zone, or a target country),
  need 20 (what they asked for or what research found matches an offer), size 10 (10 to 1,000 staff is the sweet spot),
  money 10, decision maker 10, source 10 (repeat and referral highest, cold outreach lowest). Grade on every pipeline
  card, a Fit column, and a Fit filter.
- **Service hints**: which of your offers they would likely buy, strongest first, each with why. Only from the record:
  services they asked about, words in what they said or research found ("missed calls", "Excel", "CCTV"), and their
  industry's usual needs (clinics lose bookings on the phone; factories need safety and quality checks...). They point
  at your own catalogue (name first, then keywords, then description), say when the client already bought it, and Add
  puts it on the deal's services.
- **Items** (deal page): name, quantity, price, discount %, GST % (default 18%, Sales settings > Currency), and one-time,
  monthly, quarterly or yearly. Totals split one-time and per month; "Use these totals" sets the deal value and the
  recurring amount (both recorded in the history). A package's lines can be added in one go.
- **Recurring** (Edit details > Recurring): amount, billing, contract start and end, days of notice, renews on its own.
  A Renewal move appears that many days before a won deal's contract ends. Insights > Recurring revenue shows the monthly
  total across currencies and cycles, the yearly figure, and renewals in the next 60 days.
- **Pipelines** (Sales settings > Pipelines): named lanes of deals, each showing the stages you tick (none = all), as
  tabs on the Pipeline page. Stages and automation are shared. A pipeline also shows any stage one of its deals is in,
  so a deal never disappears; turning a pipeline off moves its deals to the first one; one always stays on. New leads
  start in the pipeline you are looking at.
- **Stage playbooks** (deal page, Sales settings > Stage playbooks): questions to ask and a checklist for each stage,
  ticked per deal. Discovery's 12 questions cover the qualification fields. **Call script** puts together an opening
  that agrees the purpose of the call, the stage's questions, your saved objection answers (this deal's first), and a
  close on a next step.
- **Reports** (Insights): Stage by stage (of deals that entered each stage in the period: forward, won, back, lost,
  parked, still there, pass rate, median and average days) and Recurring revenue.
- **Bulk** (Pipeline > List): tick deals, then change pipeline, owner, source, type, city, state, country, industry,
  expected close, add tags, move to an open stage, or delete. Moves that need details (won, lost, parked, reopened)
  are refused in bulk and done on the deal. Failures are listed by deal.
- **CSV**: Export CSV downloads every deal with every field and your own fields (signed in only; cells that would run as
  a spreadsheet formula are kept as text). Import CSV matches your columns to fields automatically (editable), shows the
  first rows, imports into the current pipeline, and lists skipped rows with their row number and reason. Imported
  stages must be open stages: close deals on the deal so the record is captured.
- **Team** (Sales settings > Team): people you work with; a deal can have an owner (recorded in the history), with an
  Owner column and filter. There is still one login: team members do not sign in.

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
yesterday. The chip reads like "Cold 7 ↑": the band, the score, and the arrow when it moved 5 or more points since
yesterday (green up, red down). Bands get greener as priority rises:

| Band | Score | Colour | Meaning |
|---|---|---|---|
| Hot | 70 to 100 | solid green | act today |
| Warm | 45 to 69 | light green | this week |
| Steady | 20 to 44 | yellow | keep warm |
| Cold | 0 to 19 | grey | quiet for now |

**Your own order.** On the Pipeline board (Sort: Priority + your order), drag a card by its handle onto another card in
the same column: dragging up puts it above that card, dragging down puts it below. The cards from the top of the column
down to where you dropped are pinned in that order (a small pin icon); everything below keeps following the automatic
priority. "Reset order" on the column header goes back to automatic. A deal that moves to another stage starts that
column unpinned. Dropping on a card in a different column moves the deal to that stage, as before.

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
- **Send back to Radar** (on the deal page of any deal made from a radar lead) undoes that when it was a mistake: a stray
  tap, a message logged that you never sent. The deal goes, with the messages and moves logged on it; people and
  companies created for it go too unless something else uses them (anything that existed before, such as a researched
  company, is kept). The lead returns to Radar as a fresh qualified lead, with its "answer this" move, and shows for 10
  days from that moment even if it was found earlier. It asks first and says how many logged messages go. It refuses once
  there is a real conversation (anything they sent you, a meeting, a sent quote, a payment): then mark it Lost or Delete it.

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
| `GEMINI_MODELS`, `GEMINI_SEARCH_MODELS`, `AI_VISION_MODELS` | Optional model overrides. Leave unset: Gemini models come from Google's live list for your key (stable Flash, newest first, then Flash-Lite) and image models from OpenRouter's live free list | |

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

## Speed and errors

- Pages load their data in parallel, and the background refreshes (moves, priorities) run on a page load only when
  something changed since the last run or a minute has passed. The 10-minute job and every change you make refresh
  straight away, so nothing goes stale.
- The refreshes write in one statement for all deals and skip rows that did not change.
- If a page fails (usually a slow database moment), it shows "This page hit a snag" with Try again, inside the normal
  app, instead of a blank "Application error". After a deploy, a tab still running the old version reloads itself once.
- `SQL_TRACE=1` logs every query with its time, for finding slow pages locally.

## Screenshots and pasted mail or chats

Drop, paste or pick screenshots (up to 4) or a WhatsApp export into the "Log anything" box on Moves, Pipeline or a deal,
or send them to the Telegram bot. The AI reads them and files everything where it belongs:

- the person and company (found by name, email, phone or handle; created when new), the deal (or a new lead with a
  proper name like "BrightSmile: WhatsApp booking bot")
- each message on the timeline, from them or from you, on the right channel
- promises both ways, a meeting it mentions, the value, the next step, stage moves
- the deal's details: pain, desired outcome, impact, current solution, why now, decision criteria and process,
  competitors, risks, scope, payment terms, expected close, start date, type, industry, city
- the person's title, city, department, seniority, WhatsApp, language, decision maker, preferred channel; the
  company's website, industry, city, phone, email, LinkedIn, address, size (from signatures and profile headers)

It only fills what is empty, so it never overwrites what you wrote. Send the same screenshot twice, or one that overlaps
an earlier one, and the messages already on the deal are skipped. Afterwards the box shows what it filed and where,
with Undo. When it cannot tell who it is about, it asks: pick the person or type a new name.

The screenshots themselves are kept on the deal: a Screenshots section on the deal page (newest first, click to open
full size) and a thumbnail on the timeline entry each one made. They move to your Supabase file storage when
SUPABASE_SERVICE_ROLE_KEY is set (private bucket, opened through short-lived links), otherwise they stay in the
database. Only you can open them. Undo takes them off the deal. Screenshots shared before this change are linked to
their deals too.

## Research without paid keys

Research searches with whatever is set, best first: Tavily, Serper, Brave, Jina (keys), then the keyless engines
Bing (RSS), DuckDuckGo (HTML and lite) and Mojeek, asked all at once with the results merged. Keyless engines often
refuse cloud servers; that shows as an error on Radar > Plan > Searches, never as "no results".

With a free GEMINI_API_KEY, research also searches Google itself through Gemini's grounding (a "Searching Google in
depth" step for companies and people): it runs its own searches and reports facts with their sources. Its write-up
informs the profile, but an email or a LinkedIn link is only saved when it appears in a page or result that was
actually read. The free tier allows a few searches a minute; research waits its turn.

The website is found by search, then by likely domains checked live (the domain must resolve and the page must
carry the company's name), then by asking Google.

## Chat about Sales or one lead (web and Telegram)

**Web.** "Chat" on Moves and Pipeline talks about the whole pipeline; "Chat about this lead" on a deal talks about
that lead (the assistant gets its whole record with every question). Type or tap Speak. Changes come back as buttons:
nothing changes until you tap one, and each can be undone. "Open in Assistant" continues the same chat there.
Edit details on a deal has a mic on every text field: what you say is added to the field.

What the assistant can change: a lead's details (value "2 lakh", next step and date, budget, timeline, pain, why
now, competitors, expected close… anything on Edit details), its stage (with a reason for lost or won), a note on
the timeline, a promise (yours or theirs), the contact (title, email, phone, WhatsApp, LinkedIn, decision maker), and
new leads.

**Telegram.**

| Send | What happens |
|---|---|
| `/leads` | Open leads, most urgent first; tap one for its card |
| `/lead Shah Dental` | The lead's card: stage, priority, value, contact, next step, promises, latest conversation |
| `/lead Shah Dental: what's happening?` | Answer about that lead |
| `/lead Shah Dental: budget 2 lakh, call on Friday` | The changes as buttons: tap to apply, tap again to undo |
| Reply to a lead card (text or voice note) | Same as the line above, for that lead |
| `lead: …` with a chat, email or screenshot | Logs a new conversation (unchanged) |

A lead is found by a few words of the deal name, the contact's name or the company. The chat behind it is shared with
the web, so follow-ups keep the context for 12 hours.

## Sales team logins (/team)

Salespeople get their own login and see only what you give them. They sign in at `/team` on the same site.

**Logins.** Sales settings > Sales team logins. You pick the name, username and password and pass them on yourself. Show login reads them back. They cannot change either; New password and Switch off sign them out at once. Deleting a login keeps their leads with you.

**What they see.**

| Thing | Seen by the salesperson? |
|---|---|
| Leads | Only leads you share (Sales team box on the deal page) and leads they add. Anything else answers "not found". |
| Deal fields | Working fields (next step, dates, needs, budget text, timeline, city...). They can edit these. Not your summary, AI notes, priority, fit or custom fields. |
| Value | Only when you tick "Sees the value" (always on for leads they added). |
| Research | Only when you tick "Sees the research" (always on for leads they added; research runs on its own when they add a company or person). |
| Updates (notes, activities, promises, screenshots, documents) | Their own, plus each one you show them with the eye button ("Only you" / "Visible to ..."). Your past updates stay hidden. You can pass one salesperson's update to another. |
| Stage moves and field changes | Yes, without who made them or why. |
| Other salespeople on the lead | Never. |
| Moves | A to-do list built only from what they can see. |

**Adding a lead.** Five things are required: who (company or person), one valid way to reach them, the source (a referral needs who referred and who they are to us, e.g. a team champion), what they need, and how far it has got. Everything else raises the quality score. A screenshot or pasted chat can fill the form. Up to 30 new leads a day each. Their own duplicates are refused; a likely duplicate of one of yours is flagged on your deal page ("Possible duplicate") without showing them your record.

**No Telegram, no notifications** for salespeople. AI screenshot filing and the mic work in the portal.

**Security.**
- Passwords are hashed with scrypt for sign-in. An AES-256-GCM copy lets you read them back; the key comes from `CREDENTIALS_KEY`, else `AUTH_SECRET`. Set one in Vercel and keep it. Passwords saved before `AUTH_SECRET` was added still open (the old key is still tried for reading); go links and Telegram open links sent before it keep working too.
- The session cookie is AES-256-GCM encrypted, httpOnly, SameSite strict, and lasts 12 hours. It is checked against the database on every request.
- Five wrong passwords lock the login for 15 minutes. Unknown users and wrong passwords get the same answer.
- Everything travels over HTTPS. The portal uses only `/api/team/*`, which needs JSON and a same-origin request. Owner server actions refuse any request without your session.
- Every update records its author in the database (`author_user`), so visibility cannot be faked from the browser.

## No long dashes, anywhere

Em dashes and en dashes read as machine-written, so the app never uses them.

- **Every AI call** carries the rule in its prompt, and every answer is cleaned before the app sees it (`lib/text/no-dashes.ts`). This covers sales AI, the assistant, Telegram, research and voice transcripts.
- **Before anything leaves:** WhatsApp and email links, copied drafts, saved draft edits and the shared quote page are cleaned too, even text you typed yourself.
- **How it cleans:** a range becomes a hyphen (10-12), a dash bullet becomes "- ", and any other dash becomes a comma.
- **Stored text** was cleaned once by migration 045. What leads sent you is kept exactly as they wrote it.
- **The code has none.** `tests/no-dashes.test.ts` fails if a long dash appears in any file in the repo.

## Screenshots: how they are read, and what you get back

**Reading.** A screenshot is read in two steps, because asking a small free image model to do the whole filing from a picture often fails (Mistral especially).
1. An image model only writes out what is on the screen: who said what, when, and every name, number and email. Each screenshot is read separately, two at a time.
2. The text models do the filing from that text.

**Which image model.** Gemini comes first when `GEMINI_API_KEY` is set; it is free and the most reliable. Otherwise the app uses the free OpenRouter models that read images, taken from OpenRouter's live list (or `AI_VISION_MODELS`), with Mistral last. A model that fails is skipped for 10 minutes.

**Long screenshots.** A long scrolling screenshot is cut into up to 4 readable slices in your browser. A HEIC photo that cannot be opened says so.

**When it fails.** The capture is kept with its screenshots, the card says why, and **Try again** files it without asking you to paste it again. Text already read from the screenshots is not read a second time.

**What you get back.** The result card shows:
- the summary
- what was read (each message, yours on the right)
- **Do next**: two to four quick actions
- a reply you could send (Copy, WhatsApp or email)

Telegram shows the same.

**Quick actions.** On the deal page, **Where we are** shows the summary of the whole conversation, the timeline, the quick actions and the reply.
- **Make next step:** sets the deal's next step with its date.
- **Add promise:** puts it on your promise list.
- **Move:** opens the stage move.
- **The cross:** hides the action.
- **Summarize again:** rebuilds the summary and actions from every logged touch.

## Radar: dates, who posted it, and who is behind it

**Dates.** Each lead shows when it was posted, in your time zone ("Posted Today, 11:52 am (1h ago)"), with a **New** badge for the last 24 hours. The list is newest first, grouped under Today, Yesterday and then the date. **Best match** sorts by score instead.

**Filters.**
- **Contact found:** leads where an email, phone or LinkedIn of the business behind it was found.
- **Free to reply:** leaves out sites that charge to reply.
- **Paid sites:** Freelancer.com, Upwork, PeoplePerHour, Guru, Fiverr, Truelancer and Workana.

**Who posted it.** Freelancer.com leads carry the client's public profile: the name Freelancer shows (usually first name and last initial), username, city, country, and projects completed. Other sources show the author where they give one.

**Who is behind it.** On a paid site the card says replying there needs paid bids, and offers **Find them directly** instead of a bid draft. It:
1. reads the post for any website, email or phone it gives away
2. reads that website's home, contact and about pages
3. searches the web for the post's own words (the same need is often posted elsewhere under the business's name), the client's username, the company and the poster's name with their city
4. asks Google through Gemini the same question
5. has the AI name the business, the decision maker and the contacts the business publishes

**What it keeps.**
- Every name and website must appear in what was read.
- Every email and phone number must literally appear there. It never guesses an email pattern.
- Each finding is marked Sure, Likely or A guess, with where it was found.

**Limits.**
- It looks only for businesses. A private person's personal job is marked as such, and it stops.
- Many marketplace posts give nothing away; those come back "could not tie a business to this post".

When it finds the business, the full company research runs on its own (decision makers, every contact). **Draft a direct message** then writes to them directly, and **Make it a lead** carries the person, email and phone into the deal. Strong leads (score 70+) are searched automatically in the background.

## Radar board: what to do first, and what they need

On a computer the radar is two panes: the list on the left, the selected lead on the right. On a phone, tapping a lead opens it in a sheet.

**Do first** (the default order) ranks by:
- how fresh it is (the first replies win most work)
- the fit score
- whether you can reach them directly (a found email, phone or LinkedIn lifts it)
- whether they need it soon

Paid sites with no contact go lower, and leads you have opened drop slightly. The top three carry #1 to #3, and each lead says why it ranks where it does. **Newest** and **Best match** are the other orders.

**Unread.** A blue dot marks leads you have not opened yet; opening one marks it read. **Unread** shows only those.

**Duplicates.** The same requirement found twice (two sources, or posted twice with a different budget) shows once, marked "+1 more source". Skip, Hide and Not relevant apply to every copy.

**The selected lead**, top to bottom:
- **Header:** rank, fit, when it was posted, where and why it ranks there.
- **Reach them:** one click each. **Email** opens your mail with a subject, "Hi <first name>," and an opening line. **Call**, **WhatsApp** (with the opening line), **LinkedIn**, **Open the post** and **Copy opener**. Contacts come from the business found behind the post and from anything written in the post.
- **Work it:** draft a message (a direct one when you can reach them), make it a lead, research, skip, hide, not relevant, never contact.
- **What they need:** their requirement in one or two plain sentences, the deliverables, budget, timing and size.
- **How you can help:** concrete steps tied to your offers, which offers fit, and the line to open with.
- **Ask them:** questions to ask before quoting. **Watch out** shows when something makes it a poor fit.
- **Who posted it:** their public profile and Find them directly.
- **Quick links**, and **their post, word for word**.

The plain-language part is written by the AI the first time you open a lead, then kept. New leads also get a one-line need and how-to-help when they are scored.

**Keys:** j / k (or the arrows) move, o opens the post, d drafts, s skips, h hides.
