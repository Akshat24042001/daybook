-- A chat can be about one area or one lead: {"area":"sales"} or {"deal_id":12}. The assistant then gets that lead's
-- full record with every question, so "this lead" and "it" mean that deal.
alter table assistant_chats add column if not exists focus jsonb;
