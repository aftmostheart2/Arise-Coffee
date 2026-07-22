# Web Push Notifications Setup

This app uses standards-based Web Push:

- `public/sw.js` receives notifications.
- `VITE_VAPID_PUBLIC_KEY` is safe to expose to the browser.
- `VAPID_PRIVATE_KEY` must only be stored as a Supabase Edge Function secret.
- Subscriptions are stored in `push_subscriptions` and tied to one `order_id`.
- The Edge Function removes expired push endpoints when providers return `404` or `410`.

## 1. Generate VAPID Keys

From any machine with Node installed:

```bash
npx web-push generate-vapid-keys
```

You will get:

```text
Public Key:  <public key>
Private Key: <private key>
```

## 2. Add Vercel Environment Variable

Add this to Vercel:

```text
VITE_VAPID_PUBLIC_KEY=<public key>
```

Redeploy Vercel after adding it.

## 3. Run Supabase SQL

Run the updated `supabase/schema.sql` in the Supabase SQL Editor.

This creates:

```text
push_subscriptions
delete_expired_push_subscription()
cleanup_old_push_subscriptions()
```

## 4. Set Supabase Edge Function Secrets

In Supabase CLI:

```bash
supabase secrets set VAPID_PUBLIC_KEY="<public key>"
supabase secrets set VAPID_PRIVATE_KEY="<private key>"
supabase secrets set VAPID_SUBJECT="mailto:you@example.com"
```

Use a real email address for `VAPID_SUBJECT`.

## 5. Deploy The Edge Function

```bash
supabase functions deploy send-ready-push
```

## 6. How It Works

After a customer places an order, they can press:

```text
Notify me when my order is ready
```

The browser asks for notification permission only then.

When an admin presses `Ready for Pickup`, the app calls the Supabase Edge Function. The function verifies the admin PIN, sends the push notification, and deletes that order's subscriptions afterward. It also deletes expired subscriptions automatically when providers return `404` or `410`.

For monthly cleanup, run this in Supabase SQL Editor:

```sql
select cleanup_old_push_subscriptions(30);
```

## Browser Notes

- iPhone/Safari Web Push works only after the site is added to the Home Screen.
- Some browsers do not support Web Push. The app shows a message instead of breaking.
- If the customer blocks notifications, the app shows a blocked message and does not keep asking.
