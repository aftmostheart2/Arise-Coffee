import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function rpc(name, args = []) {
  return (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
}
const place = (name, source = "") => rpc("arise_place_order", [JSON.stringify({ name, source, drink: "Latte", temp: "Hot" })]);
const ready = order => rpc("arise_update_status", ["test-pin", order.id, "complete"]);
const review = (order, rating = null, comment = "") => rpc("arise_order_review", [order.id, order.pickupToken, rating, comment]);
const admin = (page = 0, rating = null) => rpc("arise_reviews_admin", ["test-pin", page, rating]);
try {
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  await db.exec(schema.slice(0, schema.indexOf("create extension if not exists pg_cron")));
  const migration = readFileSync(new URL("../migrations/202610190001_order_reviews.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`update settings set value = '"test-pin"' where key = 'pin';
    update settings set value = '"true"' where key in ('isOpen', 'clergyOrderingEnabled');
    update settings set value = '"false"' where key = 'queueTimerEnabled'; set role anon;`);
  const first = await place("Adam Basilious");
  check(first.ok, true, "Order placement still works");
  check((await review(first)).eligible, false, "Review hidden before ready");
  check((await review(first, 5)).ok, false, "Cannot review waiting drink");
  check((await rpc("arise_order_review", [first.id, "wrong"])).ok, false, "Order ID alone does not grant review access");
  check((await rpc("arise_order_review", [first.id, null])).ok, false, "Token required");
  check((await rpc("arise_reviews_admin", ["wrong"])).ok, false, "Staff PIN required");
  for (const table of ["order_reviews", "order_review_access"]) {
    await assert.rejects(db.query(`select * from ${table}`), /permission denied/); checks++;
    await assert.rejects(db.query(`delete from ${table}`), /permission denied/); checks++;
  }
  await ready(first);
  check((await review(first)).eligible, true, "Ready drink can be reviewed");
  for (const stars of [0, 6, -1]) check((await review(first, stars)).ok, false, "Rating range enforced");
  check((await review(first, 5, "x".repeat(1001))).ok, false, "Comment length enforced");
  const text = '<script>alert("test")</script> Great coffee!';
  const submitted = await review(first, 5, ` ${text} `);
  check(submitted.ok, true, "Review saved");
  check(submitted.review.comment, text, "Comment stored as plain text");
  check((await review(first, 1, "Overwrite")).review.rating, 5, "Duplicate cannot change original review");
  check((await admin()).totalReviews, 1, "One review per order");
  check((await admin()).averageRating, 5, "Average correct");
  check((await admin()).reviews[0].name, "Adam Basilious", "Staff sees order name");
  check(JSON.stringify(await admin()).includes(first.pickupToken), false, "Staff response does not expose review tokens");
  check(JSON.stringify(await rpc("arise_order", [first.id])).includes(first.pickupToken), false, "Public order polling does not expose token");
  const second = await place("Clergy Guest", "clergy");
  await ready(second);
  check((await rpc("arise_order_review", [second.id, first.pickupToken, 2, "Wrong owner"])).ok, false, "Cannot review another order");
  check((await review(second, 3)).review.comment, "", "Stars-only review supported");
  check((await admin()).averageRating, 4, "Mixed average correct");
  check((await admin(0, 3)).reviews[0].source, "clergy", "Clergy reviews tracked");
  check((await admin(0, 5)).filteredTotal, 1, "Rating filter correct");
  check((await admin()).ratingCounts[5], 1, "Distribution correct");
  const third = await place("Archive Guest");
  await ready(third);
  await rpc("arise_update_pickup", ["test-pin", first.id, true]);
  await rpc("arise_update_pickup", ["test-pin", third.id, true]);
  await rpc("arise_clear_completed", ["test-pin"]);
  check((await review(third, 4, "After archive")).ok, true, "Review can be submitted after final archive");
  check((await review(first)).review.rating, 5, "Existing review survives final archive");
  await rpc("arise_clear_archive", ["test-pin"]);
  check((await admin()).totalReviews, 3, "Clearing archived orders preserves feedback");
  const canceled = await place("Canceled Guest");
  await rpc("arise_update_status", ["test-pin", canceled.id, "canceled"]);
  check((await review(canceled, 1)).ok, false, "Canceled order cannot review");
  for (let i = 0; i < 26; i++) {
    const order = await place(`Pagination Guest${i}`);
    await ready(order);
    await review(order, 4);
  }
  check((await admin()).reviews.length, 25, "Reviews paginated");
  check((await admin(1)).reviews.length, 4, "Remaining reviews on next page");
  const firstPage = (await admin()).reviews.map(item => item.id);
  check((await admin(1)).reviews.some(item => firstPage.includes(item.id)), false, "Pages do not overlap");
  await db.exec("reset role");
  await db.exec(migration);
  check((await admin()).totalReviews, 29, "Migration rerun preserves reviews");
  console.log(`${checks} order review database checks passed.`);
} finally { await db.close(); }
