-- Screenshots you share are kept with the deal they were filed to. The image itself moves to file storage
-- (image_paths) when it is set up; until then it stays in the capture row (images, as data URLs).
alter table sales_captures add column if not exists deal_id int references sales_deals(id) on delete set null;
alter table sales_captures add column if not exists image_paths text[] not null default '{}';
create index if not exists sales_captures_deal_idx on sales_captures (deal_id) where deal_id is not null;

-- screenshots shared before this: link them to the deal they were filed to
update sales_captures c set deal_id = (c.result->>'deal_id')::int
where c.deal_id is null and c.status = 'done' and (c.result->>'deal_id') ~ '^\d+$'
  and exists (select 1 from sales_deals d where d.id = (c.result->>'deal_id')::int);
