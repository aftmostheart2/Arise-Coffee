// Run with Node and @electric-sql/pglite available, or PGLITE_MODULE pointing to it.
// All SQL runs in a disposable in-memory database, never the live project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
async function place(name, source = "", fulfillmentType = "pickup") {
  const { rows } = await db.query("select arise_place_order($1::jsonb) as result", [JSON.stringify({ name, source, fulfillmentType, drink: "Latte" })]);
  return rows[0].result;
}
function check(value, expected, message) {
  assert.equal(value, expected, message);
  checks++;
}
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE service_role;");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  // Scheduled push cleanup is unrelated and requires Supabase's pg_cron extension.
  await db.exec(schema.slice(0, schema.indexOf("create extension if not exists pg_cron")));
  const migration = readFileSync(new URL("../migrations/202609260001_one_active_order_per_name.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`UPDATE settings SET value = '"true"' WHERE key IN ('isOpen', 'clergyOrderingEnabled');
    UPDATE settings SET value = '"false"' WHERE key = 'queueTimerEnabled';`);
  const first = await place("Adam Basilious");
  check(first.ok, true, "First normal order");
  for (const status of ["waiting", "making", "ready"]) {
    await db.query("UPDATE orders SET status = $1 WHERE id::text = $2", [status, first.id]);
    check((await place("  BASILIOUS   adam  ")).code, "ACTIVE_ORDER_EXISTS", `${status}: reversed name, case and spaces`);
  }
  check((await db.query("SELECT count(*)::int AS count FROM orders")).rows[0].count, 1, "Rejected requests insert nothing");
  check((await place("Adam\tBasilious\n")).code, "ACTIVE_ORDER_EXISTS", "Tabs and newlines");
  check((await place("Adam Basilious", "", "delivery")).code, "ACTIVE_ORDER_EXISTS", "Delivery follows the rule");
  check((await place("Adam Smith")).ok, true, "Different last name");
  check((await place("Adam Basilious", "clergy")).ok, true, "Clergy ignores normal active orders");
  check((await place("Basilious Adam", "clergy")).ok, true, "Clergy can order repeatedly");
  await db.query("UPDATE orders SET status = 'complete' WHERE id::text = $1", [first.id]);
  const afterComplete = await place("Basilious Adam");
  check(afterComplete.ok, true, "Completed normal order releases the name despite active clergy orders");
  await db.query("UPDATE orders SET status = 'canceled' WHERE id::text = $1", [afterComplete.id]);
  check((await place("Adam Basilious")).ok, true, "Cancellation releases the name");
  await db.exec("TRUNCATE orders; INSERT INTO orders (name, customer_name, drink) VALUES ('Adam Basilious', '', 'Latte');");
  check((await place("Basilious Adam")).code, "ACTIVE_ORDER_EXISTS", "Existing name-only rows");
  await db.exec(`UPDATE settings SET value = '"false"' WHERE key = 'isOpen';`);
  check((await place("Another Person")).error, "Queue closed", "Preserve queue closure");
  check(migration.includes(schema.slice(schema.indexOf("create or replace function arise_customer_name_key("), schema.indexOf("\ndrop function if exists arise_update_admin"))), true, "Migration matches schema");
  console.log(`PASS: ${checks} assertions, schema installation, and repeatable migration`);
} finally {
  await db.close();
}
