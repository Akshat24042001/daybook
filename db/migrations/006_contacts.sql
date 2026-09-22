create table contacts (
  id serial primary key,
  name text not null,
  city text,
  company text,
  role text,
  phone text,
  email text,
  linkedin text,
  notes text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
