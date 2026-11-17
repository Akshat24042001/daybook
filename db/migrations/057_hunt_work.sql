-- "Find them directly" runs in two background rounds; what round one read is kept here for round two (never sent to the page).
alter table sales_radar_items add column if not exists hunt_work jsonb;
