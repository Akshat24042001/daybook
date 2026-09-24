-- Sleep tracker: how long you slept into this logical day, and how well (1 = awful, 5 = great).
alter table days add column if not exists sleep_minutes int check (sleep_minutes is null or (sleep_minutes >= 0 and sleep_minutes <= 1440));
alter table days add column if not exists sleep_quality smallint check (sleep_quality is null or (sleep_quality between 1 and 5));
