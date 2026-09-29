-- Instagram time: minutes spent on Instagram on this logical day. The daily limit is 1 hour.
alter table days add column if not exists instagram_minutes int
  check (instagram_minutes is null or (instagram_minutes >= 0 and instagram_minutes <= 1440));
