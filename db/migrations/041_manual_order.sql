-- Your own order of deals inside a stage. Drag a card above another and it stays there; deals you never placed
-- follow the automatic priority below the ones you did. A smaller number sits higher. Null means automatic.
alter table sales_deals add column if not exists manual_rank double precision;

-- a deal that moves to another stage starts that column in automatic order again
create or replace function sales_deals_clear_rank() returns trigger language plpgsql as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.manual_rank := null;
  end if;
  return new;
end $$;
drop trigger if exists sales_deals_clear_rank on sales_deals;
create trigger sales_deals_clear_rank before update of stage_id on sales_deals
  for each row execute function sales_deals_clear_rank();
