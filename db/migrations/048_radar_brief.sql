-- A plain-language brief of a radar lead (what they need, how you can help, what to ask), and when you last opened it.
alter table sales_radar_items add column if not exists brief jsonb;
alter table sales_radar_items add column if not exists seen_at timestamptz;
