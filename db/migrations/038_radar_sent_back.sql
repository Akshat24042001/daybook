-- When a lead made into a deal by mistake was sent back to the radar: it shows on Radar (and gets its move again)
-- for a while from that moment, even if it was found more than 10 days ago.
alter table sales_radar_items add column if not exists sent_back_at timestamptz;
