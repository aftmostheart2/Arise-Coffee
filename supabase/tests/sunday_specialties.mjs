import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
let guest = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
async function rpc(name, args = []) {
  return (await db.query(`select ${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) as result`, args)).rows[0].result;
}
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const list = () => rpc("arise_specialties_admin", ["test-pin"]);
const save = (items, enabled = true, startsOn = sunday) => rpc("arise_specialties_admin", ["test-pin", JSON.stringify(items), enabled, startsOn]);
const place = (patch = {}) => rpc("arise_place_order", [JSON.stringify({ name: `Specialty Guest${++guest}`, drink: "Client supplied name",
  specialtyId: specials[0].id, temp: "Hot", milk: "Whole milk", sweetness: "regular", ...patch })]);
async function featuredAt(at) {
  return (await db.query("select (arise_featured_specialty($1::timestamptz)).id as id", [at])).rows[0].id;
}
let sunday;
let specials;
try {
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const schema = read("../schema.sql");
  await db.exec(schema.slice(0, schema.indexOf("create extension if not exists pg_cron")));
  const migration = read("../migrations/202611130001_sunday_specialties.sql");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(read("../migrations/202611130002_menu_based_specialty_recipes.sql"));
  await db.exec(`update settings set value = '"test-pin"' where key = 'pin';
    update settings set value = '"true"' where key in ('isOpen', 'clergyOrderingEnabled');
    update settings set value = '"false"' where key = 'queueTimerEnabled';
    update inventory set available = true where item = 'Whole milk';`);
  sunday = (await db.query("select starts_on::text as date from specialty_rotation")).rows[0].date;
  const initial = await list();
  check(initial.specialties.length, 6, "Six poster names seeded once");
  check(initial.enabled, false, "No unconfigured recipes offered");
  check((await rpc("arise_menu")).specialty, null, "No customer specialty while paused");
  check((await rpc("arise_specialties_admin", ["wrong"])).ok, false, "Admin PIN required");
  const drafts = initial.specialties;
  specials = drafts.slice(0, 2).map((item, index) => ({ ...item, active: true,
    regularRecipe: `Double shot; ${index + 2} pumps of regular syrup`,
    sugarFreeRecipe: index === 0 ? "Double shot; 2 pumps of sugar-free syrup" : "" }));
  check((await save([{ ...specials[0], regularRecipe: "" }])).ok, false, "Active recipe cannot be empty");
  check((await save(specials, true, "2026-11-16")).ok, false, "Start date must be Sunday");
  check((await save([], true)).ok, false, "Cannot enable empty rotation");
  check((await save([{ ...specials[0], temps: [] }])).ok, false, "Temperature required");
  check((await save([{ ...specials[0], regularRecipe: "x".repeat(1001) }])).ok, false, "Recipe length enforced");
  check((await save([specials[0], { ...specials[1], label: specials[0].label }])).ok, false, "Duplicate labels rejected atomically");
  check((await list()).specialties.length, 6, "Rejected save retains existing menu");
  await save(specials, true, "2026-11-15");
  check(await featuredAt("2026-11-15T07:59:59Z"), null, "No feature before start Sunday in LA");
  check(await featuredAt("2026-11-15T08:00:00Z"), specials[0].id, "First Sunday at local midnight");
  check(await featuredAt("2026-11-22T07:59:59Z"), specials[0].id, "Current week retained until Sunday midnight");
  check(await featuredAt("2026-11-22T08:00:00Z"), specials[1].id, "Second Sunday advances");
  check(await featuredAt("2026-11-29T08:00:00Z"), specials[0].id, "Rotation wraps");
  await save(specials, true, "2026-03-01");
  check(await featuredAt("2026-03-15T06:59:59Z"), specials[1].id, "DST week ends at correct local time");
  check(await featuredAt("2026-03-15T07:00:00Z"), specials[0].id, "DST Sunday rotates at local midnight");
  await save(specials);
  const menu = (await rpc("arise_menu")).specialty;
  check(menu.label, specials[0].label, "Featured specialty exposed on menu");
  check(menu.sugarFreeAvailable, true, "Sugar-free available only with recipe");
  check(menu.syrups, false, "Custom syrup controls disabled");
  check(menu.regularRecipe, undefined, "Barista instructions kept out of menu response");
  const regularMenu = await rpc("arise_menu", ["test-pin"]);
  await rpc("arise_save_menu", ["test-pin", JSON.stringify(regularMenu.drinks), JSON.stringify(regularMenu.milks), JSON.stringify(regularMenu.syrups)]);
  check((await list()).specialties.length, 2, "Regular menu save leaves specialties intact");
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from menu_specialties"), /permission denied/); checks++;
  await assert.rejects(db.query("select * from specialty_rotation"), /permission denied/); checks++;
  await assert.rejects(db.query("select arise_featured_specialty()"), /permission denied/); checks++;
  check((await place({ specialtyId: specials[1].id })).ok, false, "Out-of-rotation specialty rejected");
  check((await place({ syrups: ["Mocha"] })).ok, false, "Customer cannot add syrup");
  check((await place({ notes: "Change the recipe" })).ok, false, "Customer cannot override recipe in notes");
  check((await place({ sweetness: "other" })).ok, false, "Unknown sweetness rejected");
  check((await place({ temp: "Warm" })).ok, false, "Unknown temperature rejected");
  check((await place({ milk: "Imaginary milk" })).ok, false, "Unknown milk rejected");
  check((await place({ specialtyId: null, drink: specials[0].label })).ok, false, "Cannot bypass lock by omitting specialty ID");
  check((await place({ specialtyId: null, drink: ` ${specials[0].label.toUpperCase()} ` })).ok, false, "Case and spaces cannot bypass recipe lock");
  const first = await place({ recipe: "Tampered recipe" });
  check(first.ok, true, "Specialty order accepted");
  check(first.order.drink, specials[0].label, "Canonical name used");
  check(first.order.recipe, specials[0].regularRecipe, "Recipe locked server-side");
  const sugarFree = await place({ sweetness: "sugar-free", temp: "Cold" });
  check(sugarFree.order.recipe, specials[0].sugarFreeRecipe, "Correct sugar-free recipe saved");
  check(sugarFree.order.temp, "Cold", "Customer temperature retained");
  check((await place({ name: first.order.name })).code, "ACTIVE_ORDER_EXISTS", "Duplicate order guard unchanged");
  check((await place({ source: "clergy" })).order.priority, true, "Clergy priority retained");
  await db.exec("reset role; update inventory set available = false where item = 'Whole milk';");
  check((await place()).ok, false, "Out-of-stock milk rejected");
  await db.exec("update inventory set available = true where item = 'Whole milk';");
  await save([{ ...specials[0], regularRecipe: "Updated recipe" }, specials[1]]);
  check((await rpc("arise_order", [first.id])).order.recipe, specials[0].regularRecipe, "Existing ticket retains original recipe");
  await save([specials[1]]);
  check((await place()).ok, false, "Removed specialty cannot be ordered");
  check((await place({ specialtyId: specials[1].id, sweetness: "sugar-free" })).ok, false, "Missing sugar-free recipe not selectable");
  await rpc("arise_update_status", ["test-pin", first.id, "complete"]);
  await rpc("arise_update_pickup", ["test-pin", first.id, true]);
  await rpc("arise_clear_completed", ["test-pin"]);
  check((await db.query("select order_data->>'recipe' as recipe from archived_orders where original_order_id_text = $1", [first.id])).rows[0].recipe,
    specials[0].regularRecipe, "Archived specialty retains recipe snapshot");
  await save([], false);
  await db.exec(migration);
  await db.exec(read("../migrations/202611130002_menu_based_specialty_recipes.sql"));
  check((await list()).specialties.length, 0, "Migration rerun does not resurrect removed specialties");
  check((await rpc("arise_place_order", [JSON.stringify({ name: "Regular Guest", drink: "Latte", temp: "Hot" })])).ok, true, "Regular orders still work");
  console.log(`${checks} Sunday specialty database checks passed.`);
} finally { await db.close(); }
