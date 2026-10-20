// Local-only UI checks. All backend requests are intercepted; no live orders are changed.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PREVIEW_URL || "http://127.0.0.1:5181";
const out = process.env.SCREENSHOT_DIR || "/private/tmp/arise-redesign";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const orders = Array.from({ length: 14 }, (_, i) => ({
  id: `test-${i}`, name: ["Adam Basilious", "Marianne Abdelmalek", "Christopher Alexander", "Miriam Hanna"][i % 4],
  drink: i % 2 ? "Cappuccino" : "Latte", temp: i % 2 ? "Hot" : "Cold", milk: "Whole Milk", syrups: "Vanilla",
  notes: i === 0 ? "Extra hot, please. Thank you!" : "", status: i < 2 ? "making" : "waiting",
  position: i + 1, time: new Date().toISOString(), fulfillmentType: "pickup",
}));
const status = { ok: true, isOpen: true, queueTimerEnabled: true, queueTimerMinutes: 30,
  queueClosesAt: new Date(Date.now() + 25 * 60000).toISOString(), clergyOrderingEnabled: true, deliveryEnabled: true };
const pickupOptions = { showReady: true, adminPickup: true, archiveMinutes: 30 };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await context.route("**/*supabase.co/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    let result = { ...status };
    if (["arise_orders", "arise_display"].includes(name)) result = { ...status, orders, pickupOptions,
      ready: orders.slice(0, 5).map(o => ({ ...o, status: "complete" })) };
    if (name === "arise_inventory") result.inventory = ["Whole Milk", "Oat Milk", "Vanilla", "Caramel"].map(item => ({ item, type: item.includes("Milk") ? "milk" : "syrup", available: true }));
    if (name === "arise_pickup_admin") result = { ok: true, pickupOptions, ready: orders.slice(0, 2), collected: [] };
    if (name === "arise_pickup_settings") result = { ok: true, pickupOptions };
    if (name === "arise_customer_strikes") result = { ok: true, enabled: false, entries: [] };
    if (name === "arise_order") result = { ok: true, order: orders[0], position: 1 };
    if (name === "arise_place_order") result = { ok: true, id: "test-0", position: 1 };
    if (name === "arise_archive") result = { ok: true, archive: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  async function capture(name) {
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}: no horizontal overflow`);
  }
  await page.goto(base);
  await page.locator(".drink").first().waitFor();
  await page.getByLabel("Your name", { exact: true }).fill("Adam Basilious");
  await page.locator(".drink").filter({ hasText: "Cappuccino" }).click();
  assert.equal(await page.locator(".draftOrder h3").textContent(), "Cappuccino");
  await page.getByRole("button", { name: "Cold", exact: true }).click();
  await capture("customer-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("customer-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/admin`);
  for (const digit of ["1", "2", "3", "4"]) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.locator(".adminOrderGrid .adminOrder").first().waitFor();
  await capture("admin-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("admin-mobile");
  await page.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Pickup & Archive" }).waitFor();
  await capture("settings-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture("settings-desktop");
  await page.getByRole("navigation").getByRole("button", { name: "Menu", exact: true }).click();
  await capture("menu-desktop");
  for (const [width, height] of [[1920,1080], [1280,720]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/display`);
    await page.locator(".displayTableRow").first().waitFor();
    await page.waitForTimeout(800);
    await capture(`tv-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, "TV fits screen height");
  }
  await page.goto(`${base}/?mode=clergy`);
  await page.getByRole("heading", { name: "Clergy menu" }).waitFor();
  await capture("clergy-desktop");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`UI checks passed. Screenshots: ${out}`);
} finally { await browser.close(); }
