-- Hunts: AI lead-hunting jobs you define and schedule. Each has a plain-language brief (who you want to find), where to
-- look, and its own schedule (every N hours inside a time window, or at a fixed time on chosen days).
-- Touches sales_* tables only.
create table if not exists sales_hunts (
  id serial primary key,
  name text not null,
  enabled boolean not null default true,
  brief text not null default '',
  keywords text[] not null default '{}',
  countries text[] not null default '{}',
  industries text[] not null default '{}',
  signals text[] not null default '{requirement,hiring,funding,review}',
  sweep_sources boolean not null default true,
  queries_per_run int not null default 6 check (queries_per_run between 1 and 20),
  min_score int check (min_score is null or min_score between 0 and 100),
  notify boolean not null default true,
  -- schedule: 'interval' = every N hours between window_from and window_to; 'at' = at at_time on the chosen days
  schedule text not null default 'at' check (schedule in ('interval','at')),
  every_hours int not null default 1 check (every_hours between 1 and 168),
  at_time text not null default '09:00' check (at_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  days int[] not null default '{1,2,3,4,5,6,7}',
  window_from int not null default 0 check (window_from between 0 and 23),
  window_to int not null default 24 check (window_to between 1 and 24),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sales_hunt_runs (
  id serial primary key,
  hunt_id int not null references sales_hunts(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','error')),
  trigger text not null default 'schedule',
  queries text[] not null default '{}',
  searched int not null default 0,
  found int not null default 0,
  error text
);
create index if not exists sales_hunt_runs_idx on sales_hunt_runs (hunt_id, started_at desc);

alter table sales_radar_items add column if not exists hunt_id int references sales_hunts(id) on delete set null;
alter table sales_radar_items add column if not exists hunt_run_id int references sales_hunt_runs(id) on delete set null;
create index if not exists sales_radar_items_hunt_idx on sales_radar_items (hunt_id, found_at desc);
