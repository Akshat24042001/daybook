-- Assistant: saved chats, their messages (with the charts/tables and the queries behind each answer),
-- and long-term memory facts the assistant keeps about the owner.
create table if not exists assistant_chats (
  id serial primary key,
  title text not null default 'New chat' check (length(title) <= 120),
  pinned boolean not null default false,
  -- OpenRouter model id chosen for this chat; null = automatic (the free fallback list)
  model text check (model is null or length(model) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_messages (
  id serial primary key,
  chat_id int not null references assistant_chats(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  -- charts, tables and stat tiles, with their rows embedded so history renders without re-querying
  blocks jsonb not null default '[]',
  -- the SQL the assistant ran for this answer: [{ name, sql, rows, ms, error }]
  steps jsonb not null default '[]',
  model text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_chat_idx on assistant_messages (chat_id, id);

create table if not exists assistant_memory (
  id serial primary key,
  fact text not null check (length(fact) between 1 and 500),
  chat_id int references assistant_chats(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- read-only views for the assistant
-- They pre-join the parts that are easy to get wrong (logical dates, work kinds, local time), so the
-- assistant's SQL stays short and correct. All *_local columns are wall-clock time in the owner's timezone.

create or replace view v_segments as
select g.id, g.date, g.kind,
       g.kind in ('office','outside','remote') as is_work,
       (g.start_at at time zone s.timezone) as start_local,
       (g.end_at at time zone s.timezone) as end_local,
       round(extract(epoch from (coalesce(g.end_at, now()) - g.start_at)) / 60)::int as minutes,
       g.end_at is null as running
from work_segments g cross join (select timezone from settings where id = 1) s;

create or replace view v_task_days as
select e.date, e.task_id, t.title, p.name as project, t.type, t.is_personal, e.status, e.must_do,
       e.source, e.carried_from, e.reason, t.carry_count, t.estimate_min, t.state as task_state,
       coalesce((select sum(l.minutes) from time_logs l where l.task_id = e.task_id and l.date = e.date), 0)::int as logged_min,
       (e.updated_at at time zone s.timezone) as status_changed_local
from day_entries e
join tasks t on t.id = e.task_id
left join projects p on p.id = t.project_id
cross join (select timezone from settings where id = 1) s;

create or replace view v_exercise as
select x.date, (x.slot_at at time zone s.timezone) as slot_local, extract(hour from x.slot_at at time zone s.timezone)::int as hour,
       et.name as exercise, et.unit, x.amount, x.status
from exercise_logs x
left join exercise_types et on et.id = x.exercise_type_id
cross join (select timezone from settings where id = 1) s;

create or replace view v_contacts as
select c.id, c.name, c.companies, c.roles, c.cities, c.tags, c.notes, c.touch_every_days, c.touch_snoozed_until,
       lt.last_touch, lt.touches,
       (current_date - lt.last_touch) as days_since_touch,
       case when c.touch_every_days is null then null
            else (current_date - coalesce(lt.last_touch, c.created_at::date)) - c.touch_every_days end as overdue_days
from contacts c
left join (select contact_id, max(date) as last_touch, count(*)::int as touches from contact_touches group by contact_id) lt
  on lt.contact_id = c.id;

create or replace view v_daily as
with d as (
  select date from days union select date from day_entries union select date from time_logs
  union select date from work_segments union select date from exercise_logs union select date from diary_entries
),
seg as (
  select date,
         sum(minutes) filter (where is_work)::int as work_min,
         sum(minutes) filter (where not is_work)::int as nonwork_min,
         min(start_local) filter (where is_work) as first_work_local,
         max(coalesce(end_local, start_local + make_interval(mins => minutes))) filter (where is_work) as last_work_local
  from v_segments group by date
),
tl as (select date, sum(minutes)::int as logged_min from time_logs group by date),
de as (
  select date, count(*)::int as planned,
         count(*) filter (where status = 'done')::int as done,
         count(*) filter (where status = 'progressed')::int as progressed,
         count(*) filter (where status = 'attempted')::int as attempted,
         count(*) filter (where status = 'skipped')::int as not_today,
         count(*) filter (where status = 'dropped')::int as dropped,
         count(*) filter (where status = 'waiting')::int as waiting,
         count(*) filter (where status = 'open')::int as still_open,
         count(*) filter (where must_do)::int as must_do,
         count(*) filter (where must_do and status = 'done')::int as must_do_done
  from day_entries group by date
),
ex as (
  select date, count(*) filter (where status = 'done')::int as ex_done,
         count(*) filter (where status = 'skipped')::int as ex_skipped,
         count(*) filter (where status = 'missed')::int as ex_missed
  from exercise_logs group by date
)
select d.date, to_char(d.date, 'Dy') as weekday, extract(isodow from d.date)::int as isodow,
       dy.score, dy.steps, dy.sleep_minutes, dy.sleep_quality,
       coalesce(dy.worked_minutes_override, seg.work_min, 0) as worked_min,
       dy.worked_minutes_override is not null as worked_is_manual,
       coalesce(tl.logged_min, 0) as logged_min,
       seg.first_work_local, seg.last_work_local, coalesce(seg.nonwork_min, 0) as nonwork_min,
       coalesce(de.planned, 0) as planned, coalesce(de.done, 0) as done, coalesce(de.progressed, 0) as progressed,
       coalesce(de.attempted, 0) as attempted, coalesce(de.not_today, 0) as not_today, coalesce(de.dropped, 0) as dropped,
       coalesce(de.waiting, 0) as waiting, coalesce(de.still_open, 0) as still_open,
       coalesce(de.must_do, 0) as must_do, coalesce(de.must_do_done, 0) as must_do_done,
       coalesce(ex.ex_done, 0) as ex_done, coalesce(ex.ex_skipped, 0) as ex_skipped, coalesce(ex.ex_missed, 0) as ex_missed,
       ds.rating as diary_rating, ds.mood as diary_mood, ds.headline as diary_headline,
       dy.closed_at is not null as day_ended
from d
left join days dy on dy.date = d.date
left join seg on seg.date = d.date
left join tl on tl.date = d.date
left join de on de.date = d.date
left join ex on ex.date = d.date
left join diary_summaries ds on ds.date = d.date;

-- Lock down like the other tables: the server connects as the owner and bypasses RLS; Supabase's public API
-- roles get nothing. Views run with their creator's rights, so they are revoked outright rather than policed.
do $$
declare t text;
begin
  foreach t in array array['assistant_chats','assistant_messages','assistant_memory'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on v_segments, v_task_days, v_exercise, v_contacts, v_daily from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on v_segments, v_task_days, v_exercise, v_contacts, v_daily from authenticated;
  end if;
end
$$;
