-- Targets and trips: a hunt can aim at cities, skip words, run only between two dates, and be a trip (you visit a place
-- on set days: leads there get a message that asks to meet while you are in town). A trip can also look for local
-- businesses that fit your offers, not only posts. Touches sales_* tables only.
alter table sales_hunts add column if not exists kind text not null default 'standing';
alter table sales_hunts add column if not exists cities text[] not null default '{}';
alter table sales_hunts add column if not exists exclude text[] not null default '{}';
alter table sales_hunts add column if not exists starts_on date;
alter table sales_hunts add column if not exists ends_on date;
alter table sales_hunts add column if not exists trip_from date;
alter table sales_hunts add column if not exists trip_to date;
alter table sales_hunts add column if not exists meet boolean not null default false;
alter table sales_hunts add column if not exists prospects boolean not null default false;
alter table sales_hunts add column if not exists ended_at timestamptz;
do $$ begin
  alter table sales_hunts add constraint sales_hunts_kind_chk check (kind in ('standing','trip'));
exception when duplicate_object then null; end $$;

-- what a radar item is: a post someone wrote, a local business found for a target, or a news item about one
alter table sales_radar_items add column if not exists lead_kind text not null default 'post';
-- meetings booked from a radar lead remember it (and so the trip they belong to)
alter table sales_meetings add column if not exists radar_item_id int references sales_radar_items(id) on delete set null;
alter table sales_meetings add column if not exists place text;
