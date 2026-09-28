-- Changes the assistant proposes. Nothing is applied until the owner taps it; each applied action keeps a snapshot of
-- the rows it could touch, so Undo puts them back exactly.
create table if not exists assistant_actions (
  id serial primary key,
  chat_id int references assistant_chats(id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}',
  label text not null,
  detail text,
  status text not null default 'proposed' check (status in ('proposed','applied','undone','failed')),
  error text,
  undo jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  undone_at timestamptz
);
create index if not exists assistant_actions_chat_idx on assistant_actions (chat_id);

-- the assistant needs the entry id to act on a task's day entry; new columns go last in a view
create or replace view v_task_days as
select e.date, e.task_id, t.title, p.name as project, t.type, t.is_personal, e.status, e.must_do,
       e.source, e.carried_from, e.reason, t.carry_count, t.estimate_min, t.state as task_state,
       coalesce((select sum(l.minutes) from time_logs l where l.task_id = e.task_id and l.date = e.date), 0)::int as logged_min,
       (e.updated_at at time zone s.timezone) as status_changed_local,
       e.id as entry_id
from day_entries e
join tasks t on t.id = e.task_id
left join projects p on p.id = t.project_id
cross join (select timezone from settings where id = 1) s;

do $$
begin
  alter table public.assistant_actions enable row level security;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_actions' and policyname = 'owner_only') then
    create policy owner_only on public.assistant_actions for all using (public.is_owner()) with check (public.is_owner());
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on v_task_days from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on v_task_days from authenticated;
  end if;
end
$$;
