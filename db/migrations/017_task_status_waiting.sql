-- "Waiting on someone": the ball is in another court. The task leaves the daily lists and comes back on a check-back date.
alter table day_entries drop constraint if exists day_entries_status_check;
alter table day_entries add constraint day_entries_status_check
  check (status in ('open','done','progressed','attempted','skipped','dropped','waiting'));
-- why a task was skipped ("Not today"), optional
alter table day_entries add column if not exists reason text
  check (reason is null or reason in ('no_time','low_energy','blocked','not_important'));
alter table tasks add column if not exists waiting_on text;
alter table tasks add column if not exists waiting_since date;
alter table tasks add column if not exists waiting_until date;
