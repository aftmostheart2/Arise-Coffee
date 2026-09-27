-- Run in the Supabase SQL Editor before publishing the website.
-- Includes the previous duplicate-order rule; preserves existing orders and strikes.
BEGIN;

create or replace function arise_customer_name_key(input_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(part, ' ' order by part collate "C"), '')
  from regexp_split_to_table(lower(coalesce(input_name, '')), '[[:space:]]+') as words(part)
  where part <> '';
$$;

create table if not exists customer_pickup_strikes (
  name_key text primary key,
  customer_name text not null,
  strikes integer not null default 0 check (strikes between 0 and 3),
  updated_at timestamptz not null default now()
);

alter table customer_pickup_strikes enable row level security;
revoke all on customer_pickup_strikes from public, anon, authenticated;
insert into settings (key, value) values ('pickupBlacklistEnabled', '"false"')
on conflict (key) do nothing;

create or replace function arise_customer_strikes(input_pin text, input_action text default 'list', input_name text default '', input_enabled boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text;
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;

  if input_action = 'setEnabled' then
    if input_enabled is null then
      return jsonb_build_object('ok', false, 'error', 'Choose whether blacklisting is enabled');
    end if;
    insert into settings (key, value) values ('pickupBlacklistEnabled', to_jsonb(input_enabled)::text)
    on conflict (key) do update set value = excluded.value;
  elsif input_action in ('add', 'remove', 'reset') then
    normalized_name := arise_customer_name_key(input_name);
    if normalized_name = '' or position(' ' in normalized_name) = 0 then
      return jsonb_build_object('ok', false, 'error', 'Please enter first and last name');
    end if;
    -- Use the same lock as ordering so strikes and new orders are checked in sequence.
    perform pg_advisory_xact_lock(72641, hashtext(normalized_name));
    if input_action = 'add' then
      insert into customer_pickup_strikes (name_key, customer_name, strikes)
      values (normalized_name, regexp_replace(btrim(input_name), '[[:space:]]+', ' ', 'g'), 1)
      on conflict (name_key) do update
      set strikes = least(customer_pickup_strikes.strikes + 1, 3), updated_at = now();
    else
      update customer_pickup_strikes
      set strikes = case when input_action = 'reset' then 0 else greatest(strikes - 1, 0) end,
          updated_at = now()
      where name_key = normalized_name;
    end if;
  elsif input_action is distinct from 'list' then
    return jsonb_build_object('ok', false, 'error', 'Unknown strike action');
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', arise_setting('pickupBlacklistEnabled', 'false') = 'true',
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nameKey', name_key, 'name', customer_name, 'strikes', strikes,
        'blacklisted', strikes >= 3, 'updatedAt', updated_at
      ) order by strikes desc, lower(customer_name))
      from customer_pickup_strikes
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function arise_customer_strikes(text, text, text, boolean) from public;
grant execute on function arise_customer_strikes(text, text, text, boolean) to anon;

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

  insert into orders (name, customer_name, drink, temp, temperature, milk, syrups, notes, status, source, priority, fulfillment_type, delivery_location)
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
    case when coalesce(input_order->>'fulfillmentType', 'pickup') = 'delivery' then nullif(trim(coalesce(input_order->>'deliveryLocation', '')), '') else null end
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

COMMIT;
