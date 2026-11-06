# Sales

The Sales section of Daybook: capture every conversation with as little typing as possible, always know the next move,
find at least one qualified opportunity a day, and track every quote until the money is in.

## Screens

| Screen | What it is for |
|---|---|
| **Moves** (`/sales`) | Everything that needs you, ranked: replies waiting, promises, follow-ups, hot quotes, money, new radar leads. Draft in your voice, send in one tap, it logs itself. |
| **Pipeline** | Board by stage. Stages move by themselves as conversations happen. Heat (0 to 100) shows how alive each deal is. |
| **Deal** | Where we are (auto-written), timeline across every channel, last touch per channel, promises both ways, documents and their opens, money, people (decision makers, referrer, intermediary), research, stage history. |
| **Radar** | Leads found on the internet, scored against your offers, with the angle to open with. Sources on/off and their hit rates. |
| **Accounts** | Companies and people, with 50+ researched fields each. Merge duplicates, import from Contacts. |
| **Documents** | Tracked quotes (with revisions), opportunity briefs, files and links. |
| **Review** | The honest numbers: conversations started, reply rate by channel, where deals die, cash, promises broken. |
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
- Countries rotate weekly, industries daily (both lists are editable).
- Replying to a radar lead from Daybook turns it into a tracked deal automatically.

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
