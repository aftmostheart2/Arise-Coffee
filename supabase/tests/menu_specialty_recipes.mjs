import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
let guest = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
async function rpc(name, args = []) {
  return (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
}
let sunday;
let specialty;
const save = item => rpc("arise_specialties_admin", ["test-pin", JSON.stringify([item]), true, sunday]);
const list = () => rpc("arise_specialties_admin", ["test-pin"]);
const place = (patch = {}) => rpc("arise_place_order", [JSON.stringify({ name: `Recipe Guest${++guest}`, specialtyId: specialty.id,
  drink: "Untrusted name", temp: "Hot", milk: "Whole milk", sweetness: "regular", ...patch })]);
try {
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const schema = read("../schema.sql");
  await db.exec(schema.slice(0, schema.indexOf("create extension if not exists pg_cron")));
  await db.exec(read("../migrations/202611130001_sunday_specialties.sql"));
  await db.exec(`update settings set value = '"test-pin"' where key = 'pin';
    update settings set value = '"true"' where key = 'isOpen';
    update settings set value = '"false"' where key = 'queueTimerEnabled';
    update inventory set available = true where item = 'Whole milk';`);
  sunday = (await list()).startsOn;
  specialty = { ...(await list()).specialties[0], active: true,
    regularRecipe: "Double shot; two pumps vanilla", sugarFreeRecipe: "Double shot; sugar-free vanilla" };
  await save(specialty);
  const oldOrder = await place();
  const migration = read("../migrations/202611130002_menu_based_specialty_recipes.sql");
  await db.exec(migration);
  await db.exec(migration);
  check((await list()).specialties[0].regularRecipe, specialty.regularRecipe, "Migration retains written recipes");
  check((await list()).specialties[0].recipeConfig, null, "Legacy recipe not silently converted");
  check((await place()).order.recipe, specialty.regularRecipe, "Existing written recipes still orderable");
  const config = { baseDrinkId: "latte", regularSyrups: ["Vanilla"], sugarFreeEnabled: true, sugarFreeSyrups: ["Sugar Free Vanilla"] };
  specialty = { ...specialty, recipeConfig: config, regularRecipe: "Ignore this forged instruction" };
  const saved = await save(specialty);
  check(saved.ok, true, "Recipe can be built from saved menu options");
  check(saved.specialties[0].regularRecipe, "Latte: Vanilla", "Regular instructions generated server-side");
  check(saved.specialties[0].sugarFreeRecipe, "Latte: Sugar Free Vanilla", "Sugar-free instructions generated server-side");
  check(saved.specialties[0].recipeConfig, config, "Selections survive reload");
  check((await place()).order.recipe, "Latte: Vanilla", "Order uses configured ingredients");
  check((await place({ sweetness: "sugar-free" })).order.recipe, "Latte: Sugar Free Vanilla", "Sugar-free order uses its own selections");
  check((await rpc("arise_order", [oldOrder.id])).order.recipe, "Double shot; two pumps vanilla", "Old tickets keep exact prior recipe");
  for (const invalid of [
    { ...config, baseDrinkId: "made-up" },
    { ...config, regularSyrups: ["Unknown syrup"] },
    { ...config, sugarFreeSyrups: ["Unknown syrup"] },
    { ...config, regularSyrups: "Vanilla" },
    { ...config, sugarFreeEnabled: "yes" },
    { ...config, regularSyrups: Array(11).fill("Vanilla") },
  ]) check((await save({ ...specialty, recipeConfig: invalid })).ok, false, "Invalid menu selection rejected");
  check((await list()).specialties[0].recipeConfig, config, "Rejected save leaves recipe unchanged");
  check((await save({ ...specialty, recipeConfig: { ...config, baseDrinkId: "" } })).ok, false, "Active specialty requires a base drink");
  await db.exec("update inventory set available = false where item = 'Sugar Free Vanilla';");
  check((await rpc("arise_menu")).specialty.sugarFreeAvailable, false, "Out-of-stock sugar-free version hidden");
  check((await place({ sweetness: "sugar-free" })).ok, false, "Out-of-stock sugar-free version rejected");
  check((await place()).ok, true, "Regular version still available");
  await db.exec("update inventory set available = false where item = 'Vanilla';");
  check((await rpc("arise_menu")).specialty, null, "Unavailable regular recipe hides weekly special");
  check((await place()).ok, false, "Unavailable recipe cannot be ordered");
  await db.exec("update inventory set available = true where item in ('Vanilla', 'Sugar Free Vanilla');");
  check((await rpc("arise_menu")).specialty.label, specialty.label, "Stock restoration restores same scheduled specialty");
  await save({ ...specialty, recipeConfig: { ...config, regularSyrups: ["Vanilla", "Vanilla", "Caramel"] } });
  check((await place()).order.recipe, "Latte: Vanilla + Caramel", "Duplicate ingredient selections are normalized");
  await save(specialty);
  await db.exec("update menu_drinks set label = 'House Latte' where id = 'latte';");
  check((await place()).order.recipe, "House Latte: Vanilla", "New orders reflect current base-drink name");
  await db.exec("update menu_drinks set active = false where id = 'latte';");
  check((await rpc("arise_menu")).specialty, null, "Hidden base drink makes specialty unavailable");
  check((await save(specialty)).ok, false, "Cannot save an unavailable base drink");
  await db.exec("update menu_drinks set active = true where id = 'latte'; update inventory set active = false where item = 'Vanilla';");
  check((await rpc("arise_menu")).specialty, null, "Removed ingredient makes specialty unavailable");
  check((await save(specialty)).ok, false, "Cannot save removed ingredient");
  await db.exec("update inventory set active = true where item = 'Vanilla';");
  await save({ ...specialty, recipeConfig: { ...config, regularSyrups: [], sugarFreeEnabled: false } });
  check((await place()).order.recipe, "House Latte (no syrup)", "No-syrup base supported without invented ingredients");
  check((await rpc("arise_menu")).specialty.sugarFreeAvailable, false, "Sugar-free version optional");
  await db.exec("set role anon");
  await assert.rejects(db.query("select arise_specialty_recipe_text($1)", [JSON.stringify(config)]), /permission denied/); checks++;
  check((await rpc("arise_specialties_admin", ["wrong", JSON.stringify([specialty]), true, sunday])).ok, false, "Recipe editing still PIN protected");
  await db.exec("reset role");
  await db.exec(migration);
  check((await list()).specialties[0].recipeConfig.baseDrinkId, "latte", "Migration rerun keeps structured recipe");
  check((await rpc("arise_place_order", [JSON.stringify({ name: "Regular Guest", drink: "Americano", temp: "Hot" })])).ok, true, "Regular ordering unchanged");
  console.log(`${checks} menu-based specialty recipe database checks passed.`);
} finally { await db.close(); }
