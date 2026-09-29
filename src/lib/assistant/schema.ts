/**
 * What the assistant knows about the Daybook database: every table it may read, what the columns mean, the traps,
 * and worked example queries. This text is the assistant's "training"; keep it in step with db/migrations.
 */

export const SCHEMA_GUIDE = `
DATABASE: PostgreSQL. You may only SELECT. The session timezone is the owner's timezone, so now(), current_date
and ::time casts are already local. "date" columns everywhere are LOGICAL dates: a day runs from the day boundary
(see CONTEXT) to the next, so 01:30 at night still belongs to the previous date. Always filter by these date columns,
never by created_at::date. Weeks start on Monday (date_trunc('week', d)).

=== READY-MADE VIEWS (prefer these; they already join and convert to local time) ===

v_daily — one row per logical date that has any data
  date, weekday ('Mon'), isodow (1=Mon..7=Sun),
  score (0-10, owner's own rating of the day, null if not rated), steps, sleep_minutes, sleep_quality (1-5), instagram_minutes (time on Instagram; daily limit 60),
  worked_min (minutes at work: office/outside/remote segments, or a manual override), worked_is_manual,
  logged_min (minutes logged against tasks), first_work_local, last_work_local (timestamps, local),
  nonwork_min (commute, meals, breaks, exercise, personal),
  planned (task entries that day), done, progressed, attempted, not_today, dropped, waiting, still_open,
  must_do, must_do_done,
  ex_done, ex_skipped, ex_missed (exercise pings answered / skipped / ignored),
  diary_rating (AI's 0-10 read of the diary), diary_mood, diary_headline, day_ended (bool)

v_task_days — one row per task per day it was on the list
  entry_id (the id actions use), date, task_id, title, project (name or null), type, is_personal, status, must_do, source ('planned','auto','carried'),
  carried_from, reason (why "not today": no_time, low_energy, blocked, not_important), carry_count (times the task has
  been carried over so far), estimate_min, task_state ('active','done','dropped'), logged_min (minutes logged that day),
  status_changed_local (local timestamp of the last status change — when a task was marked done, use this for
  time-of-day analysis)

v_segments — the time timeline (state switches)
  id, date, kind, is_work, start_local, end_local (null while running), minutes, running
  kinds: office, outside (out on work), remote — these are WORK; commute, meal, break, exercise, personal are not.

v_exercise — exercise pings
  date, slot_local, hour (0-23 local), exercise (name), unit ('reps' or 'seconds'), amount, status ('done','skipped','missed')

v_contacts — people and keep-in-touch
  id, name, companies[], roles[], cities[], tags[], notes, touch_every_days, touch_snoozed_until,
  last_touch (date), touches (count), days_since_touch, overdue_days (>0 means overdue by that many days)

=== TABLES ===

tasks: id, title, notes, type, project_id→projects, person_id→people, person_role ('with','requested_by'), via,
  is_personal, estimate_min, due_date, due_at (timestamptz), cadence_days, rrule, target_period, goal_count, goal_min,
  state ('active','done','dropped'), carry_count, last_done_at, created_at, closed_at,
  waiting_on (person/thing), waiting_since, waiting_until (check-back date)
  type: one_off, ongoing (open-ended, stays on the list), follow_up, cadence (every N days), recurring (rrule),
  someday (parked pool, not scheduled), target (a count/minutes goal over a week/month/quarter)
day_entries: task_id, date, must_do, status, source, note, carried_from, reason, updated_at
  status: open (not handled), done, progressed (moved forward, still open), attempted (tried, blocked), skipped (shown to
  the owner as "Not today"), dropped (abandoned), waiting (ball in someone else's court)
time_logs: task_id, date, minutes, source ('web','telegram'), created_at
task_remarks: task_id, body, created_at — running notes on a task
projects: id, name, color, archived, weekly_target_min (weekly time goal in minutes), created_at
people: id, name, relation — people named on tasks (+Name)
work_segments: id, date, kind, start_at, end_at — raw form of v_segments
days: date, score, steps, sleep_minutes, sleep_quality, instagram_minutes, worked_minutes_override, planned_at, closed_at (Day end tapped)
exercise_types: id, name, default_amount, unit, active
exercise_logs: date, slot_at, exercise_type_id, amount, status
diary_entries: id, date, body (the owner's own words, voice or typed), source, created_at
diary_summaries: date, headline, summary, rating, mood, wins[], struggles[], highlights[], tomorrow[], tags[] (jsonb arrays)
reviews: period ('week','month'), start_date, end_date, headline, narrative, grade (0-10), wins, patterns, drivers,
  decisions, intentions (jsonb [{text, done}])
contacts: id, name, companies[], roles[], cities[], phones[], emails[], linkedin, notes, tags[], touch_every_days,
  touch_snoozed_until, created_at
contact_touches: contact_id, date, kind ('call','meet','message','other'), note
refs: id, kind ('link','note','quote'), title, url, body, source, tags[], pinned, created_at — saved references
scratch_items: id, date, kind ('note','checklist','sketch','calc','table','graph','link','code','voice','file'), title,
  data (jsonb: note {text}, checklist {items[{text,done}]}, calc {lines[]}, table {rows[][]}, graph {fns[]},
  link {url,note}, code {lang,code}, voice {name,duration,transcript}, file {name,mime,size}), created_at
tasks.rrule: repeat rule, e.g. FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA (every day except Sunday), FREQ=MONTHLY;BYDAY=-1FR
  (last Friday), X-MISSED=CARRY (a missed day stays until done). Repeating tasks do not count carries unless X-MISSED=CARRY.
settings (one row): timezone, day_boundary, working_days (isodow array), step_goal, available_hours, rot_threshold
assistant_memory: id, fact — what you have been asked to remember (already given to you below)

=== DEFINITIONS THE OWNER USES ===
- "Pending" / "open tasks": tasks with state='active' and type <> 'someday'. Today's pending list: v_task_days where
  date = today and status in ('open','progressed','attempted'). Overdue: active tasks with due_date < today.
- "Rotting": active tasks with carry_count >= settings.rot_threshold (default 3).
- Completion rate for a period: sum(done) / nullif(sum(planned) - sum(waiting), 0) from v_daily.
- Must-do hit rate: sum(must_do_done) / nullif(sum(must_do), 0).
- Worked hours: v_daily.worked_min / 60.0. Focus ratio: logged_min / nullif(worked_min, 0).
- Exercise compliance: ex_done / nullif(ex_done + ex_skipped + ex_missed, 0).
- Most productive / active hours: count done tasks by extract(hour from status_changed_local) in v_task_days where
  status = 'done'; exercise by v_exercise.hour; work presence by hour from v_segments. Say which signal you used.
- Keep in touch: v_contacts where overdue_days > 0 and (touch_snoozed_until is null or touch_snoozed_until < current_date).
- Project time: sum(time_logs.minutes) joined through tasks.project_id; compare with projects.weekly_target_min.

=== EXAMPLES ===
-- last 14 days at a glance
select date, weekday, score, round(worked_min/60.0,1) as worked_h, done, planned, ex_done, steps
from v_daily where date > current_date - 14 order by date;

-- what is pending today (entry_id is what task_status / move_task / waiting actions need)
select entry_id, task_id, title, project, status, must_do, carry_count from v_task_days
where date = '2026-01-15' and status in ('open','progressed','attempted') order by must_do desc, carry_count desc;

-- hour of day when tasks get finished (last 60 days)
select extract(hour from status_changed_local)::int as hour, count(*) as done
from v_task_days where status = 'done' and date > current_date - 60 group by 1 order by 1;

-- hours per project this week vs goal
select p.name as project, round(sum(l.minutes)/60.0,1) as hours, round(p.weekly_target_min/60.0,1) as goal_h
from time_logs l join tasks t on t.id = l.task_id join projects p on p.id = t.project_id
where l.date >= date_trunc('week', current_date)::date group by p.name, p.weekly_target_min order by hours desc;

-- does sleep predict the day score?
select case when sleep_minutes < 360 then '<6h' when sleep_minutes < 420 then '6-7h' else '7h+' end as sleep,
       round(avg(score),1) as avg_score, count(*) as days
from v_daily where sleep_minutes is not null and score is not null group by 1 order by 1;

-- the owner's own words about a topic
select date, body from diary_entries where body ilike '%investor%' order by date desc limit 20;
`;

/** Tables and views the assistant may read. Anything else (sessions, bot plumbing, notifications) is off limits. */
export const ALLOWED_RELATIONS = new Set([
  "v_daily", "v_task_days", "v_segments", "v_exercise", "v_contacts",
  "tasks", "day_entries", "time_logs", "task_remarks", "projects", "people", "work_segments", "days",
  "exercise_types", "exercise_logs", "diary_entries", "diary_summaries", "reviews", "contacts", "contact_touches",
  "refs", "scratch_items", "settings", "assistant_memory",
]);
