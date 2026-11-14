-- Every qualified radar lead is prepared on its own (requirement, business behind it, company research, decision
-- maker and contacts, a draft). Progress and the result live here.
alter table sales_radar_items add column if not exists prep jsonb;
-- the old "research from score 70" default becomes "prepare every qualified lead"; a value you chose yourself stays
update sales_settings set config = jsonb_set(config, '{radar,auto_research_score}', '0'::jsonb)
 where config->'radar'->>'auto_research_score' = '70';
