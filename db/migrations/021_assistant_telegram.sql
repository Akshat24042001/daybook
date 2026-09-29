-- The assistant in Telegram: which chat Telegram is continuing, where each chat started, and which Telegram message
-- shows each answer (so a button tap can redraw that message's buttons).
alter table settings add column if not exists assistant_tg_chat_id int;
alter table assistant_chats add column if not exists source text not null default 'web';
alter table assistant_chats drop constraint if exists assistant_chats_source_check;
alter table assistant_chats add constraint assistant_chats_source_check check (source in ('web','telegram'));
alter table assistant_messages add column if not exists tg_message_id bigint;
create index if not exists assistant_messages_tg_idx on assistant_messages (tg_message_id) where tg_message_id is not null;
