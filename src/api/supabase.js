import { supabase } from "../supabaseClient";

function mapOrder(row, position = undefined) {
  if (!row) return null;

  return {
    id: row.id,
    time: row.created_at,
    name: row.customer_name,
    drink: row.drink,
    temp: row.temperature,
    milk: row.milk || "",
    syrups: Array.isArray(row.syrups) ? row.syrups.join(", ") : row.syrups || "",
    notes: row.notes || "",
    status: row.status || "waiting",
    position,
    ordersAhead: typeof position === "number" ? Math.max(0, position - 1) : undefined,
  };
}

function mapInventory(rows = []) {
  return {
    syrups: rows
      .filter((row) => row.type === "syrup")
      .map((row) => ({
        item: row.item,
        type: "syrup",
        available: row.available !== false,
      })),
    milks: rows
      .filter((row) => row.type === "milk")
      .map((row) => ({
        item: row.item,
        type: "milk",
        available: row.available !== false,
      })),
  };
}

function settingValue(settings, key, fallback = "") {
  const found = settings.find((row) => row.key === key);
  if (!found) return fallback;

  const value = found.value;

  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return fallback;

  return String(value);
}

async function readSettings() {
  const { data, error } = await supabase.from("settings").select("key,value");

  if (error) throw error;

  return data || [];
}

async function readQueueState() {
  const settings = await readSettings();

  return {
    isOpen: settingValue(settings, "isOpen", "true") === "true",
    message: settingValue(settings, "message", ""),
    pin: settingValue(settings, "pin", ""),
  };
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

  return { ok: false, error: "Unknown action" };
}

export async function login(pin) {
  try {
    const state = await readQueueState();

    if (String(pin) !== String(state.pin)) {
      return { ok: false, error: "Wrong PIN" };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getStatus() {
  try {
    const state = await readQueueState();

    return {
      ok: true,
      isOpen: state.isOpen,
      message: state.message,
    };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getOrders() {
  try {
    const [state, inventoryResult, ordersResult] = await Promise.all([
      readQueueState(),
      getInventory(),
      supabase
        .from("orders")
        .select("*")
        .neq("status", "complete")
        .order("created_at", { ascending: true }),
    ]);

    if (ordersResult.error) throw ordersResult.error;

    return {
      ok: true,
      isOpen: state.isOpen,
      message: state.message,
      orders: (ordersResult.data || []).map((row, index) => mapOrder(row, index + 1)),
      inventory: inventoryResult.inventory,
    };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getOrder(id) {
  try {
    const [state, orderResult, activeResult] = await Promise.all([
      readQueueState(),
      supabase.from("orders").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("orders")
        .select("id,status,created_at")
        .neq("status", "complete")
        .order("created_at", { ascending: true }),
    ]);

    if (orderResult.error) throw orderResult.error;
    if (activeResult.error) throw activeResult.error;

    const activeOrders = activeResult.data || [];
    const positionIndex = activeOrders.findIndex((order) => order.id === id);
    const position = positionIndex >= 0 ? positionIndex + 1 : null;

    return {
      ok: true,
      isOpen: state.isOpen,
      message: state.message,
      order: mapOrder(orderResult.data, position || undefined),
      position,
      ordersAhead: typeof position === "number" ? Math.max(0, position - 1) : null,
    };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function getInventory() {
  try {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("type", { ascending: false })
      .order("item", { ascending: true });

    if (error) throw error;

    return {
      ok: true,
      inventory: mapInventory(data || []),
    };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function updateAdmin(pin, payload) {
  const auth = await login(pin);
  if (!auth.ok) return auth;

  try {
    const updates = [];

    if (typeof payload.isOpen === "boolean") {
      updates.push(
        supabase
          .from("settings")
          .upsert({ key: "isOpen", value: payload.isOpen ? "true" : "false" })
      );
    }

    if (typeof payload.message === "string") {
      updates.push(
        supabase
          .from("settings")
          .upsert({ key: "message", value: payload.message })
      );
    }

    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;

    return getOrders();
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function placeOrder(order) {
  try {
    const state = await readQueueState();

    if (!state.isOpen) {
      return { ok: false, error: "Queue closed" };
    }

    const { data, error } = await supabase
      .from("orders")
      .insert({
        customer_name: order.name || "",
        drink: order.drink || "",
        temperature: order.temp || "",
        milk: order.milk || "",
        syrups: Array.isArray(order.syrups) ? order.syrups : [],
        notes: order.notes || "",
        status: "waiting",
      })
      .select("*")
      .single();

    if (error) throw error;

    const orderState = await getOrder(data.id);

    return {
      ok: true,
      id: data.id,
      position: orderState.position,
    };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function updateStatus(pin, id, status) {
  const auth = await login(pin);
  if (!auth.ok) return auth;

  try {
    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    const orderState = await getOrder(id);

    return {
      ok: true,
      order: orderState.order || mapOrder(data),
    };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function updateInventory(pin, item, available) {
  const auth = await login(pin);
  if (!auth.ok) return auth;

  try {
    const { error } = await supabase
      .from("inventory")
      .update({ available })
      .eq("item", item);

    if (error) throw error;

    return getInventory();
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function clearCompleted(pin) {
  const auth = await login(pin);
  if (!auth.ok) return auth;

  try {
    const { error } = await supabase.from("orders").delete().eq("status", "complete");

    if (error) throw error;

    return getOrders();
  } catch {
    return { ok: false, error: "Connection error" };
  }
}

export async function clearAll(pin) {
  const auth = await login(pin);
  if (!auth.ok) return auth;

  try {
    const state = await readQueueState();

    if (state.isOpen) {
      return { ok: false, error: "Close the queue before clearing all orders" };
    }

    const { error } = await supabase.from("orders").delete().neq("status", "__never__");

    if (error) throw error;

    return getOrders();
  } catch {
    return { ok: false, error: "Connection error" };
  }
}
