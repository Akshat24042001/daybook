-- Notifications can now be created ahead of time (snooze / retry pings) and claimed by the tick later.
alter table notifications drop constraint notifications_status_check;
alter table notifications
  add constraint notifications_status_check
  check (status in ('scheduled','pending','sent','failed','suppressed'));

create index notifications_scheduled_idx on notifications (status, scheduled_for) where status = 'scheduled';
