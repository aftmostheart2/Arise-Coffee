begin;

-- Order reviews remain available after orders are moved to the archive.
create table if not exists order_review_access (
  order_id uuid primary key,
  review_token uuid not null,
  customer_name text not null,
  drink text not null,
  source text not null default '',
  can_review boolean not null default false
);
create table if not exists order_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references order_review_access(order_id),
  rating integer not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
alter table order_review_access enable row level security;
alter table order_reviews enable row level security;
revoke all on order_review_access, order_reviews from public, anon, authenticated;

create or replace function arise_track_review_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into order_review_access (order_id, review_token, customer_name, drink, source, can_review)
  values (new.id, new.pickup_token, coalesce(new.customer_name, new.name, ''), new.drink,
    coalesce(new.source, ''), new.status in ('ready', 'complete'))
  on conflict (order_id) do update set
    review_token = excluded.review_token, customer_name = excluded.customer_name,
    drink = excluded.drink, source = excluded.source, can_review = excluded.can_review;
  return new;
end;
$$;
drop trigger if exists arise_review_access on orders;
create trigger arise_review_access after insert or update on orders
for each row execute function arise_track_review_access();
insert into order_review_access (order_id, review_token, customer_name, drink, source, can_review)
select id, pickup_token, coalesce(customer_name, name, ''), drink, coalesce(source, ''),
  status in ('ready', 'complete') from orders
on conflict (order_id) do nothing;

create or replace function arise_order_review(order_id text, input_token text,
  input_rating integer default null, input_comment text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  access_row order_review_access;
  review_row order_reviews;
begin
  select * into access_row from order_review_access a
  where a.order_id::text = arise_order_review.order_id and a.review_token::text = input_token;
  if access_row is null then
    return jsonb_build_object('ok', false, 'error', 'This review link is unavailable. Please use the device you ordered from.');
  end if;
  if input_rating is not null then
    if not access_row.can_review then
      return jsonb_build_object('ok', false, 'error', 'You can review your drink once it is ready.');
    end if;
    if input_rating not between 1 and 5 or char_length(coalesce(input_comment, '')) > 1000 then
      return jsonb_build_object('ok', false, 'error', 'Choose 1 to 5 stars and keep your comment under 1,000 characters.');
    end if;
    insert into order_reviews (order_id, rating, comment)
    values (access_row.order_id, input_rating, btrim(coalesce(input_comment, '')))
    on conflict on constraint order_reviews_order_id_key do nothing;
  end if;
  select * into review_row from order_reviews r where r.order_id = access_row.order_id;
  return jsonb_build_object('ok', true, 'eligible', access_row.can_review,
    'review', case when review_row is null then null else
      jsonb_build_object('rating', review_row.rating, 'comment', review_row.comment, 'createdAt', review_row.created_at) end);
end;
$$;

create or replace function arise_reviews_admin(input_pin text, input_page integer default 0,
  input_rating integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  page_number integer := greatest(0, least(coalesce(input_page, 0), 1000000));
begin
  if not arise_pin_matches(input_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  if input_rating is not null and input_rating not between 1 and 5 then
    return jsonb_build_object('ok', false, 'error', 'Choose a rating from 1 to 5.');
  end if;
  return jsonb_build_object('ok', true, 'page', page_number, 'pageSize', 25,
    'totalReviews', (select count(*) from order_reviews),
    'averageRating', (select round(avg(rating), 1) from order_reviews),
    'filteredTotal', (select count(*) from order_reviews where input_rating is null or rating = input_rating),
    'ratingCounts', (select jsonb_object_agg(star, (select count(*) from order_reviews where rating = star)) from generate_series(1, 5) star),
    'reviews', coalesce((select jsonb_agg(item order by created_at desc, id desc) from (
      select r.created_at, r.id, jsonb_build_object('id', r.id, 'rating', r.rating,
        'comment', r.comment, 'createdAt', r.created_at, 'name', a.customer_name,
        'drink', a.drink, 'source', a.source) as item
      from order_reviews r join order_review_access a on a.order_id = r.order_id
      where input_rating is null or r.rating = input_rating
      order by r.created_at desc, r.id desc limit 25 offset page_number * 25
    ) items), '[]'::jsonb));
end;
$$;
revoke all on function arise_track_review_access() from public;
revoke all on function arise_order_review(text, text, integer, text) from public;
revoke all on function arise_reviews_admin(text, integer, integer) from public;
grant execute on function arise_order_review(text, text, integer, text) to anon;
grant execute on function arise_reviews_admin(text, integer, integer) to anon;

commit;
