-- End-of-day diary: free-form voice or typed notes, plus one AI summary per day.
create table if not exists diary_entries (
  id serial primary key,
  date date not null,
  body text not null check (length(body) between 1 and 20000),
  source text not null default 'voice' check (source in ('voice','text','telegram')),
  created_at timestamptz not null default now()
);
create index if not exists diary_entries_date_idx on diary_entries (date);

create table if not exists diary_summaries (
  date date primary key,
  headline text not null,
  summary text not null,
  rating numeric(3,1) check (rating is null or (rating >= 0 and rating <= 10)),
  mood text,
  wins jsonb not null default '[]',
  struggles jsonb not null default '[]',
  highlights jsonb not null default '[]',
  tomorrow jsonb not null default '[]',
  tags jsonb not null default '[]',
  model text,
  entry_count int not null default 0,
  updated_at timestamptz not null default now()
);
