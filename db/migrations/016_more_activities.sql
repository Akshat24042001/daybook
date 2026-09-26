-- More ways to spend a slice of the day. Work: office, outside, remote. Not work: commute, meal, break, exercise, personal.
alter table work_segments drop constraint if exists work_segments_kind_check;
alter table work_segments add constraint work_segments_kind_check
  check (kind in ('office','outside','remote','commute','meal','break','exercise','personal'));
