-- Apply after the earlier strike/duplicate-order migrations.
-- Existing ready orders stay uncollected; only staff can confirm pre-update orders.
BEGIN;

alter table orders add column if not exists pickup_token uuid not null default gen_random_uuid();
alter table orders add column if not exists picked_up_at timestamptz;

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
      'source', coalesce((input_order).source, ''),
      'priority', coalesce((input_order).priority, false),
      'fulfillmentType', coalesce((input_order).fulfillment_type, 'pickup'),
      'deliveryLocation', coalesce((input_order).delivery_location, ''),
      'pickedUpAt', (input_order).picked_up_at,
      'position', input_position,
      'ordersAhead', case when input_position is null then null else greatest(0, input_position - 1) end
    )
  end;
$$;

create or replace function arise_display()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with queue as (
    select
      id::text as id,
      created_at,
      coalesce(customer_name, name, '') as name,
      drink,
      coalesce(temperature, temp, '') as temp,
      status,
      row_number() over (
        order by case when status = 'making' then 0 else 1 end, created_at
      ) as position
    from orders
    where status in ('waiting', 'making')
  ),
  ready as (
    select
      id::text as id,
      created_at,
      coalesce(customer_name, name, '') as name,
      drink,
      coalesce(temperature, temp, '') as temp,
      status
    from orders
    where status in ('ready', 'complete')
      and picked_up_at is null
      and coalesce(fulfillment_type, 'pickup') <> 'delivery'
    order by created_at desc
  )
  select jsonb_build_object(
    'ok', true,
    'isOpen', arise_queue_is_open(),
    'message', arise_setting('message', ''),
    'queueTimerMinutes', coalesce(nullif(arise_setting('queueTimerMinutes', '30'), '')::integer, 30),
    'queueTimerEnabled', arise_setting('queueTimerEnabled', 'true') = 'true',
    'clergyOrderingEnabled', arise_setting('clergyOrderingEnabled', 'false') = 'true',
    'deliveryEnabled', arise_setting('deliveryEnabled', 'true') = 'true',
    'queueClosesAt', arise_setting('queueClosesAt', ''),
    'orders', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'drink', drink,
            'temp', temp,
            'status', status,
            'position', position
          )
          order by position
        )
        from queue
      ),
      '[]'::jsonb
    ),
    'ready', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'drink', drink,
            'temp', temp,
            'status', status
          )
          order by created_at desc
        )
        from ready
      ),
      '[]'::jsonb
    )
  );
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
    'pickupToken', (select pickup_token::text from orders where id::text = new_id),
    'position', order_state->'position',
    'ordersAhead', order_state->'ordersAhead'
  );
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
  set status = input_status,
      picked_up_at = case when input_status in ('waiting', 'making') then null else picked_up_at end
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

create or replace function arise_pickup_admin(input_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  return jsonb_build_object(
    'ok', true,
    'ready', coalesce((select jsonb_agg(arise_order_json(o, null) order by o.created_at)
      from orders o where status in ('ready', 'complete') and picked_up_at is null), '[]'::jsonb),
    'collected', coalesce((select jsonb_agg(arise_order_json(o, null) order by o.picked_up_at desc)
      from (select * from orders where picked_up_at is not null order by picked_up_at desc limit 20) o), '[]'::jsonb)
  );
end;
$$;

create or replace function arise_confirm_pickup(order_id text, input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_order orders;
begin
  update orders
  set picked_up_at = coalesce(picked_up_at, now())
  where id::text = order_id
    and pickup_token::text = input_token
    and status in ('ready', 'complete')
  returning * into updated_order;
  if updated_order is null then
    return jsonb_build_object('ok', false, 'error', 'Could not confirm pickup. Please refresh your order or ask Arise staff.');
  end if;
  return jsonb_build_object('ok', true, 'order', arise_order_json(updated_order, null));
end;
$$;

create or replace function arise_update_pickup(input_pin text, order_id text, input_picked_up boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_order orders;
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  if input_picked_up is null then
    return jsonb_build_object('ok', false, 'error', 'Choose a pickup status');
  end if;
  update orders
  set picked_up_at = case when input_picked_up then coalesce(picked_up_at, now()) else null end
  where id::text = order_id and status in ('ready', 'complete')
  returning * into updated_order;
  if updated_order is null then
    return jsonb_build_object('ok', false, 'error', 'Order is no longer ready or has been archived. Refresh the pickup list.');
  end if;
  return arise_pickup_admin(input_pin);
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

  with collected as (
    delete from orders
    where status in ('ready', 'complete') and picked_up_at is not null
    returning *
  )
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
    to_jsonb(collected) - 'pickup_token'
  from collected;

  return arise_orders();
end;
$$;

revoke all on function arise_pickup_admin(text) from public;
revoke all on function arise_confirm_pickup(text, text) from public;
revoke all on function arise_update_pickup(text, text, boolean) from public;
grant execute on function arise_pickup_admin(text) to anon;
grant execute on function arise_confirm_pickup(text, text) to anon;
grant execute on function arise_update_pickup(text, text, boolean) to anon;
COMMIT;
