// Disposable PostgreSQL tests. Requires @electric-sql/pglite or PGLITE_MODULE.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
function check(value, expected, message) {
  assert.equal(value, expected, message);
  checks++;
}
async function strikes(action = "list", name = "", enabled = null, pin = "test-pin") {
  const { rows } = await db.query("SELECT arise_customer_strikes($1, $2, $3, $4) AS result", [pin, action, name, enabled]);
  return rows[0].result;
}
async function place(name = "Basilious Adam", source = "", fulfillmentType = "pickup") {
  const { rows } = await db.query("SELECT arise_place_order($1::jsonb) AS result", [JSON.stringify({ name, source, fulfillmentType, drink: "Latte" })]);
  return rows[0].result;
}
async function finishOrders() {
  await db.exec("RESET ROLE; UPDATE orders SET status = 'complete'; SET ROLE anon;");
}
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE service_role; CREATE ROLE authenticated;");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  await db.exec(schema.slice(0, schema.indexOf("create extension if not exists pg_cron")));
  const migration = readFileSync(new URL("../migrations/202609260002_pickup_strikes.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`UPDATE settings SET value = '"test-pin"' WHERE key = 'pin';
    UPDATE settings SET value = '"true"' WHERE key IN ('isOpen', 'clergyOrderingEnabled');
    UPDATE settings SET value = '"false"' WHERE key = 'queueTimerEnabled'; SET ROLE anon;`);
  check((await strikes()).enabled, false, "Starts with enforcement off");
  for (const action of ["list", "add", "remove", "reset", "setEnabled"]) {
    const denied = await strikes(action, "Adam Basilious", true, "wrong");
    check(denied.ok, false, `${action} requires correct PIN`);
    check(denied.entries, undefined, "No name list disclosed");
  }
  await assert.rejects(db.query("SELECT * FROM customer_pickup_strikes"), /permission denied/);
  await assert.rejects(db.query("INSERT INTO customer_pickup_strikes VALUES ('fake', 'Fake Name', 3, now())"), /permission denied/);
  checks += 2;
  check((await strikes("add", "Adam")).ok, false, "Require a full name");
  check((await strikes("unknown")).ok, false, "Reject invalid actions");
  check((await strikes("setEnabled")).ok, false, "Reject missing toggle value");
  check((await strikes("setEnabled", "", true)).enabled, true, "Enable enforcement");
  for (const [index, name] of ["Adam Basilious", " BASILIOUS   ADAM ", "Adam\tBasilious"].entries()) {
    const result = await strikes("add", name);
    check(result.entries.length, 1, "Variants share a single record");
    check(result.entries[0].strikes, index + 1, "Increment exactly one strike");
    check(result.entries[0].blacklisted, index === 2, "Blacklist begins at three");
    if (index < 2) {
      check((await place()).ok, true, "One or two strikes still allow orders");
      await finishOrders();
    }
  }
  const blocked = await place();
  check(blocked.code, "CUSTOMER_BLACKLISTED", "Third strike blocks reversed names");
  check(blocked.error.includes("3 missed drink pickups") && blocked.error.includes("Arise staff"), true, "Explains reason and staff contact");
  check((await place("Adam Basilious", "", "delivery")).code, "CUSTOMER_BLACKLISTED", "Delivery is also blocked");
  check((await place("Adam Basilious", "clergy")).ok, true, "Clergy is exempt");
  check((await place("Adam Basilious", "clergy")).ok, true, "Clergy remains unrestricted");
  check((await place("Adam Smith")).ok, true, "Different people are unaffected");
  check((await strikes("add", "Adam Basilious")).entries[0].strikes, 3, "Count stays at three");
  check((await strikes("setEnabled", "", false)).enabled, false, "Pause enforcement");
  check((await place()).ok, true, "Paused blacklist permits ordering");
  await finishOrders();
  await strikes("setEnabled", "", true);
  check((await place()).code, "CUSTOMER_BLACKLISTED", "Re-enabling preserves blacklist");
  check((await strikes("remove", "Basilious Adam")).entries[0].strikes, 2, "Undo a strike");
  check((await place()).ok, true, "Undo releases blacklist");
  await finishOrders();
  await strikes("add", "Adam Basilious");
  const reset = await strikes("reset", "Basilious Adam");
  check(reset.entries[0].strikes, 0, "Remove blacklist resets strikes");
  check(reset.entries[0].blacklisted, false, "Reset clears blacklist");
  check((await place()).ok, true, "Removed blacklist permits orders");
  check((await strikes("remove", "Adam Basilious")).entries[0].strikes, 0, "No negative strikes");
  check((await strikes("add", "Adam Basilious")).entries[0].strikes, 1, "Fresh start after reset");
  await db.exec("RESET ROLE;");
  await db.exec(migration);
  check((await strikes()).entries[0].strikes, 1, "Reapplying migration preserves strikes");
  check((await strikes()).enabled, true, "Reapplying migration preserves setting");
  console.log(`PASS: ${checks} pickup-strike checks including anonymous-role access controls`);
} finally {
  await db.close();
}
