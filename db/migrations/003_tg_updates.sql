-- Telegram re-delivers an update if the webhook did not answer 200 in time. Recording update ids lets the
-- bot skip a re-delivery instead of, say, logging minutes twice.
create table tg_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);
alter table tg_updates enable row level security;
create policy owner_only on public.tg_updates for all using (public.is_owner()) with check (public.is_owner());
