-- Sales growth: the system learns what works, aims where results come from, and remembers offers, proof and objections.

-- 1. Message learning: every message sent from a move remembers which move wrote it and whether you edited the draft.
alter table sales_interactions add column if not exists move_id int references sales_moves(id) on delete set null;
alter table sales_interactions add column if not exists move_kind text;
alter table sales_interactions add column if not exists drafted boolean;
alter table sales_interactions add column if not exists edited boolean;
create index if not exists sales_interactions_deal_time_idx on sales_interactions (deal_id, occurred_at);

-- 2. Adaptive targeting: the country (weekly) and industry (daily) the radar works on, chosen once per period and kept.
create table if not exists sales_focus (
  period text primary key,
  kind text not null check (kind in ('country','industry')),
  value text not null,
  mode text not null check (mode in ('exploit','explore','fixed')),
  reason text,
  weights jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 7. Do not contact, and radar leads that match someone you already know.
create table if not exists sales_blocklist (
  id serial primary key,
  kind text not null check (kind in ('domain','email','phone','company','person')),
  value text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (kind, value)
);
alter table sales_radar_items add column if not exists known jsonb;
alter table sales_radar_items add column if not exists blocked text;

-- 10. Offer catalogue: what you sell, with ready packages a quote can start from.
create table if not exists sales_offers (
  id serial primary key,
  name text not null,
  summary text,
  keywords text[] not null default '{}',
  packages jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 12. Proof library: case studies from delivered work. Only approved ones are ever used in messages.
create table if not exists sales_proofs (
  id serial primary key,
  deal_id int references sales_deals(id) on delete set null,
  title text not null,
  client text,
  industry text,
  country text,
  services text[] not null default '{}',
  problem text,
  solution text,
  result text,
  link text,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_proofs_deal_idx on sales_proofs (deal_id) where deal_id is not null;

-- 9. Objection library: the same objection said many ways becomes one entry, with your best answer.
create table if not exists sales_objections (
  id serial primary key,
  label text not null unique,
  answer text,
  answer_source text check (answer_source is null or answer_source in ('ai','me')),
  updated_at timestamptz not null default now()
);
create table if not exists sales_deal_objections (
  deal_id int not null references sales_deals(id) on delete cascade,
  objection_id int not null references sales_objections(id) on delete cascade,
  raw text not null,
  primary key (deal_id, raw)
);
create index if not exists sales_deal_objections_obj_idx on sales_deal_objections (objection_id);

do $$
declare t text;
begin
  foreach t in array array['sales_focus','sales_blocklist','sales_offers','sales_proofs','sales_objections','sales_deal_objections'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
end
$$;
-- the radar's own bookkeeping is not something you undo
insert into journal_skip (tbl) values ('sales_focus') on conflict do nothing;
drop trigger if exists zz_journal on sales_focus;
select journal_install();
