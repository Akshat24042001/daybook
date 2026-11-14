-- Events around a trip: talks, meetups, conferences and community events (JITO and others you belong to) in the city,
-- the state around it and nearby, from a few days before the trip to a few days after. Each one comes from a page that
-- names it; a date the page does not show is marked unconfirmed. Touches sales_* tables only.
alter table sales_hunts add column if not exists region text;
alter table sales_hunts add column if not exists events boolean not null default true;
alter table sales_hunts add column if not exists events_checked_at timestamptz;

create table if not exists sales_trip_events (
  id serial primary key,
  hunt_id int not null references sales_hunts(id) on delete cascade,
  key text not null,
  title text not null,
  kind text not null default 'business',
  starts_on date,
  ends_on date,
  time_text text,
  venue text,
  city text,
  organizer text,
  url text not null,
  why text,
  community text,
  date_confirmed boolean not null default false,
  status text not null default 'new' check (status in ('new','going','skipped')),
  found_at timestamptz not null default now(),
  unique (hunt_id, key)
);
create index if not exists sales_trip_events_hunt_idx on sales_trip_events (hunt_id, starts_on);

-- like every sales table: locked to the owner (row-level security) and covered by undo
alter table public.sales_trip_events enable row level security;
select journal_install();
