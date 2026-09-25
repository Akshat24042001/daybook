-- Keep in touch: how often you want to hear from someone, when you last did, and a log of touches.
alter table contacts add column if not exists touch_every_days int default 30
  check (touch_every_days is null or (touch_every_days between 1 and 365));
alter table contacts add column if not exists touch_snoozed_until date;

create table if not exists contact_touches (
  id serial primary key,
  contact_id int not null references contacts(id) on delete cascade,
  date date not null,
  kind text not null default 'other' check (kind in ('call','meet','message','other')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists contact_touches_contact_idx on contact_touches (contact_id, date desc);
