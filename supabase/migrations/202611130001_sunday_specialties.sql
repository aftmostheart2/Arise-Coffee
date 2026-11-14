begin;

-- Specialty recipes and rotation are managed separately from the regular menu.
create table if not exists menu_specialties (
  id text primary key,
  label text not null check (char_length(label) between 1 and 80),
  description text not null default '' check (char_length(description) <= 180),
  regular_recipe text not null default '' check (char_length(regular_recipe) <= 1000),
  sugar_free_recipe text not null default '' check (char_length(sugar_free_recipe) <= 1000),
  temps text[] not null default array['Hot','Cold'],
  active boolean not null default false,
  sort_order integer not null default 0
);
create unique index if not exists menu_specialties_label on menu_specialties (lower(label));
create table if not exists specialty_rotation (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  starts_on date not null default (
    (now() at time zone 'America/Los_Angeles')::date -
    extract(dow from now() at time zone 'America/Los_Angeles')::integer
  ) check (extract(dow from starts_on) = 0)
);
insert into specialty_rotation (singleton) values (true) on conflict do nothing;
insert into menu_specialties (id, label, sort_order) select * from (values
  ('specialty-verena-vanilla', 'Verena Vanilla', 0),
  ('specialty-mount-caramel', 'Mount Caramel Latte', 1),
  ('specialty-archangel-mocha', 'Archangel Mocha', 2),
  ('specialty-bright-white-mocha', 'Bright White Mocha', 3),
  ('specialty-ton-cina-mon', 'Ton Cina-Mon', 4),
  ('specialty-st-bazel-nut', 'St. Bazel-Nut', 5)
) seed(id, label, sort_order)
where not exists (select 1 from settings where key = 'specialtyMenuSeeded')
on conflict do nothing;
insert into settings (key, value) values ('specialtyMenuSeeded', 'true') on conflict do nothing;
alter table menu_specialties enable row level security;
alter table specialty_rotation enable row level security;
revoke all on menu_specialties, specialty_rotation from public, anon, authenticated;
alter table orders add column if not exists specialty_id text;
alter table orders add column if not exists recipe text not null default '';
alter table orders add column if not exists sweetness text not null default '';

create or replace function arise_featured_specialty(input_at timestamptz default now())
returns menu_specialties language plpgsql stable security definer set search_path = public as $$
declare
  rotation specialty_rotation;
  featured menu_specialties;
  local_day date := (input_at at time zone 'America/Los_Angeles')::date;
  total integer;
begin
  select * into rotation from specialty_rotation where singleton;
  if not rotation.enabled or local_day < rotation.starts_on then return null; end if;
  select count(*) into total from menu_specialties where active and btrim(regular_recipe) <> '';
  if total = 0 then return null; end if;
  select * into featured from menu_specialties where active and btrim(regular_recipe) <> ''
    order by sort_order, id limit 1 offset (((local_day - rotation.starts_on) / 7) % total);
  return featured;
end;
$$;

create or replace function arise_specialty_json(input_specialty menu_specialties)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when input_specialty is null then null else jsonb_build_object(
    'id', (input_specialty).id, 'label', (input_specialty).label,
    'desc', (input_specialty).description, 'temps', (input_specialty).temps,
    'isSpecialty', true, 'milk', true, 'syrups', false, 'showTemp', true,
    'active', true, 'regularAvailable', btrim((input_specialty).regular_recipe) <> '',
    'sugarFreeAvailable', btrim((input_specialty).sugar_free_recipe) <> ''
  ) end;
$$;

