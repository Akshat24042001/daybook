-- Manual working hours override: when set, this replaces the segment-calculated worked time for the day.
alter table days add column if not exists worked_minutes_override int check (worked_minutes_override >= 0);
