-- Run once in the Supabase SQL Editor before publishing the frontend.
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
