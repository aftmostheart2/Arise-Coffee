import { supabase } from "../supabaseClient";

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

export function getPushDeviceHint() {
  const ua = navigator.userAgent || "";
  const isAppleTouchDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches;

  if (isAppleTouchDevice && !isStandalone) {
    return "iPhone/iPad: for ready notifications on future orders, tap Share, Add to Home Screen, then open Arise! Coffee from there.";
  }

  return "";
}

export function getPushSupportStatus() {
  if (!("serviceWorker" in navigator)) return { ok: false, reason: "Notifications are not supported in this browser." };
  if (!("PushManager" in window)) return { ok: false, reason: "Push notifications are not supported in this browser." };
  if (!("Notification" in window)) return { ok: false, reason: "Notifications are not supported in this browser." };
  if (!vapidPublicKey) return { ok: false, reason: "Notifications are not configured yet." };
  if (Notification.permission === "denied") return { ok: false, reason: "Notifications are blocked for this site." };
  return { ok: true, reason: "" };
}

export async function subscribeToReadyNotification({ orderId, customerName, orderName }) {
  const support = getPushSupportStatus();
  if (!support.ok) return { ok: false, error: support.reason };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: permission === "denied" ? "Notifications are blocked for this site." : "Notifications were not enabled." };
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const subscriptionJson = subscription.toJSON();
  const endpoint = subscription.endpoint;
  const p256dh = subscriptionJson.keys?.p256dh;
  const auth = subscriptionJson.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, error: "Could not create a push subscription." };
  }

  const { error } = await supabase.from("push_subscriptions").upsert({
    order_id: String(orderId),
    endpoint,
    p256dh,
    auth,
    customer_name: customerName || "",
    order_name: orderName || "",
    user_agent: navigator.userAgent || "",
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) return { ok: false, error: error.message || "Could not save notification subscription." };
  return { ok: true };
}

export async function sendReadyNotification(orderId, pin) {
  const { data, error } = await supabase.functions.invoke("send-ready-push", {
    body: { orderId: String(orderId || ""), pin: String(pin || "") },
  });

  if (error) return { ok: false, error: error.message || "Could not send notification." };
  return data || { ok: true };
}
