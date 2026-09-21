-- Allow multiple exercise types per slot (e.g. squats + push-ups at the same time).
-- The old unique(slot_at) prevented this; the new key is (slot_at, exercise_type_id).
alter table exercise_logs drop constraint if exists exercise_logs_slot_at_key;
alter table exercise_logs add constraint exercise_logs_slot_type_key unique (slot_at, exercise_type_id);
