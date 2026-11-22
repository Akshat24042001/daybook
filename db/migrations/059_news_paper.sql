-- News as a personal newspaper: each important story is read in full (the article's text, its picture, the real
-- address), then written up in detail (what happened, who it hits, what it means for the owner). The edition keeps
-- its front page and sector board as a layout next to the Markdown.
alter table news_sources drop constraint if exists news_sources_kind_check;
alter table news_sources add constraint news_sources_kind_check check (kind in ('gnews','rss','hn','tavily'));

alter table news_items add column if not exists author text;
alter table news_items add column if not exists image_url text;
alter table news_items add column if not exists real_url text;
alter table news_items add column if not exists body text;
alter table news_items add column if not exists read_at timestamptz;
alter table news_items add column if not exists read_error text;
alter table news_items add column if not exists detail text;
alter table news_items add column if not exists affects text;
alter table news_items add column if not exists for_you text;
alter table news_items add column if not exists impact text;
alter table news_items add column if not exists detailed_at timestamptz;
create index if not exists news_items_toread_idx on news_items (score desc) where read_at is null and score is not null;

alter table news_editions add column if not exists layout jsonb;
