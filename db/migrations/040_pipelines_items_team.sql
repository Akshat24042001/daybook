-- Pipelines, line items, recurring revenue and renewals, stage playbooks, team and deal owners.

-- ---------------------------------------------------------------- pipelines
-- A pipeline is a named lane of deals with the stages it shows. Stages and their automation stay shared, so a deal in
-- any pipeline is moved, chased and closed the same way.
create table if not exists sales_pipelines (
  id serial primary key,
  name text not null,
  -- the stages this pipeline shows on its board; empty means all
  stage_ids int[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into sales_pipelines (name, sort) select 'Sales', 10 where not exists (select 1 from sales_pipelines);
alter table sales_deals add column if not exists pipeline_id int references sales_pipelines(id) on delete set null;
update sales_deals set pipeline_id = (select min(id) from sales_pipelines) where pipeline_id is null;

-- ---------------------------------------------------------------- line items
create table if not exists sales_deal_items (
  id serial primary key,
  deal_id int not null references sales_deals(id) on delete cascade,
  name text not null,
  description text,
  qty numeric not null default 1 check (qty >= 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  discount_pct numeric not null default 0 check (discount_pct between 0 and 100),
  tax_pct numeric not null default 0 check (tax_pct between 0 and 100),
  billing text not null default 'one_time' check (billing in ('one_time','monthly','quarterly','yearly')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sales_deal_items_deal_idx on sales_deal_items (deal_id, sort);

-- ---------------------------------------------------------------- recurring revenue and renewals
alter table sales_deals add column if not exists recurring_amount numeric check (recurring_amount is null or recurring_amount >= 0);
alter table sales_deals add column if not exists billing_cycle text check (billing_cycle is null or billing_cycle in ('monthly','quarterly','yearly'));
alter table sales_deals add column if not exists contract_start date;
alter table sales_deals add column if not exists contract_end date;
alter table sales_deals add column if not exists renewal_notice_days int not null default 30 check (renewal_notice_days between 0 and 365);
alter table sales_deals add column if not exists auto_renew boolean not null default false;

-- ---------------------------------------------------------------- stage playbooks: what you ticked on this deal
alter table sales_deals add column if not exists checklist jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- team and owners
create table if not exists sales_team (
  id serial primary key,
  name text not null,
  email text,
  phone text,
  role text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sales_deals add column if not exists owner_id int references sales_team(id) on delete set null;

-- like every sales table: owner-only through the public API, and undoable
do $$
declare t text;
begin
  foreach t in array array['sales_pipelines','sales_deal_items','sales_team'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format('create policy owner_only on public.%I for all using (public.is_owner()) with check (public.is_owner())', t);
    end if;
  end loop;
end
$$;
select journal_install();
