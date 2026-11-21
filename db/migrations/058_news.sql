-- News: a daily newsletter written for the owner from the news that matters to them (AI tools and models, sales tech,
-- robotics and vision, markets, the Indian and global economy, their clients' industries and countries).
--   news_sources   where news is read from (Google News searches, RSS feeds, Hacker News), with their health
--   news_items     every story read, scored for how much it matters to the owner, with why and what to do
--   news_editions  one newsletter a day (Markdown), kept by date, sent to Telegram with its PDF
--   news_settings  when it is written and sent, and what else to watch
create table if not exists news_sources (
  id serial primary key,
  key text unique not null,
  name text not null,
  kind text not null check (kind in ('gnews','rss','hn')),
  config jsonb not null default '{}'::jsonb,
  topic text,
  enabled boolean not null default true,
  custom boolean not null default false,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  items_found int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists news_items (
  id serial primary key,
  source_id int references news_sources(id) on delete set null,
  url text not null,
  url_hash text unique not null,
  title_key text not null,
  title text not null,
  outlet text,
  summary text,
  published_at timestamptz,
  found_at timestamptz not null default now(),
  score int,
  topic text,
  why text,
  action text,
  scored_at timestamptz,
  starred boolean not null default false
);
create index if not exists news_items_found_idx on news_items (found_at desc);
create index if not exists news_items_title_idx on news_items (title_key);
create index if not exists news_items_unscored_idx on news_items (found_at) where score is null;

create table if not exists news_editions (
  id serial primary key,
  date date unique not null,
  title text not null,
  markdown text not null,
  item_ids int[] not null default '{}',
  stories int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists news_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  send_hour int not null default 8 check (send_hour between 0 and 23),
  telegram boolean not null default true,
  pdf boolean not null default true,
  extra_interests text not null default '',
  updated_at timestamptz not null default now()
);
insert into news_settings (id) values (1) on conflict do nothing;

alter table news_sources enable row level security;
alter table news_items enable row level security;
alter table news_editions enable row level security;
alter table news_settings enable row level security;

select journal_install();
