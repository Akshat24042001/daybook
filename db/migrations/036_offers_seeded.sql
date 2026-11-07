-- The offer catalogue is copied from the old plain list exactly once. Where it already exists, mark the copy as done and
-- drop the old list from settings (saving settings could write catalogue lines into it before this fix).
update sales_settings set config = (config - 'offers') || '{"offers_seeded": true}'::jsonb
where exists (select 1 from sales_offers);
