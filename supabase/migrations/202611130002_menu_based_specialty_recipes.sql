begin;

alter table menu_specialties add column if not exists recipe_config jsonb;

create or replace function arise_specialty_recipe_text(input_config jsonb, input_sugar_free boolean default false)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  base_label text;
  ingredients jsonb;
  syrup text;
  selected_syrups text[] := '{}';
begin
  if jsonb_typeof(input_config) is distinct from 'object'
    or jsonb_typeof(input_config->'baseDrinkId') is distinct from 'string'
    or jsonb_typeof(input_config->'regularSyrups') is distinct from 'array'
    or jsonb_typeof(input_config->'sugarFreeSyrups') is distinct from 'array'
    or jsonb_typeof(input_config->'sugarFreeEnabled') is distinct from 'boolean' then
    raise exception using errcode = '23514', message = 'Choose a base drink and valid syrup options.';
  end if;
  if input_config->>'baseDrinkId' = '' then return ''; end if;
  select label into base_label from menu_drinks where id = input_config->>'baseDrinkId' and active;
  if base_label is null then
    raise exception using errcode = '23514', message = 'The base drink is not on the saved menu. Save the regular menu first or choose another drink.';
  end if;
  if input_sugar_free and not (input_config->>'sugarFreeEnabled')::boolean then return ''; end if;
  ingredients := input_config->(case when input_sugar_free then 'sugarFreeSyrups' else 'regularSyrups' end);
  if jsonb_array_length(ingredients) > 10 then
    raise exception using errcode = '23514', message = 'Choose no more than 10 syrups for a specialty.';
  end if;
  for syrup in select jsonb_array_elements_text(ingredients) loop
    if not exists (select 1 from inventory where item = syrup and type = 'syrup' and active) then
      raise exception using errcode = '23514', message = 'A selected syrup is not on the saved menu. Save the regular menu first or choose another syrup.';
    end if;
    if not syrup = any(selected_syrups) then selected_syrups := array_append(selected_syrups, syrup); end if;
  end loop;
  return base_label || case when cardinality(selected_syrups) = 0 then ' (no syrup)'
    else ': ' || array_to_string(selected_syrups, ' + ') end;
end;
$$;

create or replace function arise_specialty_recipe_available(input_specialty menu_specialties, input_sugar_free boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when input_specialty is null then false
    when (input_specialty).recipe_config is null then btrim(case when input_sugar_free then
      (input_specialty).sugar_free_recipe else (input_specialty).regular_recipe end) <> ''
    else
      exists (select 1 from menu_drinks where id = (input_specialty).recipe_config->>'baseDrinkId' and active)
      and (not input_sugar_free or ((input_specialty).recipe_config->>'sugarFreeEnabled')::boolean)
      and not exists (
        select 1 from jsonb_array_elements_text((input_specialty).recipe_config->(
          case when input_sugar_free then 'sugarFreeSyrups' else 'regularSyrups' end)) as syrup
        where not exists (select 1 from inventory where item = syrup and type = 'syrup' and active and available)
      )
  end;
$$;

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
  if not arise_specialty_recipe_available(featured) then return null; end if;
  return featured;
end;
$$;

create or replace function arise_specialty_json(input_specialty menu_specialties)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when input_specialty is null then null else jsonb_build_object(
    'id', (input_specialty).id, 'label', (input_specialty).label,
    'desc', (input_specialty).description, 'temps', (input_specialty).temps,
    'isSpecialty', true, 'milk', true, 'syrups', false, 'showTemp', true,
    'active', true, 'regularAvailable', arise_specialty_recipe_available(input_specialty),
    'sugarFreeAvailable', arise_specialty_recipe_available(input_specialty, true)
  ) end;
$$;

create or replace function arise_specialties_admin(input_pin text, input_specialties jsonb default null,
  input_enabled boolean default null, input_starts_on date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  item_index integer := 0;
  clean_temps text[];
  normalized_items jsonb := '[]'::jsonb;
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
      if item->'recipeConfig' is not null and item->'recipeConfig' <> 'null'::jsonb then
        item := jsonb_set(item, '{regularRecipe}', to_jsonb(arise_specialty_recipe_text(item->'recipeConfig')));
        item := jsonb_set(item, '{sugarFreeRecipe}', to_jsonb(arise_specialty_recipe_text(item->'recipeConfig', true)));
      end if;
      if (item->>'active')::boolean and btrim(coalesce(item->>'regularRecipe', '')) = '' then
        return jsonb_build_object('ok', false, 'error', 'Add a regular recipe before enabling a specialty.');
      end if;
      if not exists (select 1 from jsonb_array_elements_text(item->'temps') t where t in ('Hot', 'Cold')) then
        return jsonb_build_object('ok', false, 'error', 'Choose at least one temperature for each specialty.');
      end if;
      normalized_items := normalized_items || jsonb_build_array(item);
    end loop;
    input_specialties := normalized_items;
    if input_enabled and not exists (select 1 from jsonb_array_elements(input_specialties) d where (d->>'active')::boolean) then
      return jsonb_build_object('ok', false, 'error', 'Enable at least one specialty before starting rotation.');
    end if;
    perform 1 from specialty_rotation where singleton for update;
    delete from menu_specialties;
    for item in select value from jsonb_array_elements(input_specialties) loop
      clean_temps := array(select t from jsonb_array_elements_text(item->'temps') t where t in ('Hot','Cold') group by t order by t desc);
      insert into menu_specialties (id, label, description, regular_recipe, sugar_free_recipe, temps, active, sort_order, recipe_config)
      values (item->>'id', btrim(item->>'label'), coalesce(item->>'desc', ''), btrim(coalesce(item->>'regularRecipe', '')),
        btrim(coalesce(item->>'sugarFreeRecipe', '')), clean_temps, (item->>'active')::boolean, item_index,
        nullif(item->'recipeConfig', 'null'::jsonb));
      item_index := item_index + 1;
    end loop;
    update specialty_rotation set enabled = input_enabled, starts_on = input_starts_on where singleton;
  end if;
  return jsonb_build_object('ok', true, 'enabled', (select enabled from specialty_rotation where singleton),
    'startsOn', (select starts_on from specialty_rotation where singleton),
    'featured', arise_specialty_json(arise_featured_specialty()),
    'specialties', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label,
      'desc', description, 'regularRecipe', regular_recipe, 'sugarFreeRecipe', sugar_free_recipe,
      'temps', temps, 'active', active, 'recipeConfig', recipe_config) order by sort_order, id) from menu_specialties), '[]'::jsonb));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'Each specialty needs a unique name and ID.');
when invalid_text_representation then
  return jsonb_build_object('ok', false, 'error', 'Invalid specialty values.');
when check_violation then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
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
    (new.sweetness = 'sugar-free' and not arise_specialty_recipe_available(featured, true)) then
    raise exception using errcode = '23514', message = 'Choose an available regular or sugar-free recipe.';
  end if;
  if cardinality(new.syrups) > 0 or btrim(coalesce(new.notes, '')) <> '' then
    raise exception using errcode = '23514', message = 'Specialty recipes are fixed. Only milk, sweetness, and temperature can change.';
  end if;
  new.drink := featured.label;
  new.recipe := case when featured.recipe_config is not null then
    arise_specialty_recipe_text(featured.recipe_config, new.sweetness = 'sugar-free')
    when new.sweetness = 'sugar-free' then featured.sugar_free_recipe else featured.regular_recipe end;
  return new;
end;
$$;

revoke all on function arise_specialty_recipe_text(jsonb, boolean) from public;
revoke all on function arise_specialty_recipe_available(menu_specialties, boolean) from public;
commit;
