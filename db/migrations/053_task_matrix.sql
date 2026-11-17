-- Priorities: every task can sit in two 2x2 boards.
--   Value x Effort: Quick wins (high value, low effort), Big bets (high, high), Fill-ins (low, low), Time sinks (low, high).
--   Urgent x Important (Eisenhower): Do now, Schedule, Delegate, Drop.
-- Each axis is stored on its own, so a task keeps its place in both, and "unsorted" is simply null.
alter table tasks add column if not exists value_level text check (value_level in ('high','low'));
alter table tasks add column if not exists effort_level text check (effort_level in ('high','low'));
alter table tasks add column if not exists importance text check (importance in ('high','low'));
alter table tasks add column if not exists urgency text check (urgency in ('high','low'));
-- your order inside a box (lower is higher up); null keeps the natural order
alter table tasks add column if not exists value_rank int;
alter table tasks add column if not exists eisen_rank int;
-- why the AI put it there, when it did (shown on the card until you move it yourself)
alter table tasks add column if not exists matrix_why text;