create or replace function arise_specialties_admin(input_pin text, input_specialties jsonb default null,
  input_enabled boolean default null, input_starts_on date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  item_index integer := 0;
  clean_temps text[];
begin
  if not arise_pin_matches(input_pin) then return jsonb_build_object('ok', false, 'error', 'Wrong PIN'); end if;
  if input_specialties is not null then
    if jsonb_typeof(input_specialties) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'Invalid specialties list.');
    end if;
    if jsonb_array_length(input_specialties) > 100 or input_enabled is null or input_starts_on is null
      or extract(dow from input_starts_on) <> 0 then
      return jsonb_build_object('ok', false, 'error', 'Choose a Sunday start date and up to 100 specialties.');
    end if;
    for item in select value from jsonb_array_elements(input_specialties) loop
      if coalesce(item->>'id', '') !~ '^specialty-[a-zA-Z0-9-]+$'
        or char_length(btrim(coalesce(item->>'label', ''))) not between 1 and 80
        or char_length(coalesce(item->>'desc', '')) > 180
        or char_length(coalesce(item->>'regularRecipe', '')) > 1000
        or char_length(coalesce(item->>'sugarFreeRecipe', '')) > 1000
        or jsonb_typeof(item->'active') is distinct from 'boolean'
        or jsonb_typeof(item->'temps') is distinct from 'array' then
        return jsonb_build_object('ok', false, 'error', 'Each specialty needs a name, temperatures, and valid recipe fields.');
      end if;
      if (item->>'active')::boolean and btrim(coalesce(item->>'regularRecipe', '')) = '' then
        return jsonb_build_object('ok', false, 'error', 'Add a regular recipe before enabling a specialty.');
      end if;
      if not exists (select 1 from jsonb_array_elements_text(item->'temps') t where t in ('Hot', 'Cold')) then
        return jsonb_build_object('ok', false, 'error', 'Choose at least one temperature for each specialty.');
      end if;
    end loop;
    if input_enabled and not exists (select 1 from jsonb_array_elements(input_specialties) d where (d->>'active')::boolean) then
      return jsonb_build_object('ok', false, 'error', 'Enable at least one specialty before starting rotation.');
    end if;
    perform 1 from specialty_rotation where singleton for update;
    delete from menu_specialties;
    for item in select value from jsonb_array_elements(input_specialties) loop
      clean_temps := array(select t from jsonb_array_elements_text(item->'temps') t where t in ('Hot','Cold') group by t order by t desc);
      insert into menu_specialties (id, label, description, regular_recipe, sugar_free_recipe, temps, active, sort_order)
      values (item->>'id', btrim(item->>'label'), coalesce(item->>'desc', ''), btrim(coalesce(item->>'regularRecipe', '')),
        btrim(coalesce(item->>'sugarFreeRecipe', '')), clean_temps, (item->>'active')::boolean, item_index);
      item_index := item_index + 1;
    end loop;
    update specialty_rotation set enabled = input_enabled, starts_on = input_starts_on where singleton;
  end if;
  return jsonb_build_object('ok', true, 'enabled', (select enabled from specialty_rotation where singleton),
    'startsOn', (select starts_on from specialty_rotation where singleton),
    'featured', arise_specialty_json(arise_featured_specialty()),
    'specialties', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label,
      'desc', description, 'regularRecipe', regular_recipe, 'sugarFreeRecipe', sugar_free_recipe,
      'temps', temps, 'active', active) order by sort_order, id) from menu_specialties), '[]'::jsonb));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'Each specialty needs a unique name and ID.');
when invalid_text_representation then
  return jsonb_build_object('ok', false, 'error', 'Invalid specialty values.');
end;
$$;

create or replace function arise_apply_specialty_recipe()
returns trigger language plpgsql security definer set search_path = public as $$
declare featured menu_specialties;
begin
  if new.specialty_id is null then
    if exists (select 1 from menu_specialties where lower(btrim(label)) = lower(btrim(new.drink)))
      and not exists (select 1 from menu_drinks where lower(btrim(label)) = lower(btrim(new.drink))) then
      raise exception using errcode = '23514', message = 'Please select the specialty from the current menu.';
    end if;
    return new;
  end if;
  featured := arise_featured_specialty();
  if featured is null or featured.id <> new.specialty_id then
    raise exception using errcode = '23514', message = 'That specialty is no longer featured. Please refresh the menu.';
  end if;
  if coalesce(new.temperature, new.temp, '') <> all(featured.temps) then
    raise exception using errcode = '23514', message = 'Choose an available temperature.';
  end if;
  if not exists (select 1 from inventory where item = new.milk and type = 'milk' and active and available) then
    raise exception using errcode = '23514', message = 'Choose an available milk.';
  end if;
  if new.sweetness not in ('regular', 'sugar-free') or
    (new.sweetness = 'sugar-free' and btrim(featured.sugar_free_recipe) = '') then
    raise exception using errcode = '23514', message = 'Choose an available regular or sugar-free recipe.';
  end if;
  if cardinality(new.syrups) > 0 or btrim(coalesce(new.notes, '')) <> '' then
    raise exception using errcode = '23514', message = 'Specialty recipes are fixed. Only milk, sweetness, and temperature can change.';
  end if;
  new.drink := featured.label;
  new.recipe := case when new.sweetness = 'sugar-free' then featured.sugar_free_recipe else featured.regular_recipe end;
  return new;
