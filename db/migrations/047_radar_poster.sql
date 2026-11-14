-- Who posted a radar lead (the platform's public name, username, location), and who is behind it once researched
-- (the business, the decision maker, public business contacts, with the evidence for each).
alter table sales_radar_items add column if not exists poster jsonb;
alter table sales_radar_items add column if not exists identity jsonb;
create index if not exists sales_radar_items_posted_idx on sales_radar_items (coalesce(posted_at, found_at) desc);
