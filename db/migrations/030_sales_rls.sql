-- Lock every sales table to the owner. The sales tables (026 onward) were created without row-level security, unlike
-- every other Daybook table, so Supabase's public API (the anon key that ships in the browser bundle) could read and
-- write them: deals, contacts, captured chats, even the capture token and Google secret in sales_settings.
-- The server connects as the database owner and bypasses RLS, so nothing in the app changes.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'sales\_%' loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
end
$$;
