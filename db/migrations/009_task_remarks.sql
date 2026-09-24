create table task_remarks (
  id serial primary key,
  task_id int not null references tasks(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index task_remarks_task_id on task_remarks (task_id);

-- migrate existing notes: each [YYYY-MM-DD] line becomes a row
-- lines without a date prefix are bundled under the task's created_at
insert into task_remarks (task_id, body, created_at)
select
  t.id,
  trim(regexp_replace(line, '^\[\d{4}-\d{2}-\d{2}\]\s*', '')) as body,
  case
    when line ~ '^\[\d{4}-\d{2}-\d{2}\]'
    then (regexp_match(line, '^\[(\d{4}-\d{2}-\d{2})\]'))[1]::date + time '00:00'
    else t.created_at
  end as created_at
from tasks t,
     lateral unnest(string_to_array(t.notes, E'\n')) as line
where t.notes is not null and t.notes <> '' and trim(line) <> '';
