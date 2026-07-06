import { supabase } from "../supabaseClient";

function normalizeResponse(data, fallback = {}) {
  if (!data) return fallback;
  return typeof data === "object" ? data : fallback;
}

async function callRpc(name, args = {}, fallback = { ok: false, error: "Connection error" }) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.error(`Supabase RPC failed: ${name}`, error);
    throw error;
  }
  return normalizeResponse(data, fallback);
}

export async function apiGet(action, params = {}) {
  if (action === "status" || !action) return getStatus();
  if (action === "orders") return getOrders();
  if (action === "order") return getOrder(params.id);
  if (action === "inventory") return getInventory();

  return { ok: false, error: "Unknown action" };
}

export async function apiPost(payload) {
  if (payload.action === "login") return login(payload.pin);
  if (payload.action === "admin") {
    const { action, pin, ...adminPayload } = payload;
    return updateAdmin(pin, adminPayload);
  }
  if (payload.action === "order") {
    const { action, ...order } = payload;
    return placeOrder(order);
  }
  if (payload.action === "updateStatus") return updateStatus(payload.pin, payload.id, payload.status);
  if (payload.action === "setInventory") return updateInventory(payload.pin, payload.item, payload.available);
  if (payload.action === "clearCompleted") return clearCompleted(payload.pin);
  if (payload.action === "clearAll") return clearAll(payload.pin);
  if (payload.action === "archive") return getArchive(payload.pin);
  if (payload.action === "clearArchive") return clearArchive(payload.pin);
  if (payload.action === "analytics") return getAnalytics(payload.pin);

  return { ok: false, error: "Unknown action" };
}

export async function login(pin) {
  try {
    return await callRpc("arise_login", { input_pin: String(pin || "") });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getStatus() {
  try {
    return await callRpc("arise_status");
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getOrders() {
  try {
    return await callRpc("arise_orders");
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getOrder(id) {
  try {
    return await callRpc("arise_order", { order_id: id ? String(id) : null });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getInventory() {
  try {
    return await callRpc("arise_inventory");
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function updateAdmin(pin, payload) {
  try {
    return await callRpc("arise_update_admin", {
      input_pin: String(pin || ""),
      input_is_open: typeof payload.isOpen === "boolean" ? payload.isOpen : null,
      input_message: typeof payload.message === "string" ? payload.message : null,
    });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function placeOrder(order) {
  try {
    return await callRpc("arise_place_order", {
      input_order: {
        name: order.name || "",
        drink: order.drink || "",
        temp: order.temp || "",
        milk: order.milk || "",
        syrups: Array.isArray(order.syrups) ? order.syrups : [],
        notes: order.notes || "",
      },
    });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function updateStatus(pin, id, status) {
  try {
    return await callRpc("arise_update_status", {
      input_pin: String(pin || ""),
      order_id: String(id || ""),
      input_status: status,
    });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function updateInventory(pin, item, available) {
  try {
    return await callRpc("arise_update_inventory", {
      input_pin: String(pin || ""),
      input_item: item,
      input_available: available,
    });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function clearCompleted(pin) {
  try {
    return await callRpc("arise_clear_completed", { input_pin: String(pin || "") });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function clearAll(pin) {
  try {
    return await callRpc("arise_clear_all", { input_pin: String(pin || "") });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getArchive(pin) {
  try {
    return await callRpc("arise_archive", { input_pin: String(pin || ""), input_limit: 25 });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function clearArchive(pin) {
  try {
    return await callRpc("arise_clear_archive", { input_pin: String(pin || "") });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getAnalytics(pin) {
  try {
    return await callRpc("arise_analytics", { input_pin: String(pin || "") });
  } catch {
    return { ok: false, error: "Connection error" };
  }
}
