create table refs (
  id serial primary key,
  kind text not null default 'link' check (kind in ('link', 'note', 'quote')),
  title text not null,
  url text,
  body text,
  source text,          -- for quotes: who said it / where it's from
  tags text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index refs_tags_gin on refs using gin (tags);
