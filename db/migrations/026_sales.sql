-- Sales: companies, people, deals with a configurable state machine, every interaction on every channel,
-- commitments both ways, ranked moves, tracked documents (quotes with revisions), payments, the lead radar and a job queue.
-- Design notes live in docs/SALES.md.

-- ------------------------------------------------------------------ settings (one row)
create table if not exists sales_settings (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  capture_token text not null default md5(random()::text || clock_timestamp()::text || random()::text),
  google_secret text not null default md5(random()::text || clock_timestamp()::text || random()::text),
  apps_script_url text,
  last_brief_on date,
  last_review_on date,
  last_radar_digest_on date,
  updated_at timestamptz not null default now()
);
insert into sales_settings (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------------ state machine
create table if not exists sales_stages (
  id serial primary key,
  key text not null unique,
  name text not null,
  -- automation targets stages by role, so renaming or reordering never breaks it; custom stages have no role
  role text unique,
  category text not null check (category in ('open','won','lost','parked')),
  probability int not null default 0 check (probability between 0 and 100),
  sla_days int check (sla_days is null or sla_days between 1 and 365),
  sort int not null default 0,
  color text not null default '#2F55E4',
  description text,
  active boolean not null default true
);

create table if not exists sales_transitions (
  from_stage int not null references sales_stages(id) on delete cascade,
  to_stage int not null references sales_stages(id) on delete cascade,
  -- what the move needs before it is allowed: a reason, a revisit date, a sent quote, or nothing
  requires text not null default 'none' check (requires in ('none','reason','date','quote')),
  primary key (from_stage, to_stage)
);

insert into sales_stages (key, name, role, category, probability, sla_days, sort, color, description) values
  ('new',          'New',                    'new',          'open',    5,  2,    10, '#8D968F', 'Found or captured, not contacted yet'),
  ('contacted',    'Contacted',              'contacted',    'open',   10,  21,   20, '#6B8AF0', 'First touch sent, waiting for a reply'),
  ('engaged',      'In conversation',        'engaged',      'open',   20,  7,    30, '#2F55E4', 'They replied: a two-way conversation'),
  ('discovery',    'Discovery',              'discovery',    'open',   35,  10,   40, '#2F55E4', 'Meeting booked or held, requirement being understood'),
  ('proposal',     'Proposal sent',          'proposal',     'open',   50,  7,    50, '#1F44C9', 'A quote or proposal is with them'),
  ('negotiation',  'Negotiation',            'negotiation',  'open',   65,  7,    60, '#1A39A8', 'Price, scope or terms being worked out'),
  ('won',          'Won, advance pending',   'won',          'won',    90,  7,    70, '#1E8A5A', 'They said yes; money not in yet'),
  ('active',       'Project live',           'active',       'won',   100,  null, 80, '#1E8A5A', 'Advance received, work in progress'),
  ('delivered',    'Delivered, balance due', 'delivered',    'won',   100,  14,   90, '#1E8A5A', 'Work handed over, final payment pending'),
  ('paid',         'Paid in full',           'paid',         'won',   100,  null, 100,'#146C46', 'Every payment received'),
  ('nurture',      'Nurture (not now)',      'nurture',      'parked',  5,  null, 110,'#B7791F', 'Interested but not now: revisit on a date'),
  ('ghosted',      'Ghosted',                'ghosted',      'parked',  3,  null, 120,'#B7791F', 'No reply after the full follow-up sequence'),
  ('hold',         'On hold',                'hold',         'parked', 30,  null, 130,'#B7791F', 'Client paused it: revisit on a date'),
  ('lost',         'Lost',                   'lost',         'lost',    0,  null, 140,'#C0392B', 'They said no or chose someone else'),
  ('disqualified', 'Disqualified',           'disqualified', 'lost',    0,  null, 150,'#7F8C8D', 'Not a fit, spam or no budget')
on conflict (key) do nothing;

-- allowed edges (from -> to, requirement)
insert into sales_transitions (from_stage, to_stage, requires)
select f.id, t.id, e.req
from (values
  ('new','contacted','none'), ('new','engaged','none'), ('new','discovery','none'), ('new','proposal','quote'),
  ('new','nurture','date'), ('new','lost','reason'), ('new','disqualified','reason'),
  ('contacted','engaged','none'), ('contacted','discovery','none'), ('contacted','ghosted','none'),
  ('contacted','nurture','date'), ('contacted','lost','reason'), ('contacted','disqualified','reason'),
  ('engaged','discovery','none'), ('engaged','proposal','quote'), ('engaged','nurture','date'), ('engaged','hold','date'),
  ('engaged','ghosted','none'), ('engaged','lost','reason'), ('engaged','disqualified','reason'),
  ('discovery','proposal','quote'), ('discovery','engaged','none'), ('discovery','nurture','date'), ('discovery','hold','date'),
  ('discovery','ghosted','none'), ('discovery','lost','reason'), ('discovery','disqualified','reason'),
  ('proposal','negotiation','none'), ('proposal','won','none'), ('proposal','discovery','none'), ('proposal','nurture','date'),
  ('proposal','hold','date'), ('proposal','ghosted','none'), ('proposal','lost','reason'),
  ('negotiation','won','none'), ('negotiation','proposal','quote'), ('negotiation','nurture','date'), ('negotiation','hold','date'),
  ('negotiation','ghosted','none'), ('negotiation','lost','reason'),
  ('won','active','none'), ('won','hold','date'), ('won','lost','reason'),
  ('active','delivered','none'), ('active','hold','date'), ('active','lost','reason'), ('active','paid','none'),
  ('delivered','paid','none'), ('delivered','active','none'),
  ('nurture','contacted','none'), ('nurture','engaged','none'), ('nurture','discovery','none'), ('nurture','proposal','quote'), ('nurture','lost','reason'),
  ('ghosted','contacted','none'), ('ghosted','engaged','none'), ('ghosted','nurture','date'), ('ghosted','lost','reason'),
  ('hold','engaged','none'), ('hold','discovery','none'), ('hold','proposal','quote'), ('hold','active','none'),
  ('hold','nurture','date'), ('hold','lost','reason'),
  ('lost','engaged','none'), ('lost','nurture','date'),
  ('disqualified','new','none')
) as e(f, t, req)
join sales_stages f on f.key = e.f
join sales_stages t on t.key = e.t
on conflict do nothing;

-- ------------------------------------------------------------------ accounts
create table if not exists sales_companies (
  id serial primary key,
  name text not null,
  domain text,
  website text,
  country text,
  city text,
  industry text,
  employees int,
  revenue_usd numeric,
  revenue_is_estimate boolean not null default true,
  listed boolean,
  linkedin text,
  description text,
  enrichment jsonb not null default '{}'::jsonb,
  enriched_at timestamptz,
  audit jsonb,
  audited_at timestamptz,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_companies_domain_uq on sales_companies (lower(domain)) where domain is not null;
create index if not exists sales_companies_name_idx on sales_companies (lower(name));

create table if not exists sales_people (
  id serial primary key,
  company_id int references sales_companies(id) on delete set null,
  full_name text not null,
  title text,
  emails text[] not null default '{}',
  phones text[] not null default '{}',
  linkedin text,
  instagram text,
  twitter text,
  city text,
  country text,
  -- how you know them: cold, warm (network), referral, partner (intermediary), client
  relationship text not null default 'cold' check (relationship in ('cold','warm','referral','partner','client')),
  is_decision_maker boolean,
  enrichment jsonb not null default '{}'::jsonb,
  enriched_at timestamptz,
  contact_id int references contacts(id) on delete set null,
  notes text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_people_name_idx on sales_people (lower(full_name));
create index if not exists sales_people_company_idx on sales_people (company_id);

-- identity resolution: every handle a person is known by, normalised, unique across people
create table if not exists sales_identities (
  id serial primary key,
  person_id int not null references sales_people(id) on delete cascade,
  kind text not null check (kind in ('email','phone','linkedin','instagram','twitter','name')),
  value text not null,
  unique (kind, value)
);
create index if not exists sales_identities_person_idx on sales_identities (person_id);

-- ------------------------------------------------------------------ deals
create table if not exists sales_deals (
  id serial primary key,
  title text not null,
  company_id int references sales_companies(id) on delete set null,
  person_id int references sales_people(id) on delete set null,
  stage_id int not null references sales_stages(id),
  source text not null default 'outbound'
    check (source in ('radar','referral','inbound','content','outbound','network','partner','repeat','other')),
  source_detail text,
  radar_item_id int,
  -- the person who referred you, and an intermediary (agency, broker, consultant) the deal runs through
  referrer_id int references sales_people(id) on delete set null,
  intermediary_id int references sales_people(id) on delete set null,
  intermediary_type text check (intermediary_type is null or intermediary_type in ('referrer','agency','broker','consultant','partner')),
  -- when true, follow-ups go to the intermediary, not the client
  talk_via_intermediary boolean not null default false,
  commission_type text check (commission_type is null or commission_type in ('percent','fixed')),
  commission_value numeric,
  value_amount numeric,
  currency text not null default 'USD',
  value_usd numeric,
  probability int check (probability is null or probability between 0 and 100),
  expected_close date,
  services text[] not null default '{}',
  country text,
  next_action text,
  next_action_at timestamptz,
  heat int not null default 0,
  summary text,
  requirements text,
  budget text,
  timeline text,
  objections text[] not null default '{}',
  last_touch_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  lost_reason text,
  revisit_on date,
  sequence_paused boolean not null default false,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists sales_deals_stage_idx on sales_deals (stage_id);
create index if not exists sales_deals_person_idx on sales_deals (person_id);
create index if not exists sales_deals_company_idx on sales_deals (company_id);

-- everyone involved and their part in the decision
create table if not exists sales_deal_people (
  deal_id int not null references sales_deals(id) on delete cascade,
  person_id int not null references sales_people(id) on delete cascade,
  role text not null default 'contact'
    check (role in ('decision_maker','champion','influencer','user','finance','gatekeeper','referrer','intermediary','contact')),
  primary key (deal_id, person_id)
);

create table if not exists sales_deal_events (
  id serial primary key,
  deal_id int not null references sales_deals(id) on delete cascade,
  kind text not null default 'stage' check (kind in ('stage','value','note','created','merge')),
  from_stage int references sales_stages(id) on delete set null,
  to_stage int references sales_stages(id) on delete set null,
  cause text not null default 'manual' check (cause in ('manual','auto','ai','telegram','client')),
  detail text,
  interaction_id int,
  created_at timestamptz not null default now()
);
create index if not exists sales_deal_events_deal_idx on sales_deal_events (deal_id, created_at desc);

-- ------------------------------------------------------------------ captures and interactions
-- raw input as it arrived (a forwarded chat, a screenshot, an email, a voice note); processed by a job
create table if not exists sales_captures (
  id serial primary key,
  source text not null,
  channel text,
  text text,
  images jsonb not null default '[]'::jsonb,
  hints jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','done','needs_person','ignored','failed')),
  result jsonb,
  error text,
  tg_chat bigint,
  tg_message_id bigint,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists sales_interactions (
  id serial primary key,
  deal_id int references sales_deals(id) on delete cascade,
  person_id int references sales_people(id) on delete set null,
  company_id int references sales_companies(id) on delete set null,
  channel text not null default 'other'
    check (channel in ('email','whatsapp','linkedin','instagram','call','meeting','in_person','telegram','sms','twitter','document','other','note')),
  direction text not null default 'out' check (direction in ('in','out','both','internal')),
  occurred_at timestamptz not null default now(),
  subject text,
  body text,
  summary text,
  source text not null default 'manual',
  -- 'assumed' when logged from a one-tap send (you tapped, we assume it went)
  confidence text not null default 'sure' check (confidence in ('sure','assumed')),
  external_id text unique,
  capture_id int references sales_captures(id) on delete set null,
  extracted jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sales_interactions_deal_idx on sales_interactions (deal_id, occurred_at desc);
create index if not exists sales_interactions_person_idx on sales_interactions (person_id, occurred_at desc);

-- per-message dedupe for chat exports, so exporting the same chat again only adds what is new
create table if not exists sales_seen (
  hash text primary key,
  created_at timestamptz not null default now()
);

create table if not exists sales_commitments (
  id serial primary key,
  deal_id int references sales_deals(id) on delete cascade,
  person_id int references sales_people(id) on delete set null,
  owner text not null check (owner in ('me','them')),
  text text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','dropped')),
  interaction_id int references sales_interactions(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists sales_commitments_open_idx on sales_commitments (status, due_at);

-- ------------------------------------------------------------------ moves (the action list)
create table if not exists sales_moves (
  id serial primary key,
  deal_id int references sales_deals(id) on delete cascade,
  radar_item_id int,
  kind text not null,
  title text not null,
  why text,
  channel text,
  draft text,
  draft_subject text,
  due_at timestamptz not null default now(),
  score int not null default 50,
  status text not null default 'open' check (status in ('open','done','skipped','snoozed','obsolete')),
  snoozed_until timestamptz,
  created_by text not null default 'auto' check (created_by in ('auto','ai','me')),
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists sales_moves_open_idx on sales_moves (status, due_at);

-- ------------------------------------------------------------------ meetings (from Google Calendar)
create table if not exists sales_meetings (
  id serial primary key,
  external_id text unique,
  deal_id int references sales_deals(id) on delete set null,
  person_id int references sales_people(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  attendees text[] not null default '{}',
  link text,
  description text,
  brief_sent_at timestamptz,
  debrief_sent_at timestamptz,
  transcript_at timestamptz,
  cancelled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists sales_meetings_start_idx on sales_meetings (starts_at);

-- ------------------------------------------------------------------ tracked documents
create table if not exists sales_docs (
  id serial primary key,
  slug text not null unique,
  kind text not null check (kind in ('quote','brief','link','file')),
  deal_id int references sales_deals(id) on delete cascade,
  company_id int references sales_companies(id) on delete set null,
  title text not null,
  target_url text,
  file_path text,
  file_name text,
  body text,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','rejected','expired','changes')),
  current_rev int not null default 1,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  accepted_at timestamptz,
  accepted_by text,
  client_note text,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_docs_deal_idx on sales_docs (deal_id);

create table if not exists sales_quote_revisions (
  id serial primary key,
  doc_id int not null references sales_docs(id) on delete cascade,
  rev int not null,
  currency text not null default 'USD',
  items jsonb not null default '[]'::jsonb,
  discount numeric not null default 0,
  tax_pct numeric not null default 0,
  total numeric not null default 0,
  intro text,
  scope text,
  timeline text,
  terms text,
  payment_plan jsonb not null default '[]'::jsonb,
  validity_days int not null default 14,
  change_note text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (doc_id, rev)
);

create table if not exists sales_doc_views (
  id serial primary key,
  doc_id int not null references sales_docs(id) on delete cascade,
  rev int,
  viewed_at timestamptz not null default now(),
  visitor text,
  country text,
  city text,
  device text,
  ua text,
  seconds int not null default 0
);
create index if not exists sales_doc_views_doc_idx on sales_doc_views (doc_id, viewed_at desc);

-- ------------------------------------------------------------------ money
create table if not exists sales_payments (
  id serial primary key,
  deal_id int not null references sales_deals(id) on delete cascade,
  label text not null,
  amount numeric not null,
  currency text not null default 'USD',
  due_on date,
  paid_on date,
  status text not null default 'due' check (status in ('due','paid','written_off')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists sales_payments_deal_idx on sales_payments (deal_id);

-- ------------------------------------------------------------------ lead radar
create table if not exists sales_radar_sources (
  id serial primary key,
  key text not null unique,
  name text not null,
  kind text not null,
  category text not null check (category in ('requirement','hiring','funding','review','tender','launch','content')),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  interval_hours int not null default 6,
  note text,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  items_found int not null default 0,
  items_qualified int not null default 0,
  deals_created int not null default 0,
  deals_won int not null default 0,
  managed boolean not null default true
);

create table if not exists sales_radar_items (
  id serial primary key,
  source_id int references sales_radar_sources(id) on delete set null,
  url text,
  url_hash text not null unique,
  title text not null,
  body text,
  author text,
  posted_at timestamptz,
  found_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','qualified','rejected','skipped','contacted','converted')),
  score int,
  fit jsonb,
  angle text,
  draft text,
  deal_id int references sales_deals(id) on delete set null,
  digest_sent_at timestamptz,
  alerted_at timestamptz
);
create index if not exists sales_radar_items_status_idx on sales_radar_items (status, found_at desc);

-- ------------------------------------------------------------------ job queue (processed by the minute tick)
create table if not exists sales_jobs (
  id serial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  locked_until timestamptz,
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists sales_jobs_queue_idx on sales_jobs (status, run_after);

-- Telegram prompts that expect a reply bound to a deal or meeting (debrief, "who is this?")
create table if not exists sales_tg_prompts (
  message_id bigint primary key,
  kind text not null,
  deal_id int,
  meeting_id int,
  capture_id int,
  created_at timestamptz not null default now()
);

-- escalation phone calls (hard daily cap)
create table if not exists sales_calls (
  id serial primary key,
  reason text not null,
  ref text,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);
