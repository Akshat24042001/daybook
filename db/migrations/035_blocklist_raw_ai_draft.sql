-- Do not contact: keep what you typed ("Golf Corp Pvt Ltd") for display; matching still uses the canonical value ("golf").
alter table sales_blocklist add column if not exists raw text;

-- Message learning: the AI's own draft, kept apart from your edits, so "did you change it" is measured against what the AI wrote.
alter table sales_moves add column if not exists ai_draft text;
update sales_moves set ai_draft = draft where ai_draft is null and draft is not null;
