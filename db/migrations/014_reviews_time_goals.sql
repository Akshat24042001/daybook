-- Weekly / monthly reviews: the AI read of a finished period, plus the intentions set for a period.
-- A row can exist with only intentions (set for the coming week) and no AI content yet.
create table if not exists reviews (
  period text not null check (period in ('week','month')),
  start_date date not null,
  end_date date not null,
  headline text,
  narrative text,
  grade numeric(3,1) check (grade is null or (grade >= 0 and grade <= 10)),
  wins jsonb not null default '[]',
  patterns jsonb not null default '[]',
  drivers jsonb not null default '[]',
  decisions jsonb not null default '[]',
  -- [{ "text": "...", "done": true | false | null }]
  intentions jsonb not null default '[]',
  model text,
  generated_at timestamptz,
  primary key (period, start_date)
);

-- Time goals: a weekly hours budget per project ("Aivaura: 20h a week").
alter table projects add column if not exists weekly_target_min int
  check (weekly_target_min is null or (weekly_target_min > 0 and weekly_target_min <= 10080));
