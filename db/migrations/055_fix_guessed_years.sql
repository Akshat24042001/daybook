-- Messages filed from screenshots or pasted chats whose year the AI guessed (the screen said "4 Nov", the model wrote
-- 2024) are moved to the latest year that is not after the day they were captured. Only when that year appears nowhere
-- in what was read, and only for dates 300 days or more before the capture. Then each touched deal's last-touch dates
-- are recomputed (a second statement, so it sees the corrected dates).
create temporary table if not exists fixed_years_deals (deal_id int);

with bad as (
  select i.id, c.created_at as captured,
         extract(year from c.created_at)::int - extract(year from i.occurred_at)::int as shift
    from sales_interactions i
    join sales_captures c on c.id = split_part(i.external_id, ':', 2)::int
   where i.external_id ~ '^cap:[0-9]+:'
     and i.occurred_at < c.created_at - interval '300 days'
     and position(extract(year from i.occurred_at)::int::text in coalesce(c.screen_text, '') || ' ' || coalesce(c.text, '')) = 0
), moved as (
  update sales_interactions i
     set occurred_at = i.occurred_at + make_interval(years => b.shift - case when i.occurred_at + make_interval(years => b.shift) > b.captured + interval '2 days' then 1 else 0 end)
    from bad b
   where i.id = b.id and b.shift > 0
  returning i.deal_id
)
insert into fixed_years_deals (deal_id) select deal_id from moved where deal_id is not null;

update sales_deals d set
  last_touch_at = (select max(occurred_at) from sales_interactions where deal_id = d.id and direction <> 'internal'),
  last_inbound_at = (select max(occurred_at) from sales_interactions where deal_id = d.id and direction in ('in','both')),
  last_outbound_at = (select max(occurred_at) from sales_interactions where deal_id = d.id and direction in ('out','both'))
 where d.id in (select deal_id from fixed_years_deals);

drop table if exists fixed_years_deals;
