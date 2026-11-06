-- Sales priority: a 0 to 100 score that rises and falls with real engagement, with yesterday's value for the trend
-- arrow and the reasons behind it. Touches sales_* tables only.
alter table sales_deals add column if not exists priority int not null default 0;
alter table sales_deals add column if not exists priority_prev int;
alter table sales_deals add column if not exists priority_on date;
alter table sales_deals add column if not exists priority_why text[] not null default '{}';
create index if not exists sales_deals_priority_idx on sales_deals (priority desc);

-- built-in stage colours move to the pastel palette, but only where the colour is still the original default
update sales_stages s set color = v.new_color
from (values
  ('new',          '#8D968F', '#9AA5B1'),
  ('contacted',    '#6B8AF0', '#7FB3E0'),
  ('engaged',      '#2F55E4', '#5CC8C2'),
  ('discovery',    '#2F55E4', '#8E9CF0'),
  ('proposal',     '#1F44C9', '#B39DF0'),
  ('negotiation',  '#1A39A8', '#F2A97E'),
  ('won',          '#1E8A5A', '#E0B84C'),
  ('active',       '#1E8A5A', '#6CC79A'),
  ('delivered',    '#1E8A5A', '#4FB39A'),
  ('paid',         '#146C46', '#2FA47A'),
  ('nurture',      '#B7791F', '#F2C94C'),
  ('ghosted',      '#B7791F', '#C9B79C'),
  ('hold',         '#B7791F', '#E8B4C8'),
  ('lost',         '#C0392B', '#E88A84'),
  ('disqualified', '#7F8C8D', '#B0B7C0')
) as v(key, old_color, new_color)
where s.key = v.key and upper(s.color) = upper(v.old_color);
