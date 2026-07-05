-- Arise Coffee Supabase compatibility layer.
-- Run this in the Supabase SQL Editor before switching src/api/backend.js to supabaseBackend.

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null,
  drink text not null,
  temperature text,
  milk text,
  syrups text[] default '{}',
  notes text,
  status text not null default 'waiting'
);

alter table orders add column if not exists created_at timestamptz not null default now();
alter table orders add column if not exists customer_name text;
alter table orders add column if not exists drink text;
alter table orders add column if not exists temperature text;
alter table orders add column if not exists milk text;
alter table orders add column if not exists syrups text[] default '{}';
alter table orders add column if not exists notes text;
alter table orders add column if not exists status text not null default 'waiting';

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  item text not null unique,
  type text not null check (type in ('syrup', 'milk')),
  available boolean not null default true
);

alter table inventory add column if not exists item text;
alter table inventory add column if not exists type text;
alter table inventory add column if not exists available boolean not null default true;

create table if not exists settings (
  key text primary key,
  value text
);

create table if not exists archived_orders (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  original_order_id uuid,
  order_data jsonb not null
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
('pin','"8246"'),
('isOpen','"true"'),
('message','""')
on conflict (key) do nothing;

alter table orders enable row level security;
alter table inventory enable row level security;
alter table settings enable row level security;
alter table archived_orders enable row level security;

revoke all on orders from anon;
revoke all on inventory from anon;
revoke all on settings from anon;
revoke all on archived_orders from anon;

create or replace function arise_setting(input_key text, fallback text default '')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select trim(both '"' from value::text)
      from settings
      where key = input_key
      limit 1
    ),
    fallback
  );
$$;

create or replace function arise_pin_matches(input_pin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(input_pin, '') = arise_setting('pin', '');
$$;

create or replace function arise_inventory_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sorted as (
    select item, type, available
    from inventory
    order by
      case type when 'syrup' then 0 when 'milk' then 1 else 2 end,
      item
  )
  select jsonb_build_object(
    'syrups', coalesce(
      jsonb_agg(jsonb_build_object('item', item, 'type', 'syrup', 'available', available))
        filter (where type = 'syrup'),
      '[]'::jsonb
    ),
    'milks', coalesce(
      jsonb_agg(jsonb_build_object('item', item, 'type', 'milk', 'available', available))
        filter (where type = 'milk'),
      '[]'::jsonb
    )
  )
  from sorted;
$$;

create or replace function arise_order_json(input_order orders, input_position integer default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when input_order is null then 'null'::jsonb
    else jsonb_build_object(
      'id', (input_order).id,
      'time', (input_order).created_at,
      'name', (input_order).customer_name,
      'drink', (input_order).drink,
      'temp', (input_order).temperature,
      'milk', coalesce((input_order).milk, ''),
      'syrups', array_to_string(coalesce((input_order).syrups, '{}'::text[]), ', '),
      'notes', coalesce((input_order).notes, ''),
      'status', coalesce((input_order).status, 'waiting'),
      'position', input_position,
      'ordersAhead', case when input_position is null then null else greatest(0, input_position - 1) end
    )
  end;
$$;

create or replace function arise_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'isOpen', arise_setting('isOpen', 'true') = 'true',
    'message', arise_setting('message', '')
  );
$$;

create or replace function arise_inventory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'inventory', arise_inventory_json()
  );
$$;

