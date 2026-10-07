// Runs only in disposable PostgreSQL. Install @electric-sql/pglite or set PGLITE_MODULE.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
const check = (value, expected, label) => { assert.equal(value, expected, label); checks++; };
async function rpc(name, args = []) {
  const { rows } = await db.query(`SELECT ${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) AS result`, args);
  return rows[0].result;
}
const place = (name, extra = {}) => rpc("arise_place_order", [JSON.stringify({ name, drink: "Latte", ...extra })]);
const ready = id => rpc("arise_update_status", ["test-pin", id, "complete"]);
const confirm = order => rpc("arise_confirm_pickup", [order.id, order.pickupToken]);
const listed = async id => (await rpc("arise_display")).ready.some(order => order.id === id);
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  await db.exec(schema.slice(0, schema.indexOf("create extension if not exists pg_cron")));
  const migration = readFileSync(new URL("../migrations/202610070001_pickup_confirmation.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`UPDATE settings SET value = '"test-pin"' WHERE key = 'pin';
    UPDATE settings SET value = '"true"' WHERE key IN ('isOpen', 'clergyOrderingEnabled');
    UPDATE settings SET value = '"false"' WHERE key = 'queueTimerEnabled'; SET ROLE anon;`);
  const first = await place("Adam Basilious");
  check(first.ok, true, "Place order");
  check(typeof first.pickupToken, "string", "Only creation gives the private pickup token");
  check((await confirm(first)).ok, false, "Cannot collect before ready");
  check((await rpc("arise_pickup_admin", ["wrong"])).ok, false, "Admin list requires PIN");
  check((await rpc("arise_update_pickup", ["wrong", first.id, true])).ok, false, "Admin changes require PIN");
  await ready(first.id);
  check(await listed(first.id), true, "Ready order remains on TV");
  check((await rpc("arise_pickup_admin", ["test-pin"])).ready.length, 1, "Staff sees the ready list");
  for (const [fn, args] of [["arise_display", []], ["arise_orders", []], ["arise_order", [first.id]], ["arise_pickup_admin", ["test-pin"]]]) {
    check(JSON.stringify(await rpc(fn, args)).includes(first.pickupToken), false, `${fn} never exposes pickup token`);
  }
  await assert.rejects(db.query("SELECT pickup_token FROM orders"), /permission denied/);
  checks++;
  check((await rpc("arise_confirm_pickup", [first.id, "wrong"])).ok, false, "Invalid token cannot collect");
  check((await rpc("arise_confirm_pickup", [first.id, null])).ok, false, "Missing token cannot collect");
  await rpc("arise_clear_completed", ["test-pin"]);
  check(await listed(first.id), true, "Archiving does not remove uncollected ready drinks");
  const second = await place("Another Person");
  await ready(second.id);
  check((await rpc("arise_confirm_pickup", [second.id, first.pickupToken])).ok, false, "Cannot confirm somebody else's order");
  const picked = await confirm(first);
  check(picked.ok, true, "Customer confirms own drink");
  check(Boolean(picked.order.pickedUpAt), true, "Collection timestamp returned");
  check(await listed(first.id), false, "Collected drink leaves TV");
  check(await listed(second.id), true, "Other person's ready drink remains");
  check((await confirm(first)).order.pickedUpAt, picked.order.pickedUpAt, "Confirmation is idempotent");
  check((await rpc("arise_order", [first.id])).order.pickedUpAt, picked.order.pickedUpAt, "Polling keeps confirmation");
  check((await rpc("arise_pickup_admin", ["test-pin"])).collected[0].id, first.id, "Staff can see recently collected drink");
  await rpc("arise_update_pickup", ["test-pin", first.id, false]);
  check(await listed(first.id), true, "Staff undo restores TV entry");
  check((await rpc("arise_order", [first.id])).order.pickedUpAt, null, "Staff undo reaches customer page");
  check((await rpc("arise_update_pickup", ["test-pin", first.id, true])).ok, true, "Staff can confirm pickup");
  await rpc("arise_clear_completed", ["test-pin"]);
  check((await rpc("arise_archive", ["test-pin", 25])).archive.some(order => order.originalOrderId === first.id), true, "Picked-up order archived");
  check(await listed(second.id), true, "Uncollected order survives archive");
  check((await rpc("arise_update_pickup", ["test-pin", first.id, false])).ok, false, "Cannot undo an archived order");
  const delivery = await place("Delivery Customer", { fulfillmentType: "delivery", deliveryLocation: "Classroom 1" });
  await ready(delivery.id);
  check(await listed(delivery.id), false, "Delivery is not advertised as kitchen pickup");
  check((await rpc("arise_pickup_admin", ["test-pin"])).ready.some(order => order.id === delivery.id), true, "Staff can track delivery separately");
  check((await confirm(delivery)).ok, true, "Recipient can confirm delivery");
  for (let i = 0; i < 10; i++) {
    const order = await place(`Guest Number${i}`);
    await ready(order.id);
  }
  check((await rpc("arise_display")).ready.length, 11, "All ready names are available for TV rotation, not just eight");
  const existingToken = second.pickupToken;
  await db.exec("RESET ROLE;");
  await db.exec(migration);
  check((await db.query("SELECT pickup_token::text AS token FROM orders WHERE id::text = $1", [second.id])).rows[0].token, existingToken, "Reapplying migration preserves tokens");
  check(await listed(second.id), true, "Reapplying migration preserves ready records");
  console.log(`PASS: ${checks} pickup confirmation, persistence, access-control and archive checks`);
} finally {
  await db.close();
}
