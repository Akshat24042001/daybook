# Decisions

Ambiguities in the PRD, resolved with the simplest option that meets the acceptance criteria.

**Data access.** The app talks to Postgres directly from the server (`pg`) using `DATABASE_URL`, instead of the Supabase REST client. Supabase Auth still handles sign-in. RLS is enabled on every table (owner-only policies), and the server connection bypasses it as the PRD describes. This is why `SUPABASE_SERVICE_ROLE_KEY` is not needed.

**Carry counting.** Skipped adds 1 when tapped. An untouched (open) entry adds 1 when carried (triage or rollover). Attempted never adds. A skipped entry that is later carried does not add a second time.

**Triage.** An entry is "unresolved" when it is open, skipped or attempted, its task is active, and the task has no entry on a later date. Carrying, dating, converting to Someday or dropping all resolve it.

**Rollover.** Runs once per logical day from the tick (`days.rollover_at`). Untriaged entries get a new entry with source `auto` and `carried_from` set. Ongoing tasks are added on working days, recurring tasks from their rule. Cadence items are added only when planning.

**Planning streak.** A day counts when its plan was finished before that day's boundary. Planning tomorrow counts immediately. A day planned late or not at all breaks it.

**Target pace.** Progress is logged minutes (hours goal) and days marked Done/Progressed (sessions goal). Elapsed time is completed working days divided by working days in the period. A target is behind when progress plus 10 points is below elapsed. A goal-less target is behind once half the period has passed. Expired targets close as done (met) or dropped (missed).

**Cadence snooze.** "Snooze 1 day" skips tomorrow's nudge, so the next nudge comes the day after.

**Retry timing.** Tomorrow AM is 10:00 and Tomorrow PM is 16:00. Retries and +30m snoozes are stored as scheduled notifications and sent by the tick.

**Reminders.** Sent only while the entry is Open. The first fires `lead` minutes before, the second at the task time.

**Idempotency.** A notification row is claimed before sending (unique on kind, ref, scheduled time). A failed send can be retried up to 3 times. Telegram update ids are recorded so a re-delivered update is skipped.

**Free text in the bot.** The text waits in `pending_adds` because `callback_data` is limited to 64 bytes.

**URL buttons.** Telegram only accepts https links, so buttons that open the app appear once `APP_BASE_URL` is https.

**Unaccounted time.** Worked time minus minutes logged to non-personal tasks, never below zero.

**Additions requested by the owner after the PRD:** Deepgram voice input (web mic and Telegram voice notes), manual time entry from text or voice ("office 10:45 to 1:30"), a task-note flow, and the analytics dashboard (trends, period comparison, needs-attention list). Voice is rule-based, no AI: spoken phrases like "must do" and "tomorrow at 5 pm" become quick-add syntax.

**Sales (added after the PRD).** Lives inside Daybook (same database, bot, assistant, cron) as its own section with
`sales_*` tables, so it can be split out later. The deal state machine is data, not code: automation targets stage roles,
the AI may move deals forward but never closes them, and client actions and payments are ground truth. Only free services
are used. Personal WhatsApp and LinkedIn are captured by forwarding, exports, screenshots or the bookmarklet, never by
unofficial automation (account ban risk). Client messages are never auto-sent: Daybook drafts, you tap. Telegram callbacks
use the `zs:` prefix because `sl:` is sleep. Full design: docs/SALES.md.

**Colour.** Every colour answers a question, so a hue tells you what kind of thing you are looking at before you read it.
Eight hues, defined once in `src/lib/hue.ts` and in the tokens of `globals.css` (light and dark):
sky = action (Today, tasks, projects) · mint = success and money (pipeline, health, done) · butter = attention (must-dos,
Unfinished, carried) · rose = urgent or negative (overdue, over a limit, lost) · lilac = thinking and rest (Plan, Review,
Diary, sleep) · peach = people (Contacts, Accounts, follow-ups) · teal = measuring (Stats, Goals, Radar, timed tasks) ·
pink = leisure and social (Instagram, personal time). Where it shows: the sidebar icon of each page and a soft wash behind
that page's header; the dot and count of each section on Today; the left edge of every task, in its project's own colour;
the label chips on Plan; the bar and title of every Stats tile. Text always uses the deep shade of a hue and fills the
pastel one, so contrast stays readable in both themes. A new colour needs a new meaning first.

