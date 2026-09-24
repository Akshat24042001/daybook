-- convert role, phone, email to arrays (linkedin stays single text — it's a URL)
alter table contacts
  add column roles text[] not null default '{}',
  add column phones text[] not null default '{}',
  add column emails text[] not null default '{}';

update contacts
set
  roles = case when role is not null and trim(role) <> ''
    then array(select trim(v) from unnest(string_to_array(role, ',')) as v where trim(v) <> '')
    else '{}' end,
  phones = case when phone is not null and trim(phone) <> ''
    then array(select trim(v) from unnest(string_to_array(phone, ',')) as v where trim(v) <> '')
    else '{}' end,
  emails = case when email is not null and trim(email) <> ''
    then array(select trim(v) from unnest(string_to_array(email, ',')) as v where trim(v) <> '')
    else '{}' end;

alter table contacts drop column role;
alter table contacts drop column phone;
alter table contacts drop column email;
