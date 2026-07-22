import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PushSubscriptionRow = {
  id: string;
  order_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  customer_name: string | null;
  order_name: string | null;
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      return json({ ok: false, error: "Push notification secrets are not configured." }, 500);
    }

    const { orderId, pin } = await req.json().catch(() => ({ orderId: "", pin: "" }));
    if (!orderId) return json({ ok: false, error: "Missing orderId." }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: loginData, error: loginError } = await supabase.rpc("arise_login", { input_pin: String(pin || "") });
    if (loginError) return json({ ok: false, error: loginError.message }, 500);
    if (!loginData?.ok) return json({ ok: false, error: "Wrong PIN" }, 401);

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id, order_id, endpoint, p256dh, auth, customer_name, order_name")
      .eq("order_id", String(orderId));

    if (error) return json({ ok: false, error: error.message }, 500);

    const subscriptions = (data || []) as PushSubscriptionRow[];
    if (subscriptions.length === 0) return json({ ok: true, sent: 0, removed: 0 });

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    let sent = 0;
    let removed = 0;

    for (const row of subscriptions) {
      const name = row.customer_name?.trim();
      const orderName = row.order_name?.trim();
      const body = [
        name ? `${name}, your order is ready.` : "Your order is ready.",
        orderName ? `Order: ${orderName}` : "",
      ].filter(Boolean).join(" ");

      const payload = JSON.stringify({
        title: "Arise! Coffee",
        body,
        orderId: row.order_id,
        url: `/?order=${encodeURIComponent(row.order_id)}`,
      });

      try {
        await webpush.sendNotification({
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        }, payload);

        sent += 1;
        await supabase.from("push_subscriptions")
          .update({ last_sent_at: new Date().toISOString() })
          .eq("id", row.id);
      } catch (pushError) {
        const statusCode = Number((pushError as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.rpc("delete_expired_push_subscription", { input_endpoint: row.endpoint });
          removed += 1;
        } else {
          console.error("Push send failed", pushError);
        }
      }
    }

    return json({ ok: true, sent, removed });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Push notification failed." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
