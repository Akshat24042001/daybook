alter table settings
  add column lunch_start text,
  add column lunch_end   text;
-- default: 2pm–3pm (matches user's request; null = no lunch break)
update settings set lunch_start = '14:00', lunch_end = '15:00' where id = 1;
