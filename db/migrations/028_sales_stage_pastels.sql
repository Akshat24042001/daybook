-- Stage colours follow the four-colour rule: open = blue, won = green, parked = yellow, lost = red, New = grey.
-- Only stages whose colour is still one of the earlier defaults change; a colour you picked yourself is kept.
-- Touches sales_stages only.
update sales_stages s set color = v.new_color
from (values
  ('new',          '#B4BBC6'),
  ('contacted',    '#A9C1EE'),
  ('engaged',      '#A9C1EE'),
  ('discovery',    '#A9C1EE'),
  ('proposal',     '#A9C1EE'),
  ('negotiation',  '#A9C1EE'),
  ('won',          '#9DD3B4'),
  ('active',       '#9DD3B4'),
  ('delivered',    '#9DD3B4'),
  ('paid',         '#9DD3B4'),
  ('nurture',      '#EDD28A'),
  ('ghosted',      '#EDD28A'),
  ('hold',         '#EDD28A'),
  ('lost',         '#E8A7A7'),
  ('disqualified', '#E8A7A7')
) as v(key, new_color)
where s.key = v.key and upper(s.color) in (
  -- 026 defaults
  '#8D968F', '#6B8AF0', '#2F55E4', '#1F44C9', '#1A39A8', '#1E8A5A', '#146C46', '#B7791F', '#C0392B', '#7F8C8D',
  -- 027 defaults
  '#9AA5B1', '#7FB3E0', '#5CC8C2', '#8E9CF0', '#B39DF0', '#F2A97E', '#E0B84C', '#6CC79A', '#4FB39A', '#2FA47A', '#F2C94C', '#C9B79C', '#E8B4C8', '#E88A84', '#B0B7C0'
);
