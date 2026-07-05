const DEFAULT_BACKEND_URL =
  "https://script.google.com/macros/s/AKfycbyexBADXI1coIcSfUa8jrJ7BluPIUG5B3BnogsA1SfwAZBIaKkVJ_xB1KsVeOxc5Kwx4w/exec";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || DEFAULT_BACKEND_URL;

export async function apiGet(action, params = {}) {
  const url = new URL(BACKEND_URL);

  if (action) url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  url.searchParams.set("t", Date.now());

  const res = await fetch(url.toString());
  return await res.json();
}

export async function apiPost(payload) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  return await res.json();
}

export function login(pin) {
  return apiPost({ action: "login", pin });
}

export function getStatus() {
  return apiGet("status");
}

export function getOrders() {
  return apiGet("orders");
}

export function getOrder(id) {
  return apiGet("order", { id });
}

export function getInventory() {
  return apiGet("inventory");
}

export function updateAdmin(pin, payload) {
  return apiPost({ action: "admin", pin, ...payload });
}

export function placeOrder(order) {
  return apiPost({ action: "order", ...order });
}

export function updateStatus(pin, id, status) {
  return apiPost({ action: "updateStatus", pin, id, status });
}

export function updateInventory(pin, item, available) {
  return apiPost({ action: "setInventory", pin, item, available });
}

export function clearCompleted(pin) {
  return apiPost({ action: "clearCompleted", pin });
}

export function clearAll(pin) {
  return apiPost({ action: "clearAll", pin });
}
