-- Sales team logins and what each salesperson may see.
--
-- A salesperson signs in at /team with a username and password you set. They see only the leads you shared with them
-- and the leads they added. On those leads they see the deal's own fields, their own updates, and only the updates
-- you (or another salesperson) chose to share with them. The password is kept twice: a salted scrypt hash to check a
-- sign-in, and an AES-256-GCM encrypted copy so you can read it back in Sales settings. Neither is ever shown to them.

create table if not exists sales_users (
  id serial primary key,
  username text not null,
  display_name text not null,
  member_id int references sales_team(id) on delete set null,
  pass_hash text not null,
  pass_enc text not null,
  active boolean not null default true,
  -- bumped on password change or disable: every open session of theirs ends
  session_version int not null default 1,
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists sales_users_username_uq on sales_users (lower(username));

create table if not exists sales_deal_access (
  deal_id int not null references sales_deals(id) on delete cascade,
  user_id int not null references sales_users(id) on delete cascade,
  show_value boolean not null default false,
  show_research boolean not null default false,
  granted_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);
create index if not exists sales_deal_access_user_idx on sales_deal_access (user_id);

-- who added a lead, and a hint for you when a salesperson's new lead looks like one you already have
alter table sales_deals add column if not exists created_by_user int references sales_users(id) on delete set null;
alter table sales_deals add column if not exists dup_hint text;

-- every kind of update: who made it (null = you or the system) and which salespeople may see it
do $$
declare t text;
begin
  foreach t in array array['sales_interactions','sales_commitments','sales_captures','sales_docs','sales_deal_events'] loop
    execute format('alter table public.%I add column if not exists author_user int references sales_users(id) on delete set null', t);
    execute format('alter table public.%I add column if not exists shared_with int[] not null default ''{}''', t);
  end loop;
  foreach t in array array['sales_users','sales_deal_access'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
end
$$;
select journal_install();

-- authorship fills itself in: while a salesperson's request runs, every write carries app.rep (see lib/db.ts), so
-- whatever their change creates (a note, a promise, a stage move, a field change, a screenshot) is marked as theirs
do $$
declare t text;
begin
  foreach t in array array['sales_interactions','sales_commitments','sales_captures','sales_docs','sales_deal_events'] loop
    execute format('alter table public.%I alter column author_user set default nullif(current_setting(''app.rep'', true), '''')::int', t);
  end loop;
end
$$;
