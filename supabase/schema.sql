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
alter table orders add column if not exists name text;
alter table orders add column if not exists customer_name text;
alter table orders add column if not exists drink text;
alter table orders add column if not exists temp text;
alter table orders add column if not exists temperature text;
alter table orders add column if not exists milk text;
alter table orders add column if not exists syrups text[] default '{}';
alter table orders add column if not exists notes text;
alter table orders add column if not exists status text not null default 'waiting';

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  item text not null unique,
  type text not null check (type in ('syrup', 'milk')),
  available boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0
);

alter table inventory add column if not exists item text;
alter table inventory add column if not exists type text;
alter table inventory add column if not exists available boolean not null default true;
alter table inventory add column if not exists active boolean not null default true;
alter table inventory add column if not exists sort_order integer not null default 0;

create table if not exists menu_drinks (
  id text primary key,
  label text not null,
  description text not null default '',
  temps text[] not null default array['Hot','Cold'],
  has_milk boolean not null default true,
  has_syrups boolean not null default true,
  show_temp boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table menu_drinks add column if not exists label text;
alter table menu_drinks add column if not exists description text not null default '';
alter table menu_drinks add column if not exists temps text[] not null default array['Hot','Cold'];
alter table menu_drinks add column if not exists has_milk boolean not null default true;
alter table menu_drinks add column if not exists has_syrups boolean not null default true;
alter table menu_drinks add column if not exists show_temp boolean not null default true;
alter table menu_drinks add column if not exists active boolean not null default true;
alter table menu_drinks add column if not exists sort_order integer not null default 0;
alter table menu_drinks add column if not exists updated_at timestamptz not null default now();

create table if not exists settings (
  key text primary key,
  value text
);

create table if not exists archived_orders (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  original_order_id uuid,
  original_order_id_text text,
  original_created_at timestamptz,
  customer_name text,
  drink text,
  temperature text,
  milk text,
  syrups text,
  notes text,
  status text,
  order_data jsonb not null
);

alter table archived_orders add column if not exists original_order_id_text text;
alter table archived_orders add column if not exists original_created_at timestamptz;
alter table archived_orders add column if not exists customer_name text;
alter table archived_orders add column if not exists drink text;
alter table archived_orders add column if not exists temperature text;
alter table archived_orders add column if not exists milk text;
alter table archived_orders add column if not exists syrups text;
alter table archived_orders add column if not exists notes text;
alter table archived_orders add column if not exists status text;

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

update inventory
set sort_order = ranked.sort_order
from (
  select item, row_number() over (
    partition by type
    order by
      case item
        when 'Whole milk' then 0
        when 'Almond milk' then 1
        when 'Oat milk' then 2
        when 'Soy milk' then 3
        when 'Caramel' then 0
        when 'Sugar Free Caramel' then 1
        when 'Vanilla' then 2
        when 'Sugar Free Vanilla' then 3
        when 'Mocha' then 4
        when 'White Chocolate' then 5
        when 'Honey' then 6
        when 'Cinnamon Powder' then 7
        when 'Hazelnut' then 8
        else 99
      end,
      item
  ) - 1 as sort_order
  from inventory
) ranked
where inventory.item = ranked.item
  and inventory.sort_order = 0;

insert into menu_drinks (id, label, description, temps, has_milk, has_syrups, show_temp, active, sort_order) values
('americano','Americano','No milk, water only',array['Hot','Cold'],false,true,true,true,0),
('latte','Latte','Standard milk and coffee drink',array['Hot','Cold'],true,true,true,true,1),
('cappuccino','Cappuccino','More milk foam',array['Hot','Cold'],true,true,true,true,2),
('cortado','Cortado','More coffee forward, less milk',array['Hot'],true,true,true,true,3),
('espresso','Double Shot Espresso','Pure espresso — no milk, water or syrup',array['Hot'],false,false,true,true,4),
('hotchoc','Hot Chocolate','Rich hot chocolate',array['Hot'],true,false,true,true,5),
('coldchoc','Cold Chocolate Milk','Chilled chocolate milk',array['Cold'],true,false,false,true,6)
on conflict (id) do nothing;

insert into settings (key, value) values
('pin','"8246"'),
('isOpen','"true"'),
('message','""')
on conflict (key) do nothing;

alter table orders enable row level security;
alter table inventory enable row level security;
alter table menu_drinks enable row level security;
alter table settings enable row level security;
alter table archived_orders enable row level security;

revoke all on orders from anon;
revoke all on inventory from anon;
revoke all on menu_drinks from anon;
revoke all on settings from anon;
revoke all on archived_orders from anon;
grant delete on archived_orders to anon;

drop function if exists arise_order(uuid);
drop function if exists arise_update_status(text, uuid, text);

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
    select item, type, available, active, sort_order
    from inventory
    where active = true
    order by
      case type when 'syrup' then 0 when 'milk' then 1 else 2 end,
      sort_order,
      item
  )
  select jsonb_build_object(
    'syrups', coalesce(
      jsonb_agg(jsonb_build_object('item', item, 'type', 'syrup', 'available', available, 'active', active, 'sortOrder', sort_order))
        filter (where type = 'syrup'),
      '[]'::jsonb
    ),
    'milks', coalesce(
      jsonb_agg(jsonb_build_object('item', item, 'type', 'milk', 'available', available, 'active', active, 'sortOrder', sort_order))
        filter (where type = 'milk'),
      '[]'::jsonb
    )
  )
  from sorted;
