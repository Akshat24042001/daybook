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
