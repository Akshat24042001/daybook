-- Deep research: every lead, company and person can be researched in stages (their website, the web, the people behind
-- the company), with a live log and the list of sources used, viewable at any time.
-- Also: the journal's skip list becomes data, so a migration can exclude a bookkeeping table in one line.
create table if not exists journal_skip (tbl text primary key);
insert into journal_skip (tbl) values
  ('schema_migrations'),('change_actions'),('change_log'),('notifications'),('pending_adds'),('tg_updates'),
  ('sales_jobs'),('sales_doc_views'),('sales_seen'),('sales_settings'),('sales_tg_prompts'),('sales_calls'),('sales_captures'),
  ('assistant_chats'),('assistant_messages'),('assistant_memory'),('assistant_actions'),('diary_summaries'),('sales_search_log'),
  ('sales_research_runs'),('journal_skip')
on conflict do nothing;

create or replace function journal_install() returns int language plpgsql as $$
declare
  t record;
  n int := 0;
begin
  for t in
    select c.oid, c.relname,
           (select string_agg(quote_literal(a.attname), ', ' order by a.attnum)
              from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
             where i.indrelid = c.oid and i.indisprimary) as pk
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r' and c.relname not in (select tbl from journal_skip)
  loop
    continue when t.pk is null;
    continue when exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_journal');
    execute format('create trigger zz_journal after insert or update or delete on public.%I for each row execute function journal_change(%s)', t.relname, t.pk);
    n := n + 1;
  end loop;
  return n;
end
$$;

create table if not exists sales_research_runs (
  id serial primary key,
  subject text not null check (subject in ('company','person')),
  subject_id int,
  radar_item_id int references sales_radar_items(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','done','error')),
  stage text not null default 'queued',
  trigger text not null default 'auto',
  log text[] not null default '{}',
  sources jsonb not null default '[]'::jsonb,
  evidence jsonb,
  error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists sales_research_runs_subject_idx on sales_research_runs (subject, subject_id, started_at desc);
create index if not exists sales_research_runs_radar_idx on sales_research_runs (radar_item_id, started_at desc);

alter table sales_radar_items add column if not exists company_id int references sales_companies(id) on delete set null;
alter table sales_radar_items add column if not exists person_id int references sales_people(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['sales_research_runs','journal_skip'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
end
$$;
select journal_install();
