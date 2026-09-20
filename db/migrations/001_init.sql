-- Daybook schema (PRD section 14). All timestamps are timestamptz (stored in UTC);
-- `date` columns hold the *logical* date (day boundary applied), see src/lib/time.ts.

-- On Supabase the `auth` schema already exists. On plain Postgres (local dev, tests)
-- we create a minimal stand-in so the RLS policies below are valid and testable.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
    create function auth.uid() returns uuid
      language sql stable
      as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  end if;
end
$$;

create table settings (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'Asia/Kolkata',
  day_boundary text not null default '04:00',
  working_days smallint[] not null default '{1,2,3,4,5,6}',
  morning_brief text not null default '08:00',
  exercise_start text not null default '09:30',
  exercise_end text not null default '20:30',
  exercise_interval_min int not null default 30 check (exercise_interval_min between 5 and 240),
  exercise_paused boolean not null default false,
  task_lead_min int not null default 15 check (task_lead_min between 0 and 240),
  cadence_nudge text not null default '11:00',
  evening_fallback text not null default '20:45',
  score_reminder text not null default '21:30',
  open_segment_check text not null default '22:30',
  weekly_review_day smallint not null default 7 check (weekly_review_day between 1 and 7),
  weekly_review_time text not null default '10:00',
  must_do_cap smallint not null default 3 check (must_do_cap between 1 and 5),
  available_hours numeric(4,1) not null default 9 check (available_hours > 0 and available_hours <= 24),
  rot_threshold int not null default 3 check (rot_threshold >= 1),
  step_goal int not null default 8000 check (step_goal >= 0),
  quiet_start text not null default '22:45',
  quiet_end text not null default '07:45',
  telegram_chat_id bigint,
  owner_user_id uuid,
  last_tick_at timestamptz
);
insert into settings (id) values (1);

create table projects (
  id serial primary key,
  name text not null,
  color text not null default '#6366f1',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index projects_name_key on projects (lower(name));

create table people (
  id serial primary key,
  name text not null,
  relation text
);
create unique index people_name_key on people (lower(name));

create table tasks (
  id serial primary key,
  title text not null,
  notes text,
  type text not null default 'one_off'
    check (type in ('one_off','ongoing','follow_up','cadence','recurring','someday','target')),
  project_id int references projects(id) on delete set null,
  person_id int references people(id) on delete set null,
  person_role text check (person_role in ('with','requested_by')),
  via text,
  is_personal boolean not null default false,
  estimate_min int check (estimate_min is null or estimate_min > 0),
  due_date date,
  due_at timestamptz,
  lead_min int check (lead_min is null or lead_min >= 0),
  cadence_days int check (cadence_days is null or cadence_days >= 1),
  rrule text,
  target_period text check (target_period in ('week','month','quarter')),
  period_start date,
  goal_count int check (goal_count is null or goal_count > 0),
  goal_min int check (goal_min is null or goal_min > 0),
  state text not null default 'active' check (state in ('active','done','dropped')),
  carry_count int not null default 0,
  last_done_at timestamptz,
  nudge_snoozed_until date,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index tasks_state_type_idx on tasks (state, type);
create index tasks_project_idx on tasks (project_id);

create table day_entries (
  id serial primary key,
  task_id int not null references tasks(id) on delete cascade,
  date date not null,
  must_do boolean not null default false,
  sort int not null default 0,
  status text not null default 'open'
    check (status in ('open','done','progressed','attempted','skipped','dropped')),
  source text not null default 'planned' check (source in ('planned','auto','carried')),
  note text,
  carried_from date,
  updated_at timestamptz not null default now(),
  unique (task_id, date)
);
create index day_entries_date_idx on day_entries (date);

create table time_logs (
  id serial primary key,
  task_id int not null references tasks(id) on delete cascade,
  date date not null,
  minutes int not null check (minutes > 0),
  source text not null default 'web' check (source in ('web','telegram')),
  created_at timestamptz not null default now()
);
create index time_logs_task_date_idx on time_logs (task_id, date);
create index time_logs_date_idx on time_logs (date);

create table work_segments (
  id serial primary key,
  date date not null,
  kind text not null check (kind in ('office','outside','break')),
  start_at timestamptz not null,
  end_at timestamptz,
  check (end_at is null or end_at > start_at)
);
create index work_segments_date_idx on work_segments (date);
create index work_segments_start_idx on work_segments (start_at);

create table days (
  date date primary key,
  score numeric(3,1) check (score >= 0 and score <= 10),
  steps int check (steps is null or steps >= 0),
  planned_at timestamptz,
  closed_at timestamptz,
  rollover_at timestamptz
);

create table exercise_types (
  id serial primary key,
  name text not null,
  default_amount int not null check (default_amount > 0),
  unit text not null default 'reps' check (unit in ('reps','seconds')),
  active boolean not null default true,
  sort int not null default 0
);

create table exercise_logs (
  id serial primary key,
  date date not null,
  slot_at timestamptz not null,
  exercise_type_id int references exercise_types(id) on delete set null,
  amount int,
  status text not null check (status in ('done','skipped','missed')),
  telegram_message_id bigint,
  unique (slot_at)
);
create index exercise_logs_date_idx on exercise_logs (date);

create table notifications (
  id serial primary key,
  kind text not null,
  ref_id text not null default '',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  telegram_message_id bigint,
  status text not null default 'pending' check (status in ('pending','sent','failed','suppressed')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, ref_id, scheduled_for)
);

-- Free text sent to the bot waits here until one of its inline buttons is pressed
-- (callback_data is limited to 64 bytes, so the text cannot travel inside it).
create table pending_adds (
  id serial primary key,
  text text not null,
  created_at timestamptz not null default now()
);

-- Row-level security: every table is locked to the owner's auth user. Server routes
-- (webhook, tick, pages) connect with the service role / database owner, which bypasses RLS.
create function public.is_owner() returns boolean
  language sql stable security definer set search_path = public
  as $$ select auth.uid() is not null and auth.uid() = (select owner_user_id from public.settings where id = 1) $$;

do $$
declare t text;
begin
  foreach t in array array[
    'settings','projects','people','tasks','day_entries','time_logs','work_segments',
    'days','exercise_types','exercise_logs','notifications','pending_adds'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end
$$;
