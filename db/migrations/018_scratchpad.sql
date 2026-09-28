-- Scratchpad: rough notes, sketches, calculator tapes and graphs, kept per logical day.
create table if not exists scratch_items (
  id serial primary key,
  date date not null,
  kind text not null check (kind in ('note','sketch','calc','graph')),
  title text not null default '' check (length(title) <= 120),
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scratch_items_date_idx on scratch_items (date);
