-- Arise Coffee v2 schema
-- Keep this close to the Google Sheets setup for now.

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  customer_name text not null,
  drink text not null,
  temperature text,
  milk text,
  syrups text[] default '{}',
  notes text,
  status text not null default 'waiting'
);

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  item text not null unique,
  type text not null,
  available boolean not null default true
);

create table if not exists settings (
  key text primary key,
  value text
);

insert into inventory (item, type, available) values
('Caramel','syrup',true),
('Sugar Free Caramel','syrup',true),
('Vanilla','syrup',true),
('Sugar Free Vanilla','syrup',true),
('Mocha','syrup',true),
('White Chocolate','syrup',true),
('Honey','syrup',true),
('Cinnamon Powder','syrup',true),
('Hazelnut','syrup',true),
('Almond milk','milk',true),
('Oat milk','milk',true),
('Soy milk','milk',true),
('Whole milk','milk',false)
on conflict (item) do nothing;

insert into settings (key, value) values
('pin','8246'),
('isOpen','true'),
('message','')
on conflict (key) do update
set value = excluded.value;
