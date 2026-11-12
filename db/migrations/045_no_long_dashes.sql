-- House rule: no em or en dashes anywhere the app writes or sends text (drafts, AI notes, research, documents...).
-- New text is cleaned as it is written (lib/text/no-dashes.ts); this cleans what is already stored, with the same rules:
-- a range becomes a hyphen (10-12), a dash bullet "- ", a trailing dash goes, any other dash becomes a comma.
-- Kept as written: what a lead sent you (inbound messages), raw Telegram updates and the migration log.

create or replace function no_long_dashes(s text, is_json boolean default false) returns text
language plpgsql immutable as $$
declare
  d text := '[' || chr(8210) || '-' || chr(8213) || chr(11834) || chr(11835) || chr(65112) || ']';
begin
  if s is null or s !~ d then return s; end if;
  s := regexp_replace(s, '([[:alnum:]])' || d || '+(?=[[:alnum:]])', '\1-', 'g');
  s := regexp_replace(s, '([0-9])\s+' || d || '+\s+(?=[0-9])', '\1-', 'g');
  if not is_json then
    s := regexp_replace(s, '(^|\n)([ \t]*)' || d || '+[ \t]*', '\1\2- ', 'g');
    s := regexp_replace(s, '[ \t]*' || d || '+[ \t]*(\n|$)', '\1', 'g');
  end if;
  s := regexp_replace(s, '\s*' || d || '+\s*', ', ', 'g');
  if not is_json then
    s := regexp_replace(s, ',\s*([,.;:!?)\]])', '\1', 'g');
  end if;
  return s;
end $$;

do $$
declare
  c record;
  d text := '[' || chr(8210) || '-' || chr(8213) || chr(11834) || chr(11835) || chr(65112) || ']';
  extra text;
begin
  -- no updated_at bumps or journal entries for a punctuation clean-up, where the database allows it
  begin
    perform set_config('session_replication_role', 'replica', true);
  exception when others then null;
  end;
  for c in
    select col.table_name, col.column_name, col.data_type, col.udt_name
    from information_schema.columns col
    join information_schema.tables t on t.table_schema = col.table_schema and t.table_name = col.table_name and t.table_type = 'BASE TABLE'
    where col.table_schema = 'public'
      and (col.data_type in ('text', 'character varying', 'jsonb') or (col.data_type = 'ARRAY' and col.udt_name in ('_text', '_varchar')))
      and col.table_name not in ('schema_migrations', 'tg_updates', 'sales_users')
      and col.is_generated = 'NEVER'
  loop
    extra := case when c.table_name = 'sales_interactions' then ' and direction is distinct from ''in''' else '' end;
    if c.data_type = 'jsonb' then
      execute format('update %I set %I = no_long_dashes(%I::text, true)::jsonb where %I::text ~ %L%s',
        c.table_name, c.column_name, c.column_name, c.column_name, d, extra);
    elsif c.data_type = 'ARRAY' then
      execute format('update %I set %I = (select array_agg(no_long_dashes(x) order by i) from unnest(%I) with ordinality u(x, i)) where array_to_string(%I, chr(1)) ~ %L%s',
        c.table_name, c.column_name, c.column_name, c.column_name, d, extra);
    else
      execute format('update %I set %I = no_long_dashes(%I) where %I ~ %L%s',
        c.table_name, c.column_name, c.column_name, c.column_name, d, extra);
    end if;
  end loop;
end $$;
