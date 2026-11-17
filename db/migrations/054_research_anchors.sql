-- Who set a company's website: 'you' (typed, or the lead shared it), 'research' (found by the AI research). A website
-- research found can be replaced when a later run proves it belongs to a namesake; yours never is.
alter table sales_companies add column if not exists website_source text check (website_source in ('you','lead','research'));
