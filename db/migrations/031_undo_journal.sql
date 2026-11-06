-- Universal undo. Every change made through the app (a tap, a form, a Telegram button, Claude over MCP) is one "action".
-- A trigger on each data table writes what each row looked like before and what changed into change_log, grouped by
-- action. Undo replays an action backwards; Redo is just an undo of the undo. Writes made outside an action (the
-- minute tick, crawlers) are not recorded.
create table if not exists change_actions (
  id bigserial primary key,
  label text,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by bigint,
  undo_of bigint
);
create index if not exists change_actions_created_idx on change_actions (created_at desc);

create table if not exists change_log (
  id bigserial primary key,
  action_id bigint not null references change_actions(id) on delete cascade,
  tbl text not null,
  op char(1) not null check (op in ('I','U','D')),
  pk jsonb not null,
  old jsonb,
  -- { column: [before, after] } for the columns that changed (all set columns, for an insert); long text shortened
  chg jsonb,
  -- a short name of the row for the history list (its title, name, ...)
  nm text
);
create index if not exists change_log_action_idx on change_log (action_id, id);
create index if not exists change_log_row_idx on change_log (tbl, id);

-- long values are shortened so the journal stays small; the full "before" row is kept in `old` for restoring
create or replace function journal_trunc(v jsonb) returns jsonb language sql immutable as $$
  select case when v is null then null when length(v::text) > 200 then to_jsonb(left(v #>> '{}', 200)) else v end
$$;

create or replace function journal_change() returns trigger language plpgsql as $$
declare
  act text := nullif(current_setting('app.action', true), '');
  rec jsonb;
  prev jsonb;
  pkv jsonb := '{}'::jsonb;
  col text;
  changes jsonb;
begin
  if act is null then return null; end if;
  rec := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  prev := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  if TG_OP = 'UPDATE' then
    if prev = rec then return null; end if;
    select jsonb_object_agg(k, jsonb_build_array(journal_trunc(prev->k), journal_trunc(rec->k)))
      into changes
      from jsonb_object_keys(rec) k
     where (prev->k) is distinct from (rec->k) and k <> 'updated_at';
    if changes is null then return null; end if; -- only updated_at moved
  elsif TG_OP = 'INSERT' then
    select jsonb_object_agg(k, jsonb_build_array(null, journal_trunc(rec->k)))
      into changes
      from jsonb_object_keys(rec) k
     where jsonb_typeof(rec->k) <> 'null' and k not in ('id', 'created_at', 'updated_at');
  end if;
  foreach col in array TG_ARGV loop
    pkv := pkv || jsonb_build_object(col, rec->col);
  end loop;
  insert into change_log (action_id, tbl, op, pk, old, chg, nm)
  values (act::bigint, TG_TABLE_NAME, left(TG_OP, 1), pkv, prev, changes,
          left(coalesce(rec->>'title', rec->>'name', rec->>'full_name', rec->>'label', rec->>'summary', rec->>'body', rec->>'note'), 120));
  return null;
end
$$;

-- Puts the journal on every data table that does not have it yet. Future migrations that add a table call this again.
create or replace function journal_install() returns int language plpgsql as $$
declare
  t record;
  n int := 0;
  skip text[] := array[
    'schema_migrations','change_actions','change_log','notifications','pending_adds','tg_updates',
    'sales_jobs','sales_doc_views','sales_seen','sales_settings','sales_tg_prompts','sales_calls','sales_captures',
    'assistant_chats','assistant_messages','assistant_memory','assistant_actions','diary_summaries'
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

select journal_install();

do $$
declare t text;
begin
  foreach t in array array['change_actions','change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
end
$$;
