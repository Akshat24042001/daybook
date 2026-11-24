-- The free AI allowance, shared by every server slot, so background work (radar, research, news) never uses up what
-- you need to log a conversation yourself.
--   bucket         'openrouter:free' (one daily allowance for every free OpenRouter model) or 'gemini:<model>'
--   blocked_until  the provider said today's allowance is gone: nothing is sent to it until then
--   day, used      requests sent on that quota day (Gemini does not report what is left, so Daybook counts)
--   day_limit      the daily allowance as the provider last reported it
create table if not exists ai_quota (
  bucket text primary key,
  blocked_until timestamptz,
  reason text,
  day text,
  used int not null default 0,
  day_limit int,
  updated_at timestamptz not null default now()
);
alter table ai_quota enable row level security;
-- a counter the app writes on every AI request: nothing to undo, so it stays out of the undo journal and the bin
insert into journal_skip (tbl) values ('ai_quota') on conflict do nothing;
insert into bin_skip (tbl) values ('ai_quota') on conflict do nothing;

-- a capture that could not be filed because the AI allowance was used up: filed by itself once the AI is back
alter table sales_captures add column if not exists wait_ai boolean not null default false;
create index if not exists sales_captures_wait_ai_idx on sales_captures (id) where wait_ai;
