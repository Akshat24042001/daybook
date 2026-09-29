-- Repairs after two bugs:
--  1. Planning tomorrow carried today's still-open tasks (and counted a carry) before the day was over, and repeating
--     tasks were carried and counted at all. A daily task done every day showed "carried 3×".
--  2. Marking one day's session Done on a target (e.g. "50 hours this month") closed the whole target.

-- Repeating tasks do not carry: their count starts from zero.
update tasks set carry_count = 0
where type in ('ongoing', 'cadence', 'recurring') and carry_count <> 0;

-- Everything else: recount honestly. A carry is a day it was put off ("Not today"), or a day it was left untouched and
-- moved on to a later day. Carries off a day that was later finished (the early carry) no longer count.
update tasks t set carry_count = x.n
from (
  select t2.id,
         (select count(*) from day_entries e where e.task_id = t2.id and e.status = 'skipped')
       + (select count(*) from day_entries c
            join day_entries o on o.task_id = c.task_id and o.date = c.carried_from
           where c.task_id = t2.id and c.source in ('auto', 'carried') and o.status = 'open') as n
  from tasks t2
  where t2.type not in ('ongoing', 'cadence', 'recurring')
) x
where x.id = t.id and t.carry_count <> x.n;

-- Targets closed by a single day's Done (the day entry and the task closed in the same moment) while their period is
-- still running: open them again. A target closed from its own Done button on Goals has no such entry and stays closed.
update tasks t set state = 'active', closed_at = null
where t.type = 'target' and t.state = 'done' and t.period_start is not null
  and (t.period_start + case coalesce(t.target_period, 'week')
         when 'week' then interval '7 days' when 'month' then interval '1 month'
         when 'quarter' then interval '3 months' else interval '1 year' end)::date > current_date
  and exists (
    select 1 from day_entries e
    where e.task_id = t.id and e.status = 'done'
      and abs(extract(epoch from (e.updated_at - t.closed_at))) < 120
  );
