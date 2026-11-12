-- A screenshot is read into text first and kept, so a retry does not read it again.
alter table sales_captures add column if not exists screen_text text;
-- The latest picture of the conversation on a deal: quick actions to take next and a reply you could send.
alter table sales_deals add column if not exists conversation jsonb;
