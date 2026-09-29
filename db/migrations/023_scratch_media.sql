-- Scratchpad gets checklists, tables, links, code snippets, voice memos and files (photos, videos, PDFs, documents).
-- Files live in Supabase Storage; the row keeps their description (path, name, type, size).
alter table scratch_items drop constraint if exists scratch_items_kind_check;
alter table scratch_items add constraint scratch_items_kind_check
  check (kind in ('note','sketch','calc','graph','checklist','table','link','code','voice','file'));