end;
$$;
drop trigger if exists arise_specialty_recipe on orders;
create trigger arise_specialty_recipe before insert on orders for each row execute function arise_apply_specialty_recipe();
revoke all on function arise_featured_specialty(timestamptz) from public;
revoke all on function arise_specialty_json(menu_specialties) from public;
revoke all on function arise_apply_specialty_recipe() from public;
revoke all on function arise_specialties_admin(text, jsonb, boolean, date) from public;
grant execute on function arise_specialties_admin(text, jsonb, boolean, date) to anon;

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
    'specialty', arise_specialty_json(arise_featured_specialty()),
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
      'specialtyId', (input_order).specialty_id,
      'recipe', (input_order).recipe,
      'sweetness', (input_order).sweetness,
      'temp', coalesce((input_order).temperature, (input_order).temp, ''),
      'milk', coalesce((input_order).milk, ''),
      'syrups', array_to_string(coalesce((input_order).syrups, '{}'::text[]), ', '),
      'notes', coalesce((input_order).notes, ''),
      'status', coalesce((input_order).status, 'waiting'),
      'source', coalesce((input_order).source, ''),
      'priority', coalesce((input_order).priority, false),
      'fulfillmentType', coalesce((input_order).fulfillment_type, 'pickup'),
      'deliveryLocation', coalesce((input_order).delivery_location, ''),
      'pickedUpAt', (input_order).picked_up_at,
      'readyAt', (input_order).ready_at,
      'pendingArchive', ((input_order).status in ('ready', 'complete') and
        ((input_order).picked_up_at is not null or (input_order).ready_at <= now() - make_interval(mins => arise_setting('pickupArchiveMinutes', '30')::integer))),
      'position', input_position,
      'ordersAhead', case when input_position is null then null else greatest(0, input_position - 1) end
    )
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
  order_source text;
  customer_name_key text;
begin
  order_source := case when coalesce(input_order->>'source', '') = 'clergy' then 'clergy' else '' end;

  if not arise_can_place_order(order_source) then
    return jsonb_build_object('ok', false, 'error', 'Queue closed');
  end if;

  if order_source <> 'clergy' then
    customer_name_key := arise_customer_name_key(input_order->>'name');
    if customer_name_key = '' then
      return jsonb_build_object('ok', false, 'error', 'Please enter your name');
    end if;

    -- Serialize matching submissions so two devices cannot both pass the check.
    perform pg_advisory_xact_lock(72641, hashtext(customer_name_key));
    if arise_setting('pickupBlacklistEnabled', 'false') = 'true' and exists (
      select 1 from customer_pickup_strikes where name_key = customer_name_key and strikes >= 3
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'CUSTOMER_BLACKLISTED',
        'error', 'Ordering is blocked for this name after 3 missed drink pickups. Please speak with Arise staff to have the blacklist reviewed.'
      );
    end if;
    if exists (
      select 1 from orders
      where coalesce(source, '') <> 'clergy'
        and status not in ('complete', 'canceled')
        and arise_customer_name_key(coalesce(nullif(btrim(customer_name), ''), name)) = customer_name_key
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'ACTIVE_ORDER_EXISTS',
        'error', 'You already have an order in progress. Please wait until staff marks it done before placing another order.'
      );
    end if;
  end if;

  insert into orders (name, customer_name, drink, temp, temperature, milk, syrups, notes, status, source, priority, fulfillment_type, delivery_location, specialty_id, sweetness)
  values (
    coalesce(input_order->>'name', ''),
    coalesce(input_order->>'name', ''),
    coalesce(input_order->>'drink', ''),
    coalesce(input_order->>'temp', ''),
    coalesce(input_order->>'temp', ''),
    coalesce(input_order->>'milk', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(input_order->'syrups', '[]'::jsonb))), '{}'::text[]),
    coalesce(input_order->>'notes', ''),
    'waiting',
    order_source,
    order_source = 'clergy',
    case when coalesce(input_order->>'fulfillmentType', 'pickup') = 'delivery' then 'delivery' else 'pickup' end,
    case when coalesce(input_order->>'fulfillmentType', 'pickup') = 'delivery' then nullif(trim(coalesce(input_order->>'deliveryLocation', '')), '') else null end,
    nullif(input_order->>'specialtyId', ''),
    coalesce(input_order->>'sweetness', '')
  )
  returning id::text into new_id;

  order_state := arise_order(new_id);

  return jsonb_build_object(
    'ok', true,
    'id', new_id,
    'pickupToken', (select pickup_token::text from orders where id::text = new_id),
    'order', order_state->'order',
    'position', order_state->'position',
    'ordersAhead', order_state->'ordersAhead'
  );
exception when check_violation then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

commit;