$$;

create or replace function arise_inventory_menu_json(input_include_inactive boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sorted as (
    select item, type, available, active, sort_order
    from inventory
    where input_include_inactive or active = true
    order by
      case type when 'syrup' then 0 when 'milk' then 1 else 2 end,
      sort_order,
      item
  )
  select jsonb_build_object(
    'syrups', coalesce(
      jsonb_agg(jsonb_build_object('id', lower(regexp_replace(item, '[^a-zA-Z0-9]+', '-', 'g')), 'item', item, 'type', 'syrup', 'available', available, 'active', active, 'sortOrder', sort_order))
        filter (where type = 'syrup'),
      '[]'::jsonb
    ),
    'milks', coalesce(
      jsonb_agg(jsonb_build_object('id', lower(regexp_replace(item, '[^a-zA-Z0-9]+', '-', 'g')), 'item', item, 'type', 'milk', 'available', available, 'active', active, 'sortOrder', sort_order))
        filter (where type = 'milk'),
      '[]'::jsonb
    )
  )
  from sorted;
$$;

create or replace function arise_menu_json(input_include_inactive boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'label', label,
        'desc', description,
        'temps', to_jsonb(temps),
        'milk', has_milk,
        'syrups', has_syrups,
        'showTemp', show_temp,
        'active', active,
        'sortOrder', sort_order
      )
      order by sort_order, label
    ),
    '[]'::jsonb
  )
  from menu_drinks
  where input_include_inactive or active = true;
$$;

create or replace function arise_menu(input_pin text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'drinks', arise_menu_json(arise_pin_matches(input_pin)),
    'milks', arise_inventory_menu_json(arise_pin_matches(input_pin))->'milks',
    'syrups', arise_inventory_menu_json(arise_pin_matches(input_pin))->'syrups'
  );
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
      'name', coalesce((input_order).customer_name, (input_order).name, ''),
      'drink', (input_order).drink,
      'temp', coalesce((input_order).temperature, (input_order).temp, ''),
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

create or replace function arise_order(order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found_order orders;
  found_position integer;
  found_id text;
begin
  select id::text, position::integer
  into found_id, found_position
  from (
    select
      id::text as id,
      row_number() over (order by created_at) as position
    from orders
    where status <> 'complete'
  ) active
  where id = order_id
  limit 1;

  if found_id is null then
    select id::text
    into found_id
    from orders
    where id::text = order_id
      and status = 'complete'
    limit 1;

    found_position := null;
  end if;

  if found_id is not null then
    select *
    into found_order
    from orders
    where id::text = found_id
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
  new_id text;
  order_state jsonb;
begin
  if arise_setting('isOpen', 'true') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'Queue closed');
  end if;

  insert into orders (name, customer_name, drink, temp, temperature, milk, syrups, notes, status)
  values (
    coalesce(input_order->>'name', ''),
    coalesce(input_order->>'name', ''),
    coalesce(input_order->>'drink', ''),
    coalesce(input_order->>'temp', ''),
    coalesce(input_order->>'temp', ''),
    coalesce(input_order->>'milk', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(input_order->'syrups', '[]'::jsonb))), '{}'::text[]),
    coalesce(input_order->>'notes', ''),
    'waiting'
  )
  returning id::text into new_id;

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
    values ('isOpen', to_jsonb(case when input_is_open then 'true' else 'false' end))
    on conflict (key) do update set value = excluded.value;
  end if;

  if input_message is not null then
    insert into settings (key, value)
    values ('message', to_jsonb(input_message))
    on conflict (key) do update set value = excluded.value;
  end if;

  return arise_orders();
end;
$$;

create or replace function arise_update_status(input_pin text, order_id text, input_status text)
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
  where id::text = order_id
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

drop function if exists arise_save_menu(text, jsonb);
drop function if exists arise_save_menu(text, jsonb, jsonb, jsonb);

