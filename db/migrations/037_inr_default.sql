-- INR is the default currency: new deals, quotes and payments start in INR, and every total (targets, Insights, Stats,
-- the review, Telegram) is shown in the report currency, INR unless you pick another in Sales settings.
-- Amounts already recorded keep the currency they were entered in.
alter table sales_deals alter column currency set default 'INR';
alter table sales_quote_revisions alter column currency set default 'INR';
alter table sales_payments alter column currency set default 'INR';

-- Saved settings carry the old defaults; move them to INR. The old USD revenue target becomes an INR target at your
-- saved INR rate (1 INR = x USD), rounded to the rupee.
update sales_settings
set config = jsonb_set(
  jsonb_set(
    jsonb_set(coalesce(config, '{}'::jsonb), '{default_currency}', '"INR"'),
    '{report_currency}', '"INR"'),
  '{targets}',
  (coalesce(config->'targets', '{}'::jsonb) - 'monthly_revenue_usd') || jsonb_build_object(
    'monthly_revenue',
    case
      when coalesce((config->'targets'->>'monthly_revenue')::numeric, 0) > 0 then (config->'targets'->>'monthly_revenue')::numeric
      when coalesce((config->'targets'->>'monthly_revenue_usd')::numeric, 0) > 0
        then round((config->'targets'->>'monthly_revenue_usd')::numeric / nullif(coalesce((config->'fx'->>'INR')::numeric, 0.012), 0))
      else 0
    end))
where id = 1 and coalesce(config->>'report_currency', '') = '';
