-- Richer deals: location, qualification (BANT / MEDDPICC / gap), the closing record (won and lost), custom fields,
-- a dated history of field changes, dated activity with outcome and duration, and categorised documents.

-- ---------------------------------------------------------------- deals
alter table sales_deals add column if not exists deal_type text not null default 'new'
  check (deal_type in ('new','upsell','renewal','repeat','partnership','other'));
alter table sales_deals add column if not exists industry text;
alter table sales_deals add column if not exists city text;
alter table sales_deals add column if not exists region text;
alter table sales_deals add column if not exists address text;
-- anything else worth knowing, in your words
alter table sales_deals add column if not exists notes text;
-- qualification: what is wrong today, what they want, what it is worth to them, what they use now, why now
alter table sales_deals add column if not exists pain text;
alter table sales_deals add column if not exists desired_outcome text;
alter table sales_deals add column if not exists impact text;
alter table sales_deals add column if not exists current_solution text;
alter table sales_deals add column if not exists compelling_event text;
-- how they decide: who signs, who pushes for you inside, on what criteria, the steps, the paperwork
alter table sales_deals add column if not exists economic_buyer_id int references sales_people(id) on delete set null;
alter table sales_deals add column if not exists champion_id int references sales_people(id) on delete set null;
alter table sales_deals add column if not exists decision_criteria text;
alter table sales_deals add column if not exists decision_process text;
alter table sales_deals add column if not exists paper_process text;
alter table sales_deals add column if not exists competitors text[] not null default '{}';
alter table sales_deals add column if not exists risks text;
-- the closing record
alter table sales_deals add column if not exists poc_id int references sales_people(id) on delete set null;
alter table sales_deals add column if not exists start_date date;
alter table sales_deals add column if not exists delivery_date date;
alter table sales_deals add column if not exists delivery_duration text;
alter table sales_deals add column if not exists scope text;
alter table sales_deals add column if not exists payment_terms text;
alter table sales_deals add column if not exists contract_ref text;
alter table sales_deals add column if not exists won_reason text;
alter table sales_deals add column if not exists won_detail text;
alter table sales_deals add column if not exists lost_detail text;
alter table sales_deals add column if not exists lost_to text;
alter table sales_deals add column if not exists lessons text;
-- your own fields (Sales settings > Fields), by key
alter table sales_deals add column if not exists custom jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- companies and people
alter table sales_companies add column if not exists region text;
alter table sales_companies add column if not exists address text;
alter table sales_companies add column if not exists postal_code text;
alter table sales_companies add column if not exists phone text;
alter table sales_companies add column if not exists email text;
alter table sales_companies add column if not exists tax_id text;
alter table sales_companies add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sales_people add column if not exists department text;
alter table sales_people add column if not exists seniority text;
alter table sales_people add column if not exists whatsapp text;
alter table sales_people add column if not exists preferred_channel text;
alter table sales_people add column if not exists language text;
alter table sales_people add column if not exists custom jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- history of changes
alter table sales_deal_events drop constraint if exists sales_deal_events_kind_check;
alter table sales_deal_events add constraint sales_deal_events_kind_check check (kind in ('stage','value','note','created','merge','field'));
alter table sales_deal_events add column if not exists field text;
alter table sales_deal_events add column if not exists old_value text;
alter table sales_deal_events add column if not exists new_value text;
alter table sales_deal_events add column if not exists edited_at timestamptz;
create index if not exists sales_deal_events_deal_idx on sales_deal_events (deal_id, created_at);

-- ---------------------------------------------------------------- activity
alter table sales_interactions add column if not exists outcome text;
alter table sales_interactions add column if not exists duration_min int check (duration_min is null or duration_min between 0 and 1440);
alter table sales_interactions add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------------- documents
alter table sales_docs add column if not exists category text;
-- internal papers (signed contract, PO): kept on the deal, never sent as a tracked link
alter table sales_docs add column if not exists internal boolean not null default false;

-- ---------------------------------------------------------------- custom fields
create table if not exists sales_custom_fields (
  id serial primary key,
  scope text not null default 'deal' check (scope in ('deal','company','person')),
  key text not null,
  label text not null,
  type text not null default 'text' check (type in ('text','long_text','number','money','date','select','multi_select','checkbox','url','phone','email')),
  options text[] not null default '{}',
  help text,
  -- shown in the Won checklist and must be filled to close as won
  required_to_win boolean not null default false,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (scope, key)
);

-- like every sales table: only the owner can read it through the public API, and changes can be undone
do $$
begin
  execute 'alter table public.sales_custom_fields enable row level security';
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_custom_fields' and policyname = 'owner_only') then
    execute 'create policy owner_only on public.sales_custom_fields for all using (public.is_owner()) with check (public.is_owner())';
  end if;
end
$$;
select journal_install();
