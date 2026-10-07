begin;

create or replace function arise_pickup_options()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'showReady', arise_setting('pickupShowReady', 'true') = 'true',
    'archiveMinutes', arise_setting('pickupArchiveMinutes', '30')::integer,
    'adminPickup', arise_setting('pickupAdminEnabled', 'true') = 'true'
  );
$$;

create or replace function arise_pickup_settings(input_pin text, input_options jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  if input_options is not null then
    if jsonb_typeof(input_options->'showReady') is distinct from 'boolean'
      or jsonb_typeof(input_options->'adminPickup') is distinct from 'boolean'
      or jsonb_typeof(input_options->'archiveMinutes') is distinct from 'number'
      or (input_options->>'archiveMinutes')::numeric <> trunc((input_options->>'archiveMinutes')::numeric)
      or (input_options->>'archiveMinutes')::numeric not between 1 and 240 then
      return jsonb_build_object('ok', false, 'error', 'Choose a whole number from 1 to 240 minutes and valid pickup options.');
    end if;
    insert into settings (key, value) values
      ('pickupShowReady', (input_options->'showReady')::text),
      ('pickupArchiveMinutes', (input_options->'archiveMinutes')::text),
      ('pickupAdminEnabled', (input_options->'adminPickup')::text)
    on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object('ok', true, 'pickupOptions', arise_pickup_options());
end;
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
      and ready_at > now() - make_interval(mins => arise_setting('pickupArchiveMinutes', '30')::integer)
      and coalesce(fulfillment_type, 'pickup') <> 'delivery'
    order by created_at desc
  )
  select jsonb_build_object(
    'ok', true,
    'pickupOptions', arise_pickup_options(),
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
    'pickupOptions', arise_pickup_options(),
    'ready', coalesce((select jsonb_agg(arise_order_json(o, null) order by o.created_at)
      from orders o where status in ('ready', 'complete') and picked_up_at is null
        and ready_at > now() - make_interval(mins => arise_setting('pickupArchiveMinutes', '30')::integer)), '[]'::jsonb),
    'collected', coalesce((select jsonb_agg(arise_order_json(o, null) order by o.picked_up_at desc)
      from (select * from orders where status in ('ready', 'complete') and
        (picked_up_at is not null or ready_at <= now() - make_interval(mins => arise_setting('pickupArchiveMinutes', '30')::integer))) o), '[]'::jsonb)
  );
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
  if input_picked_up and arise_setting('pickupAdminEnabled', 'true') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'Admin pickup confirmation is disabled in Settings.');
  end if;
  update orders
  set picked_up_at = case when input_picked_up then coalesce(picked_up_at, now()) else null end,
      ready_at = case when input_picked_up then ready_at else now() end
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
    where status in ('ready', 'complete') and
      (picked_up_at is not null or ready_at <= now() - make_interval(mins => arise_setting('pickupArchiveMinutes', '30')::integer))
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

revoke all on function arise_pickup_settings(text, jsonb) from public;
grant execute on function arise_pickup_settings(text, jsonb) to anon;
commit;
