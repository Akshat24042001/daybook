-- split single city/company text into arrays
alter table contacts
  add column cities text[] not null default '{}',
  add column companies text[] not null default '{}';

-- migrate existing data: split on comma, trim whitespace
update contacts
set
  cities = array(
    select trim(v)
    from unnest(string_to_array(city, ',')) as v
    where trim(v) <> ''
  ),
  companies = array(
    select trim(v)
    from unnest(string_to_array(company, ',')) as v
    where trim(v) <> ''
  )
where city is not null or company is not null;

alter table contacts drop column city;
alter table contacts drop column company;

-- GIN indexes for efficient array filtering
create index contacts_cities on contacts using gin (cities);
create index contacts_companies on contacts using gin (companies);
