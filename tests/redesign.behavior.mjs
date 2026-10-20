// DOM behavior checks with a mocked backend; no production requests are made.
import assert from "node:assert/strict";
import { build } from "vite";
const { JSDOM } = await import(process.env.JSDOM_MODULE || "jsdom");
const previewTest = process.env.TEST_LOCAL_PREVIEW === "1";
const bundle = await build({ configFile: false, logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.DEV": JSON.stringify(previewTest), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(previewTest ? "" : "https://ui-test.supabase.co"), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(previewTest ? "" : "test-key") },
  build: { write: false, minify: false, lib: { entry: "src/main.jsx", name: "AriseUITest", fileName: "ui-test", cssFileName: "ui-test", formats: ["iife"] } },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === "chunk").code;
const css = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === "asset" && file.fileName.endsWith(".css")).source;
const orders = [{ id: "one", name: "Adam Basilious", drink: "Latte", temp: "Hot", milk: "Whole Milk", status: "waiting", fulfillmentType: "pickup", position: 1 }];
const status = { ok: true, isOpen: true, queueTimerEnabled: false, clergyOrderingEnabled: true, deliveryEnabled: true };
const options = { showReady: true, archiveMinutes: 30, adminPickup: true };
const delay = () => new Promise(resolve => setTimeout(resolve, 60));
let checks = 0;
async function mount(path, storage = {}) {
  const dom = new JSDOM('<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div></body></html>', { url: `http://localhost${path}`, runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  const style = w.document.createElement("style");
  style.textContent = String(css).replace(/@import[^;]+;/g, "");
  w.document.head.append(style);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.alert = () => {};
  w.confirm = () => true;
  Object.entries(storage).forEach(([key, value]) => w.localStorage.setItem(key, value));
  w.fetch = async url => {
    assert.equal(previewTest, false, "Local sample preview must never contact a backend");
    const rpc = String(url).split("/").pop();
    let response = { ...status, orders, inventory: [], ready: orders, collected: [], pickupOptions: options };
    if (rpc === "arise_order") response = { ...status, order: orders[0], position: 1 };
    if (rpc === "arise_customer_strikes") response = { ok: true, enabled: false, entries: [] };
    if (rpc === "arise_archive") response = { ok: true, archive: [] };
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  };
  w.eval(code);
  await delay();
  await delay();
  return dom;
}
function button(dom, text, scope = "body") {
  const result = [...dom.window.document.querySelector(scope).querySelectorAll("button")].find(el => el.textContent.trim() === text);
  assert.ok(result, `Button exists: ${text}`);
  return result;
}
let dom;
try {
  dom = await mount("/");
  const document = dom.window.document;
  assert.ok(document.querySelector(".customerIntro")); checks++;
  assert.ok(document.querySelectorAll(".drink").length >= 6); checks++;
  [...document.querySelectorAll(".drink")].find(el => el.textContent.includes("Cappuccino")).click();
  await delay();
  assert.equal(document.querySelector(".draftOrder h3").textContent, "Cappuccino"); checks++;
  button(dom, "Cold").click(); await delay();
  assert.match(document.querySelector(".draftOrder").textContent, /Cold/); checks++;
  button(dom, "Deliver to classroom").click(); await delay();
  assert.equal(document.querySelector(".deliveryServantsNotice").textContent, "For Servants only"); checks++;
  dom.window.close();
  dom = await mount("/?mode=clergy");
  assert.equal(dom.window.document.querySelector(".customerSectionHead h2").textContent, "Clergy menu"); checks++;
  assert.equal(dom.window.document.querySelector(".deliveryFields"), null); checks++;
  dom.window.close();
  dom = await mount("/", { "coffee-my-order-id": "one" });
  assert.ok(dom.window.document.querySelector(previewTest ? ".previewNotice" : ".customerStatusCard")); checks++;
  dom.window.close();
  dom = await mount("/admin");
  for (const digit of (previewTest ? ["0", "0", "0", "0"] : ["1", "2", "3", "4"])) { button(dom, digit).click(); await delay(); }
  await delay();
  assert.ok(dom.window.document.querySelector(".workspaceNav")); checks++;
  assert.equal(dom.window.document.querySelectorAll(".adminOrderGrid .adminOrder").length, previewTest ? 4 : 1); checks++;
  for (const page of ["Settings", "Menu", "Archive", "Analytics", "Delivery", "Orders"]) {
    button(dom, page, ".workspaceNav").click(); await delay();
    assert.equal(dom.window.document.querySelector(".workspaceNav [aria-current=page]").textContent, page); checks++;
    assert.equal(dom.window.document.querySelector(".closedPage"), null, "No error boundary"); checks++;
    if (process.env.AUDIT_STYLES) {
      const legacy = [...dom.window.document.querySelectorAll("main *")].filter(el => {
        const style = dom.window.getComputedStyle(el);
        return /gradient/.test(style.backgroundImage) || /rgba?\((18, 7, 0|28, 10, 0|44, 20, 0|40, 19, 2)/.test(style.backgroundColor);
      }).map(el => el.className).filter((value, index, all) => all.indexOf(value) === index);
      console.log(page, legacy);
    }
  }
  dom.window.close();
  dom = await mount("/display");
  assert.ok(dom.window.document.querySelector(".displayTableRow")); checks++;
  console.log(`${checks} redesigned UI behavior checks passed.`);
} finally { dom?.window.close(); }
