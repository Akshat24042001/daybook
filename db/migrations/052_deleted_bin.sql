-- Nothing is ever lost. Before any row of a data table is deleted (a button, the chat, Telegram, a job, a cascade from
-- its parent, an undo), a full copy is kept here for good. The Deleted page lists them and puts any of them back.
-- Rows deleted together (one action, or one statement with its cascades) share a group and come back together.
create table if not exists deleted_rows (
  id bigserial primary key,
  grp text not null,
  action_id bigint,
  tbl text not null,
  pk jsonb not null,
  row jsonb not null,
  nm text,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists deleted_rows_grp_idx on deleted_rows (grp, id);
create index if not exists deleted_rows_when_idx on deleted_rows (deleted_at desc);
create index if not exists deleted_rows_row_idx on deleted_rows (tbl, (pk::text)) where restored_at is null;
alter table deleted_rows enable row level security;

-- Tables whose rows are machinery, not your data (queues, caches, logs, the journals themselves).
create table if not exists bin_skip (tbl text primary key);
alter table bin_skip enable row level security;
insert into bin_skip (tbl) values
  ('schema_migrations'),('change_actions'),('change_log'),('deleted_rows'),('bin_skip'),('journal_skip'),
  ('notifications'),('pending_adds'),('tg_updates'),('sales_jobs'),('sales_doc_views'),('sales_seen'),
  ('sales_tg_prompts'),('sales_search_log'),('assistant_actions'),('diary_summaries')
on conflict do nothing;
insert into journal_skip (tbl) values ('deleted_rows'),('bin_skip') on conflict do nothing;
-- the keeper's own tables are never journaled: an undo must not wipe what Deleted holds
drop trigger if exists zz_journal on deleted_rows;
drop trigger if exists zz_journal on bin_skip;

create or replace function bin_keep() returns trigger language plpgsql as $$
declare
  act text := nullif(current_setting('app.action', true), '');
  rec jsonb := to_jsonb(OLD);
  pkv jsonb := '{}'::jsonb;
  col text;
begin
  foreach col in array TG_ARGV loop
    pkv := pkv || jsonb_build_object(col, rec->col);
  end loop;
  insert into deleted_rows (grp, action_id, tbl, pk, row, nm)
  values (coalesce('a' || act, 't' || txid_current()::text), act::bigint, TG_TABLE_NAME, pkv, rec,
          left(coalesce(rec->>'title', rec->>'name', rec->>'full_name', rec->>'label', rec->>'summary', rec->>'body', rec->>'note', rec->>'text'), 160));
  return OLD;
end
$$;

-- Puts the keeper on every data table that does not have it yet.
create or replace function bin_install() returns int language plpgsql as $$
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
     where ns.nspname = 'public' and c.relkind = 'r' and c.relname not in (select tbl from bin_skip)
  loop
    continue when t.pk is null;
    continue when exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'aa_bin');
    execute format('create trigger aa_bin before delete on public.%I for each row execute function bin_keep(%s)', t.relname, t.pk);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Every migration that adds a table already calls journal_install(): from now on that installs the keeper too.
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
  perform bin_install();
  return n;
end
$$;

select journal_install();