create or replace function arise_save_menu(input_pin text, input_drinks jsonb, input_milks jsonb default '[]'::jsonb, input_syrups jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  drink_item jsonb;
  ingredient_item jsonb;
  cleaned_temps text[];
  drink_index integer := 0;
  ingredient_index integer := 0;
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  if jsonb_typeof(coalesce(input_drinks, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(input_milks, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(input_syrups, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Invalid menu');
  end if;

  delete from menu_drinks where true;

  for drink_item in
    select value
    from jsonb_array_elements(input_drinks)
  loop
    cleaned_temps := array(
      select temp_option
      from (values ('Hot', 1), ('Cold', 2)) as allowed(temp_option, sort_order)
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(drink_item->'temps', '["Hot"]'::jsonb)) as temp_value
        where temp_value = allowed.temp_option
      )
      order by sort_order
    );

    if array_length(cleaned_temps, 1) is null then
      cleaned_temps := array['Hot'];
    end if;

    insert into menu_drinks (
      id,
      label,
      description,
      temps,
      has_milk,
      has_syrups,
      show_temp,
      active,
      sort_order
    ) values (
      left(coalesce(nullif(trim(drink_item->>'id'), ''), 'drink-' || drink_index::text), 80),
      left(coalesce(nullif(trim(drink_item->>'label'), ''), 'Drink'), 80),
      left(coalesce(drink_item->>'desc', ''), 180),
      cleaned_temps,
      coalesce((drink_item->>'milk')::boolean, true),
      coalesce((drink_item->>'syrups')::boolean, true),
      coalesce((drink_item->>'showTemp')::boolean, true),
      coalesce((drink_item->>'active')::boolean, true),
      drink_index
    )
    on conflict (id) do update set
      label = excluded.label,
      description = excluded.description,
      temps = excluded.temps,
      has_milk = excluded.has_milk,
      has_syrups = excluded.has_syrups,
      show_temp = excluded.show_temp,
      active = excluded.active,
      sort_order = excluded.sort_order,
      updated_at = now();

    drink_index := drink_index + 1;
  end loop;

  delete from inventory where true;

  ingredient_index := 0;
  for ingredient_item in
    select value
    from jsonb_array_elements(input_milks)
  loop
    insert into inventory (item, type, available, active, sort_order)
    values (
      left(coalesce(nullif(trim(ingredient_item->>'item'), ''), 'Milk'), 80),
      'milk',
      coalesce((ingredient_item->>'available')::boolean, true),
      coalesce((ingredient_item->>'active')::boolean, true),
      ingredient_index
    );

    ingredient_index := ingredient_index + 1;
  end loop;

  ingredient_index := 0;
  for ingredient_item in
    select value
    from jsonb_array_elements(input_syrups)
  loop
    insert into inventory (item, type, available, active, sort_order)
    values (
      left(coalesce(nullif(trim(ingredient_item->>'item'), ''), 'Syrup'), 80),
      'syrup',
      coalesce((ingredient_item->>'available')::boolean, true),
      coalesce((ingredient_item->>'active')::boolean, true),
      ingredient_index
    );

    ingredient_index := ingredient_index + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'drinks', arise_menu_json(true),
    'milks', arise_inventory_menu_json(true)->'milks',
    'syrups', arise_inventory_menu_json(true)->'syrups',
    'inventory', arise_inventory_json()
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', SQLERRM);
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

  insert into archived_orders (
    original_order_id,
    original_order_id_text,
    original_created_at,
    customer_name,
    drink,
    temperature,
    milk,
    syrups,
    notes,
    status,
    order_data
  )
  select
    id,
    id::text,
    created_at,
    coalesce(customer_name, name, ''),
    drink,
    coalesce(temperature, temp, ''),
    milk,
    array_to_string(coalesce(syrups, '{}'::text[]), ', '),
    notes,
    status,
    to_jsonb(orders)
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

  insert into archived_orders (
    original_order_id,
    original_order_id_text,
    original_created_at,
    customer_name,
    drink,
    temperature,
    milk,
    syrups,
    notes,
    status,
    order_data
  )
  select
    id,
    id::text,
    created_at,
    coalesce(customer_name, name, ''),
    drink,
    coalesce(temperature, temp, ''),
    milk,
    array_to_string(coalesce(syrups, '{}'::text[]), ', '),
    notes,
    status,
    to_jsonb(orders)
  from orders;

  delete from orders where true;

  return arise_orders();
end;
$$;

create or replace function arise_archive(input_pin text, input_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not arise_pin_matches(input_pin) then jsonb_build_object('ok', false, 'error', 'Wrong PIN')
    else jsonb_build_object(
      'ok', true,
      'archive', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'archivedAt', archived_at,
              'originalOrderId', coalesce(original_order_id_text, original_order_id::text),
              'time', original_created_at,
              'name', coalesce(customer_name, ''),
              'drink', coalesce(drink, ''),
              'temp', coalesce(temperature, ''),
              'milk', coalesce(milk, ''),
              'syrups', coalesce(syrups, ''),
              'notes', coalesce(notes, ''),
              'status', coalesce(status, '')
            )
            order by archived_at desc
          )
          from (
            select *
            from archived_orders
            order by archived_at desc
            limit greatest(1, least(coalesce(input_limit, 25), 50))
          ) recent_archive
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

create or replace function arise_clear_archive(input_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  delete from archived_orders
  where true;

  return jsonb_build_object('ok', true, 'archive', '[]'::jsonb);
end;
$$;

create or replace function arise_analytics(input_pin text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      nullif(trim(coalesce(drink, '')), '') as drink,
      nullif(trim(coalesce(temperature, '')), '') as temperature,
      nullif(trim(coalesce(milk, '')), '') as milk,
      nullif(trim(coalesce(syrups, '')), '') as syrups
    from archived_orders
  ),
  syrup_items as (
    select nullif(trim(syrup_value), '') as syrup
    from base
    cross join lateral regexp_split_to_table(coalesce(base.syrups, ''), '\s*,\s*') as syrup_value
  )
  select case
    when not arise_pin_matches(input_pin) then jsonb_build_object('ok', false, 'error', 'Wrong PIN')
    else jsonb_build_object(
      'ok', true,
      'analytics', jsonb_build_object(
        'totalOrders', (select count(*) from archived_orders),
        'hotOrders', (select count(*) from base where lower(temperature) = 'hot'),
        'coldOrders', (select count(*) from base where lower(temperature) = 'cold'),
        'topDrinks', coalesce(
          (
            select jsonb_agg(jsonb_build_object('item', drink, 'count', count) order by count desc, drink)
            from (
              select drink, count(*) as count
              from base
              where drink is not null
              group by drink
              order by count desc, drink
              limit 5
            ) ranked_drinks
          ),
          '[]'::jsonb
        ),
        'topMilks', coalesce(
          (
            select jsonb_agg(jsonb_build_object('item', milk, 'count', count) order by count desc, milk)
            from (
              select milk, count(*) as count
              from base
              where milk is not null
              group by milk
              order by count desc, milk
              limit 5
            ) ranked_milks
          ),
          '[]'::jsonb
        ),
        'topSyrups', coalesce(
          (
            select jsonb_agg(jsonb_build_object('item', syrup, 'count', count) order by count desc, syrup)
            from (
              select syrup, count(*) as count
              from syrup_items
              where syrup is not null
              group by syrup
              order by count desc, syrup
              limit 5
            ) ranked_syrups
          ),
          '[]'::jsonb
        )
      )
    )
  end;
$$;

grant execute on function arise_status() to anon;
grant execute on function arise_inventory() to anon;
grant execute on function arise_menu(text) to anon;
grant execute on function arise_login(text) to anon;
grant execute on function arise_orders() to anon;
grant execute on function arise_order(text) to anon;
grant execute on function arise_place_order(jsonb) to anon;
grant execute on function arise_update_admin(text, boolean, text) to anon;
grant execute on function arise_update_status(text, text, text) to anon;
grant execute on function arise_update_inventory(text, text, boolean) to anon;
grant execute on function arise_save_menu(text, jsonb, jsonb, jsonb) to anon;
grant execute on function arise_clear_completed(text) to anon;
grant execute on function arise_clear_all(text) to anon;
grant execute on function arise_archive(text, integer) to anon;
grant execute on function arise_clear_archive(text) to anon;
grant execute on function arise_analytics(text) to anon;

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  customer_name text,
  order_name text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);

alter table push_subscriptions enable row level security;

drop policy if exists "Customers can create push subscriptions" on push_subscriptions;
create policy "Customers can create push subscriptions"
on push_subscriptions
for insert
to anon
with check (
  order_id <> ''
  and endpoint <> ''
  and p256dh <> ''
  and auth <> ''
);

drop policy if exists "Customers can update their push endpoint" on push_subscriptions;
create policy "Customers can update their push endpoint"
on push_subscriptions
for update
to anon
using (true)
with check (
  order_id <> ''
  and endpoint <> ''
  and p256dh <> ''
  and auth <> ''
);

drop function if exists delete_expired_push_subscription(text);
create or replace function delete_expired_push_subscription(input_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions
  where endpoint = input_endpoint;
$$;

grant execute on function delete_expired_push_subscription(text) to service_role;
