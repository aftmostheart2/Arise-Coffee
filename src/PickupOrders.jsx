import React, { useEffect, useRef, useState } from "react";
import { apiPost } from "./api/backend";

export default function PickupOrders({ pin, refreshKey, delivery = false, onReadyCount }) {
  const [ready, setReady] = useState([]);
  const [collected, setCollected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const refreshing = useRef(false);
  const revision = useRef(0);

  function sync(data) {
    setReady(data.ready || []);
    if (onReadyCount) onReadyCount((data.ready || []).filter(order => (order.fulfillmentType === "delivery") === delivery).length);
    setCollected(data.collected || []);
    setLoaded(true);
  }

  async function refresh() {
    if (pending.current || refreshing.current) return;
    refreshing.current = true;
    const requestedRevision = revision.current;
    try {
      const data = await apiPost({ action: "pickupAdmin", pin });
      if (requestedRevision !== revision.current) return;
      if (data.ok) { sync(data); setError(""); }
      else setError(data.error || "Could not load pickups.");
    } catch { if (requestedRevision === revision.current) setError("Connection error. Please refresh the pickup list."); }
    finally { refreshing.current = false; }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 3000);
    return () => clearInterval(id);
  }, [pin, refreshKey]);

  async function markCollected(order, pickedUp) {
    if (pending.current) return;
    pending.current = true;
    revision.current += 1;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiPost({ action: "updatePickup", pin, id: order.id, pickedUp });
      if (data.ok) {
        sync(data);
        setNotice(pickedUp ? `${order.name} marked ${delivery ? "delivered" : "picked up"}.` : `${order.name} is back on the ready list.`);
      } else setError(data.error || "Could not update pickup.");
    } catch { setError("Connection error. Please refresh before trying again."); }
    finally { pending.current = false; setBusy(false); }
  }

  const matches = order => (order.fulfillmentType === "delivery") === delivery;
  const pendingOrders = ready.filter(matches);
  const recentOrders = collected.filter(matches);
  return (
    <section className="pickupAdminSection" aria-labelledby={delivery ? "delivery-ready-title" : "pickup-ready-title"}>
      <div className="sectionHeader">
        <h2 id={delivery ? "delivery-ready-title" : "pickup-ready-title"}>{delivery ? "Ready for Delivery" : "Ready for Pickup"} ({pendingOrders.length})</h2>
        <button className="ghostBtn" disabled={busy} onClick={refresh}>Refresh list</button>
      </div>
      {error && <p className="errorText" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!loaded && !error && <p role="status">Loading ready orders...</p>}
      {loaded && pendingOrders.length === 0 && <p>No drinks waiting {delivery ? "for delivery" : "for pickup"}.</p>}
      {pendingOrders.map(order => (
        <div className="pickupAdminRow" key={order.id}>
          <div><strong>{order.name}</strong><p>{order.temp} {order.drink}{delivery && order.deliveryLocation ? ` · ${order.deliveryLocation}` : ""}</p></div>
          <button className="successBtn" disabled={busy} onClick={() => markCollected(order, true)}>{delivery ? "Mark delivered" : "Picked up"}</button>
        </div>
      ))}
      {recentOrders.length > 0 && <details className="pickupRecent">
        <summary>Awaiting final archive ({recentOrders.length})</summary>
        {recentOrders.map(order => (
          <div className="pickupAdminRow" key={order.id}>
            <div><strong>{order.name}</strong><p>{order.temp} {order.drink} · {order.pickedUpAt ? (delivery ? "Delivered" : "Picked up") : "30-minute auto archive"}</p></div>
            <button className="ghostBtn" disabled={busy} onClick={() => markCollected(order, false)}>Restore to ready</button>
          </div>
        ))}
      </details>}
    </section>
  );
}
