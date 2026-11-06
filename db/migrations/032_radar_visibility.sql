-- Radar transparency: a log of every web search the radar and hunts run (what, where, how many results, who asked),
-- and a "hidden" flag so unwanted leads can be tucked away and brought back.
create table if not exists sales_search_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  provider text not null,
  query text not null,
  hits int not null default 0,
  label text,
  error text
);
create index if not exists sales_search_log_at_idx on sales_search_log (at desc);

alter table sales_radar_items add column if not exists hidden boolean not null default false;
create index if not exists sales_radar_items_hidden_idx on sales_radar_items (hidden, status, found_at desc);

do $$
begin
  alter table public.sales_search_log enable row level security;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_search_log' and policyname = 'owner_only') then
    create policy owner_only on public.sales_search_log for all using (public.is_owner()) with check (public.is_owner());
  end if;
end
$$;

-- the search log is bookkeeping, not something you edit, so it stays out of undo history
create or replace function journal_install() returns int language plpgsql as $$
declare
  t record;
  n int := 0;
  skip text[] := array[
    'schema_migrations','change_actions','change_log','notifications','pending_adds','tg_updates',
    'sales_jobs','sales_doc_views','sales_seen','sales_settings','sales_tg_prompts','sales_calls','sales_captures',
    'assistant_chats','assistant_messages','assistant_memory','assistant_actions','diary_summaries','sales_search_log'
  ];
begin
  for t in
    select c.oid, c.relname,
           (select string_agg(quote_literal(a.attname), ', ' order by a.attnum)
              from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
             where i.indrelid = c.oid and i.indisprimary) as pk
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r' and c.relname <> all(skip)
  loop
    continue when t.pk is null;
    continue when exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_journal');
    execute format('create trigger zz_journal after insert or update or delete on public.%I for each row execute function journal_change(%s)', t.relname, t.pk);
    n := n + 1;
  end loop;
  return n;
end
$$;