create or replace function arise_login(input_pin text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when arise_pin_matches(input_pin) then jsonb_build_object('ok', true)
    else jsonb_build_object('ok', false, 'error', 'Wrong PIN')
  end;
$$;

create or replace function arise_orders()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with active as (
    select
      orders as order_row,
      orders.created_at,
      row_number() over (order by created_at) as position
    from orders
    where status <> 'complete'
  )
  select jsonb_build_object(
    'ok', true,
    'isOpen', arise_setting('isOpen', 'true') = 'true',
    'message', arise_setting('message', ''),
    'orders', coalesce(jsonb_agg(arise_order_json(active.order_row, active.position::integer) order by active.created_at), '[]'::jsonb),
    'inventory', arise_inventory_json()
  )
  from active;
$$;

create or replace function arise_order(order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found_order orders;
  found_position integer;
  found_id uuid;
begin
  select id, position::integer
  into found_id, found_position
  from (
    select
      id,
      row_number() over (order by created_at) as position
    from orders
    where status <> 'complete'
  ) active
  where id = order_id
  limit 1;

  if found_id is null then
    select id
    into found_id
    from orders
    where id = order_id
      and status = 'complete'
    limit 1;

    found_position := null;
  end if;

  if found_id is not null then
    select orders
    into found_order
    from orders
    where id = found_id
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'isOpen', arise_setting('isOpen', 'true') = 'true',
    'message', arise_setting('message', ''),
    'order', arise_order_json(found_order, found_position),
    'position', found_position,
    'ordersAhead', case when found_position is null then null else greatest(0, found_position - 1) end
  );
end;
$$;

create or replace function arise_place_order(input_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  order_state jsonb;
begin
  if arise_setting('isOpen', 'true') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'Queue closed');
  end if;

  insert into orders (customer_name, drink, temperature, milk, syrups, notes, status)
  values (
    coalesce(input_order->>'name', ''),
    coalesce(input_order->>'drink', ''),
    coalesce(input_order->>'temp', ''),
    coalesce(input_order->>'milk', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(input_order->'syrups', '[]'::jsonb))), '{}'::text[]),
    coalesce(input_order->>'notes', ''),
    'waiting'
  )
  returning id into new_id;

  order_state := arise_order(new_id);

  return jsonb_build_object(
    'ok', true,
    'id', new_id,
    'position', order_state->'position',
    'ordersAhead', order_state->'ordersAhead'
  );
end;
$$;

create or replace function arise_update_admin(input_pin text, input_is_open boolean default null, input_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  if input_is_open is not null then
    insert into settings (key, value)
    values ('isOpen', case when input_is_open then '"true"' else '"false"' end)
    on conflict (key) do update set value = excluded.value;
  end if;

  if input_message is not null then
    insert into settings (key, value)
    values ('message', to_jsonb(input_message)::text)
    on conflict (key) do update set value = excluded.value;
  end if;

  return arise_orders();
end;
$$;

create or replace function arise_update_status(input_pin text, order_id uuid, input_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_order orders;
  order_state jsonb;
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  update orders
  set status = input_status
  where id = order_id
  returning * into updated_order;

  if updated_order is null then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  order_state := arise_order(order_id);

  return jsonb_build_object(
    'ok', true,
    'order', coalesce(order_state->'order', arise_order_json(updated_order, null))
  );
end;
$$;

create or replace function arise_update_inventory(input_pin text, input_item text, input_available boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  update inventory
  set available = input_available
  where item = input_item;

  get diagnostics changed = row_count;

  if changed = 0 then
    return jsonb_build_object('ok', false, 'error', 'Inventory item not found');
  end if;

  return arise_inventory();
end;
$$;

create or replace function arise_clear_completed(input_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  insert into archived_orders (original_order_id, order_data)
  select id, to_jsonb(orders)
  from orders
  where status = 'complete';

  delete from orders
  where status = 'complete';

  return arise_orders();
end;
$$;

create or replace function arise_clear_all(input_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  if arise_setting('isOpen', 'true') = 'true' then
    return jsonb_build_object('ok', false, 'error', 'Close the queue before clearing all orders');
  end if;

  insert into archived_orders (original_order_id, order_data)
  select id, to_jsonb(orders)
  from orders;

  delete from orders;

  return arise_orders();
end;
$$;

grant execute on function arise_status() to anon;
grant execute on function arise_inventory() to anon;
grant execute on function arise_login(text) to anon;
grant execute on function arise_orders() to anon;
grant execute on function arise_order(uuid) to anon;
grant execute on function arise_place_order(jsonb) to anon;
grant execute on function arise_update_admin(text, boolean, text) to anon;
grant execute on function arise_update_status(text, uuid, text) to anon;
grant execute on function arise_update_inventory(text, text, boolean) to anon;
grant execute on function arise_clear_completed(text) to anon;
grant execute on function arise_clear_all(text) to anon;