**Reordering.** Drag the grip at the left of a task on Today or Plan; the new order is saved to `day_entries.sort`
(`reorderEntries`). Timed tasks sort by their time and finished ones stay put, so they have no grip. On Plan, must-dos
and the rest are two lists because must-dos always sit on top. Keyboard works too (focus the grip, Space, arrows).

**Claude connector (MCP).** `/api/mcp`, off until `MCP_TOKEN` is set. Reads the day and the pipeline; writes only add a
task, tick a task off and log the day's numbers. Nothing can message a client, move a deal or delete. See docs/MCP.md.

**Hunts.** Scheduled AI lead hunting lives in Sales > Radar > Hunts (`sales_hunts`, `sales_hunt_runs`, `src/lib/sales/hunts.ts`).
Results go into the same radar items table, tagged with the hunt, so scoring, alerts, drafting and "Make it a lead" are
shared. The schedule is data: the existing every-minute tick queues a due hunt as a job, so nothing new has to be
deployed or cron-configured. A run never repeats recent queries, learns from leads you kept or skipped, and is honest
when there is no search key (it says so instead of reporting zero as success). Search cost is shown before saving.
**Row-level security** now covers every `sales_*` table (migration 030), and a test fails if a future sales table lacks it.

**Universal undo.** Every change made through the app, Telegram or Claude (MCP) is one *action*. A trigger on each data
table records the row's "before" state and what changed (`change_log`, grouped by `change_actions`), so Undo works on
everything, including features added later (a test fails if a table lacks the trigger; a migration that adds a table
must call `journal_install()`). Undo replays an action backwards; Redo is an undo of the undo. Newer changes to the same
row block an undo until they are undone first, so nothing is silently overwritten. Rows go back by retrying around
foreign keys, so cascades (deleting a task and its entries) restore completely. Writes made outside an action (the
minute tick, crawlers) are not recorded. 30 days of history. Not covered: sales settings (they hold secrets), AI chats,
and message captures, which keep their own undo. The newest action arrives with every page render, so any screen gets an
Undo toast with no wiring; Ctrl/Cmd+Z undoes the last one; History lists all of it.

**Hiding leads.** A hidden lead is only tucked away (`hidden` flag): it leaves the lists, the digest and Moves, stays in
the database, and comes back with "Show hidden leads".

**All tasks.** `/tasks` lists every task whatever its state (active, completed, dropped, waiting) with search and a
project filter, a "Day by day" log of everything done, skipped or dropped, and Reopen for closed tasks.

**Look.** The whole app is pastel (`globals.css`, `lib/theme.ts`). Eight hues, one per kind of thing, and each page lives in
one hue: `[data-hue]` on the shell re-tints the canvas gradient, cards, chips and borders, so no component needs to know
which page it is on. Nine palettes (Candy gives every page its own; the others paint every page one pastel), light or
"Dusk" dark, chosen in Settings or from the sidebar, saved per device. Rounded type (Nunito, Fredoka), pill buttons, icon
bubbles on every tile and section. Task rows take a wash of their project's colour.

**Research.** Deep lead research runs as a chain of jobs (site, search, synth, person) with a log and a source list per run, so
each step fits a serverless time slot and progress is visible. Anything verifiable (emails, phones, socials, domain age,
email provider) is extracted by code and overrides the AI's version. The old `enrich_company` and `enrich_person` jobs now start this pipeline.

**Professional look (Nov 2026).** The pastel "candy" system read as a toy, so the look moved to a calm product style and
replaces the colour notes above: Inter for all type (headings semibold, tightly tracked), neutral off-white canvas and
white cards with hairline borders and soft shadows, one blue for actions, and green / amber / red only where they carry
meaning. Pages are no longer tinted by hue and the palette picker is gone; the eight hues in `lib/hue.ts` remain as quiet
status tints for badges, bars and dots. Corners are tighter (6 to 14px), buttons and tags are rectangular, the sidebar is
a fixed flat column and the phone nav a standard bottom bar. Task rows are neutral (the project shows as a dot in its
chip). Dark mode is a neutral graphite.
