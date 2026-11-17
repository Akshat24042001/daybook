-- A task can be with (or for) several people. task_people holds them in order; tasks.person_id stays as the first one
-- so everything that reads a single person keeps working. task_person_names(id) gives "Krina Mehta, Ravi" for display.
create table if not exists task_people (
  task_id int not null references tasks(id) on delete cascade,
  person_id int not null references people(id) on delete cascade,
  sort int not null default 0,
  primary key (task_id, person_id)
);
create index if not exists task_people_person_idx on task_people (person_id);
alter table task_people enable row level security;

insert into task_people (task_id, person_id, sort)
select id, person_id, 0 from tasks where person_id is not null
on conflict do nothing;

create or replace function task_person_names(tid int) returns text language sql stable as $$
  select string_agg(p.name, ', ' order by tp.sort, p.name) from task_people tp join people p on p.id = tp.person_id where tp.task_id = tid
$$;

select journal_install();
