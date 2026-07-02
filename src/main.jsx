import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbzZondDOOrB3twVF7dScV02b4Mw2mrIEBf82g7BrcVLRmgBFjkt4uaWPlV27-PKq3Aymw/exec";
const DONATION_VENMO_URL = "https://account.venmo.com/u/HolyTransfiguration-OrthodoxCh";
const DONATION_ZELLE = "htacoc@gmail.com";

const DRINKS = [
  { id: "americano", label: "Americano", desc: "No milk, water only", temps: ["Hot", "Cold"], milk: false, syrups: true },
  { id: "latte", label: "Latte", desc: "Standard milk and coffee drink", temps: ["Hot", "Cold"], milk: true, syrups: true },
  { id: "cappuccino", label: "Cappuccino", desc: "More milk foam", temps: ["Hot", "Cold"], milk: true, syrups: true },
  { id: "cortado", label: "Cortado", desc: "More coffee forward, less milk", temps: ["Hot"], milk: true, syrups: true },
  { id: "espresso", label: "Double Shot Espresso", desc: "Pure espresso — no milk, water or syrup", temps: ["Hot"], milk: false, syrups: false },
  { id: "hotchoc", label: "Hot Chocolate", desc: "Rich hot chocolate", temps: ["Hot"], milk: true, syrups: false },
  { id: "coldchoc", label: "Cold Chocolate Milk", desc: "Chilled chocolate milk", temps: ["Cold"], milk: true, syrups: false },
];

const MILKS = ["Almond milk", "Oat milk", "Soy milk"];
const SYRUPS = ["Caramel", "Sugar Free Caramel", "Vanilla", "Sugar Free Vanilla", "Mocha", "White Chocolate", "Honey", "Cinnamon Powder", "Hazelnut"];
const MAX_SYRUPS = 3;

function getDrink(id) {
  return DRINKS.find(d => d.id === id) || DRINKS[1];
}

function defaultForm() {
  return { name: "", drinkId: "latte", temp: "Hot", milk: "", syrups: [], notes: "" };
}

function inventoryItemsByType(inventory, type, fallback) {
  const key = type + "s";
  const list = inventory?.[key];
  if (Array.isArray(list) && list.length) return list;
  return fallback.map(item => ({ item, type, available: true }));
}

function isInventoryAvailable(inventory, type, item) {
  const fallback = type === "milk" ? MILKS : SYRUPS;
  const found = inventoryItemsByType(inventory, type, fallback).find(x => x.item === item);
  return found ? found.available !== false : true;
}

async function apiGet(action, params = {}) {
  const url = new URL(BACKEND_URL);
  if (action) url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("t", Date.now());
  const res = await fetch(url.toString());
  return await res.json();
}

async function apiPost(payload) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

function statusLabel(status) {
  if (status === "making") return "Being made";
  if (status === "ready") return "Ready for pickup";
  if (status === "complete") return "Complete";
  return "Waiting";
}

function estimateWaitMinutes(position) {
  return Math.max(0, Math.max(0, position - 1) * 3);
}

function waitText(position) {
  const ahead = Math.max(0, position - 1);

  if (ahead === 0) return "You're up next";

  const minutes = ahead * 4;

  return `Estimated wait: ~${minutes} min`;
}

function ordersAheadText(position) {
  const ahead = Math.max(0, position - 1);
  if (ahead === 0) return "No orders ahead of you.";
  return `${ahead} order${ahead === 1 ? "" : "s"} ahead of you.`;
}

function statusEmoji(status) {
  if (status === "making") return "🟠";
  if (status === "ready") return "🟢";
  if (status === "complete") return "✅";
  return "🟡";
}

function normalizeOrderFromSingle(order) {
  if (!order) return null;
  return {
    ...order,
    syrups: Array.isArray(order.syrups) ? order.syrups.join(", ") : order.syrups
  };
}

function ringReadyAlert() {
  try {
    if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
  } catch {}

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(740, ctx.currentTime);
    osc.frequency.setValueAtTime(980, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
}

function Header({ isOpen, statusText }) {
  return (
    <header>
      <a className="brand" href="/">
        <span>☕</span>
        <div><h1>Arise Coffee</h1><p>Fresh Coffee • Fast Pickup</p></div>
      </a>
      <div className={isOpen ? "pill open" : "pill closed"}>{statusText || (isOpen ? "● Open" : "● Closed")}</div>
      <a className="adminLink" href="/admin">Admin</a>
    </header>
  );
}

function PinGate({ onSuccess }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function tryPin(value) {
    if (value.length < 4) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiPost({ action: "admin", pin: value });
      if (result.ok) onSuccess(value);
      else {
        setError("Wrong PIN");
        setPin("");
      }
    } catch {
      setError("Connection error");
      setPin("");
    }
    setBusy(false);
  }

  return (
    <main className="pinPage">
      <div className="modal pinModal static">
        <h2>Admin Access</h2>
        <p>Enter the PIN from the Settings tab.</p>
        <div className="pinDots">{[0,1,2,3].map(i => <span key={i} className={pin.length > i ? "filled" : ""} />)}</div>
        {error && <div className="errorText">{error}</div>}
        {busy && <div className="muted small">Checking…</div>}
        <div className="numpad">
          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k, i) => (
            <button key={i} disabled={busy || k === ""} className={k === "" ? "hiddenKey" : ""} onClick={() => {
              if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
              const next = pin + k;
              setPin(next);
              tryPin(next);
            }}>{k}</button>
          ))}
        </div>
      </div>
    </main>
  );
}

function AdminPage() {
  const [pin, setPin] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState({ syrups: [], milks: [] });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const data = await apiGet("orders");
      if (data.ok) {
        setIsOpen(Boolean(data.isOpen));
        setMessage(data.message || "");
        setOrders(data.orders || []);
        if (data.inventory) setInventory(data.inventory);
      }
    } catch {}
  }

  useEffect(() => {
    if (!pin) return;
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [pin]);

  async function saveAdmin(payload) {
    setBusy(true);
    setNotice("");
    try {
      const data = await apiPost({ action: "admin", pin, ...payload });
      if (data.ok) {
        setNotice("Saved");
        await refresh();
      } else setNotice(data.error || "Could not save");
    } catch { setNotice("Connection error"); }
    setBusy(false);
  }

  async function updateStatus(orderId, status) {
    setBusy(true);
    try {
      const data = await apiPost({ action: "updateStatus", pin, id: orderId, status });
      if (data.ok) setOrders(data.orders || []);
      else alert(data.error || "Could not update order");
    } catch { alert("Connection error"); }
    setBusy(false);
  }

  async function toggleInventory(item, available) {
    setBusy(true);
    try {
      const data = await apiPost({ action: "setInventory", pin, item, available });
      if (data.ok) {
        setInventory(data.inventory || inventory);
        await refresh();
      } else {
        alert(data.error || "Could not update inventory");
      }
    } catch {
      alert("Connection error");
    }
    setBusy(false);
  }

  async function clearCompleted() {
    if (!confirm("Clear completed orders? They will move to Archive.")) return;
    const data = await apiPost({ action: "clearCompleted", pin });
    if (data.ok) setOrders(data.orders || []);
    else alert(data.error || "Could not clear completed");
  }

  async function clearAll() {
    if (isOpen) {
      alert("Close the queue first, then clear all.");
      return;
    }
    if (!confirm("Clear ALL active orders? They will move to Archive.")) return;
    const data = await apiPost({ action: "clearAll", pin });
    if (data.ok) setOrders(data.orders || []);
    else alert(data.error || "Could not clear all");
  }

  if (!pin) {
    return <>
      <Header isOpen={isOpen} statusText="Admin" />
      <PinGate onSuccess={p => { setPin(p); }} />
    </>;
  }

  const visibleOrders = orders.filter(o => o.status !== "complete");
  const completed = orders.filter(o => o.status === "complete");

  return (
    <>
      <Header isOpen={isOpen} />
      <main className="adminPage">
        <section className="adminTop">
          <div>
            <h2>Admin Control</h2>
            <p className="sub">Orders update from the Google Sheet.</p>
          </div>
          <button className="ghostBtn" onClick={() => { setPin(""); }}>Log out</button>
        </section>

        <section className="adminCard">
          <div>
            <div className="label">Queue Status</div>
            <div className={isOpen ? "statusOpen" : "statusClosed"}>{isOpen ? "● Open" : "● Closed"}</div>
          </div>
          <button disabled={busy} className={isOpen ? "dangerBtn" : "successBtn"} onClick={() => saveAdmin({ isOpen: !isOpen, message })}>
            {isOpen ? "Close Queue" : "Open Queue"}
          </button>
        </section>

        <section className="panel">
          <div className="label">Closed message</div>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} />
          <button className="primaryBtn" disabled={busy} onClick={() => saveAdmin({ isOpen, message })}>Save message</button>
          {notice && <div className="notice">{notice}</div>}
        </section>

        <section className="toolbar">
          <button className="ghostBtn" onClick={refresh}>Refresh</button>
          <button className="ghostBtn" onClick={clearCompleted}>Clear completed</button>
          <button className="dangerOutlineBtn" onClick={clearAll}>Clear all after close</button>
        </section>

        <section className="inventoryPanel">
          <h2>Syrup & Milk Inventory</h2>
          <p className="sub">Tap an item to mark it available or out of stock.</p>

          <div className="inventoryGroup">
            <div className="label">Syrups</div>
            <div className="inventoryGrid">
              {inventoryItemsByType(inventory, "syrup", SYRUPS).map(x => (
                <button
                  key={x.item}
                  disabled={busy}
                  className={x.available ? "inventoryToggle available" : "inventoryToggle out"}
                  onClick={() => toggleInventory(x.item, !x.available)}
                >
                  <span>{x.item}</span>
                  <strong>{x.available ? "Available" : "Out of stock"}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="inventoryGroup">
            <div className="label">Milks</div>
            <div className="inventoryGrid">
              {inventoryItemsByType(inventory, "milk", MILKS).map(x => (
                <button
                  key={x.item}
                  disabled={busy}
                  className={x.available ? "inventoryToggle available" : "inventoryToggle out"}
                  onClick={() => toggleInventory(x.item, !x.available)}
                >
                  <span>{x.item}</span>
                  <strong>{x.available ? "Available" : "Out of stock"}</strong>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="orders">
          <h2>Active Orders</h2>
          {visibleOrders.length === 0 ? <div className="empty smallEmpty">No active orders.</div> : visibleOrders.map((o, idx) => (
            <div className={"adminOrder " + o.status} key={o.id}>
              <div className="orderTop">
                <div className="orderNum">#{String(idx + 1).padStart(3, "0")}</div>
                <div>
                  <strong>{o.name}</strong>
                  <p>{o.temp} {o.drink}{o.milk ? ` · ${o.milk}` : ""}{o.syrups ? ` · ${o.syrups}` : ""}</p>
                  {o.notes && <em>"{o.notes}"</em>}
                </div>
                <span className={"statusBadge " + o.status}>{statusLabel(o.status)}</span>
              </div>
              <div className="adminActions">
                <button onClick={() => updateStatus(o.id, "waiting")}>Waiting</button>
                <button onClick={() => updateStatus(o.id, "making")}>Start Making</button>
                <button onClick={() => updateStatus(o.id, "ready")}>Mark Ready</button>
                <button onClick={() => updateStatus(o.id, "complete")}>Complete</button>
              </div>
            </div>
          ))}
        </section>

        {completed.length > 0 && <section className="orders">
          <h2>Completed</h2>
          {completed.map(o => <div className="completedOrder" key={o.id}>{o.name} — {o.drink}</div>)}
        </section>}
      </main>
    </>
  );
}


function DonationModal({ onClose }) {
  async function copyZelle() {
    try {
      await navigator.clipboard.writeText(DONATION_ZELLE);
      alert("Zelle email copied");
    } catch {
      alert("Zelle: " + DONATION_ZELLE);
    }
  }

  return (
    <div className="modalOverlay donationOverlay">
      <div className="donationModal">
        <div className="donationIcon">☕</div>
        <h2>Support HTC</h2>
        <p>
          Arise Coffee is free, but donations help support Holy Transfiguration Church.
          Thank you for helping keep this going.
        </p>

        <div className="donationActions">
          <a className="venmoBtn" href={DONATION_VENMO_URL} target="_blank" rel="noreferrer">
            Donate with Venmo
          </a>
          <button className="zelleBtn" onClick={copyZelle}>
            Zelle: {DONATION_ZELLE}
          </button>
        </div>

        <button className="plainBtn donationSkip" onClick={onClose}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

function CustomerPage() {
  const [form, setForm] = useState(() => {
    const savedName = localStorage.getItem("arise-customer-name") || "";
    return { ...defaultForm(), name: savedName };
  });
  const [errors, setErrors] = useState({});
  const [isOpen, setIsOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState({ syrups: [], milks: [] });
  const [myOrderId, setMyOrderId] = useState(localStorage.getItem("coffee-my-order-id") || "");
  const [myOrder, setMyOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [readyAlertShown, setReadyAlertShown] = useState(false);
  const previousStatusRef = useRef("");
  const nameRef = useRef(null);

  const drink = getDrink(form.drinkId);

  async function refresh() {
    try {
      if (myOrderId) {
        const single = await apiGet("order", { id: myOrderId });
        if (typeof single.isOpen === "boolean") setIsOpen(Boolean(single.isOpen));
        if (single.inventory) setInventory(single.inventory);

        const found = normalizeOrderFromSingle(single.order);
        if (found) {
          setMyOrder(found);

          if (found.status === "ready" && previousStatusRef.current !== "ready" && !readyAlertShown) {
            ringReadyAlert();
            setReadyAlertShown(true);
          }

          previousStatusRef.current = found.status;
        } else {
          setMyOrder(null);
        }

        try {
          const queueData = await apiGet("orders");
          if (queueData.ok) {
            setOrders(queueData.orders || []);
            if (typeof queueData.isOpen === "boolean") setIsOpen(Boolean(queueData.isOpen));
          }
        } catch {}

        return;
      }

      const data = await apiGet("orders");
      if (data.ok) {
        setIsOpen(Boolean(data.isOpen));
        setMessage(data.message || "");
        setOrders(data.orders || []);
        if (data.inventory) setInventory(data.inventory);
      }
    } catch {}
  }

  async function refreshInventoryOnly() {
    try {
      const data = await apiGet("inventory");
      if (data.ok && data.inventory) setInventory(data.inventory);
    } catch {}
  }

  async function refreshStatusOnly() {
    try {
      const data = await apiGet();
      if (data.ok) {
        setIsOpen(Boolean(data.isOpen));
        setMessage(data.message || "");
      }
    } catch {}
  }

  useEffect(() => {
    refresh();

    const orderRefreshMs = myOrderId ? 5000 : 8000;
    const orderId = setInterval(refresh, orderRefreshMs);
    const inventoryId = setInterval(refreshInventoryOnly, 60000);
    const statusId = setInterval(refreshStatusOnly, 15000);

    return () => {
      clearInterval(orderId);
      clearInterval(inventoryId);
      clearInterval(statusId);
    };
  }, [myOrderId]);

  useEffect(() => {
    const d = getDrink(form.drinkId);
    setForm(f => ({ ...f, temp: d.temps[0], milk: "", syrups: [] }));
    setErrors({});
  }, [form.drinkId]);

  function toggleSyrup(s) {
    setForm(f => {
      if (f.syrups.includes(s)) return { ...f, syrups: f.syrups.filter(x => x !== s) };
      if (f.syrups.length >= MAX_SYRUPS) return f;
      return { ...f, syrups: [...f.syrups, s] };
    });
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "Please enter your name";
    if (drink.milk && !form.milk) e.milk = "Please choose a milk";
    if (form.milk && !isInventoryAvailable(inventory, "milk", form.milk)) e.milk = form.milk + " is out of stock";
    const outSyrup = form.syrups.find(s => !isInventoryAvailable(inventory, "syrup", s));
    if (outSyrup) e.syrups = outSyrup + " is out of stock";
    return e;
  }

  async function submit() {
    await refresh();
    if (!isOpen) return;

    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      if (e.name) nameRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const data = await apiPost({
        action: "order",
        name: form.name.trim(),
        drink: drink.label,
        drinkId: form.drinkId,
        temp: form.temp,
        milk: form.milk,
        syrups: form.syrups,
        notes: form.notes,
      });

      if (!data.ok) {
        alert(data.error || "Could not place order");
        await refresh();
        setBusy(false);
        return;
      }

      localStorage.setItem("arise-customer-name", form.name.trim());
      localStorage.setItem("coffee-my-order-id", data.id);
      setReadyAlertShown(false);
      previousStatusRef.current = "waiting";
      setMyOrderId(data.id);
      setMyOrder({
        id: data.id,
        name: form.name.trim(),
        drink: drink.label,
        temp: form.temp,
        milk: form.milk,
        syrups: form.syrups.join(", "),
        notes: form.notes,
        status: "waiting"
      });
      setForm(defaultForm());
      setShowDonation(true);
      await refresh();
    } catch {
      alert("Connection error. Try again.");
    }
    setBusy(false);
  }

  function clearMyTicket() {
    localStorage.removeItem("coffee-my-order-id");
    setMyOrderId("");
    setMyOrder(null);
  }

  const lbl = (text, hint) => <div className="label">{text}{hint && <span> {hint}</span>}</div>;

  if (!isOpen && !myOrder) {
    return <>
      <Header isOpen={isOpen} />
      <main className="closedPage">
        <div className="closedIcon">🚫</div>
        <h1>We're closed</h1>
        <p>{message || "Orders aren't being taken right now. Check back soon!"}</p>
        <button className="ghostBtn" onClick={refresh}>Refresh status</button>
      </main>
    </>;
  }

  return (
    <>
      <Header isOpen={isOpen} />
      <main className="layout">
        <section className="formCol">

          <h2>Place your order</h2>
          <p className="sub">{isOpen ? "We'll hold your spot in line." : "Queue is closed, but your current order status still updates."}</p>

          {isOpen && (
            <>
              <div className="field">
                {lbl("Your name")}
                <input ref={nameRef} value={form.name} onChange={e => { setForm(f => ({...f, name: e.target.value})); setErrors(er => ({...er, name: ""})); }} placeholder="e.g. Alex" />
                {errors.name && <div className="errorText">{errors.name}</div>}
              </div>

              <div className="field">
                {lbl("Drink")}
                <div className="drinkList">
                  {DRINKS.map(d => <button key={d.id} className={form.drinkId === d.id ? "drink active" : "drink"} onClick={() => setForm(f => ({...f, drinkId: d.id}))}><strong>{d.label}</strong><span>{d.desc}</span></button>)}
                </div>
              </div>

              {drink.temps.length > 1 ? (
                <div className="field">
                  {lbl("Temperature")}
                  <div className="row">{drink.temps.map(t => <button key={t} className={form.temp === t ? "choice active" : "choice"} onClick={() => setForm(f => ({...f, temp: t}))}>{t === "Hot" ? "🔥 Hot" : "🧊 Cold"}</button>)}</div>
                </div>
              ) : <div className="servedOnly">{drink.temps[0] === "Hot" ? "🔥" : "🧊"} Served <strong>{drink.temps[0].toLowerCase()}</strong> only</div>}

              {drink.milk && <div className="field">
                {lbl("Milk", "(required)")}
                <div className="row wrap">{inventoryItemsByType(inventory, "milk", MILKS).map(m => (
                  <button
                    key={m.item}
                    disabled={!m.available}
                    className={(form.milk === m.item ? "choice active" : "choice") + (!m.available ? " outOfStock" : "")}
                    onClick={() => {
                      if (!m.available) return;
                      setForm(f => ({...f, milk: m.item}));
                      setErrors(er => ({...er, milk: ""}));
                    }}
                  >
                    {m.item}{!m.available ? " — Out of stock" : ""}
                  </button>
                ))}</div>
                {errors.milk && <div className="errorText">{errors.milk}</div>}
              </div>}

              {drink.syrups && <div className="field">
                {lbl("Syrup", `— pick up to ${MAX_SYRUPS}`)}
                <div className="syrups">{inventoryItemsByType(inventory, "syrup", SYRUPS).map(s => {
                  const selected = form.syrups.includes(s.item);
                  const out = !s.available;
                  const maxed = !selected && form.syrups.length >= MAX_SYRUPS;
                  return (
                    <button
                      key={s.item}
                      disabled={out || maxed}
                      className={(selected ? "syrup active" : "syrup") + (out ? " outOfStock" : "")}
                      onClick={() => !out && toggleSyrup(s.item)}
                    >
                      {selected ? "✓ " : ""}{s.item}{out ? " — Out of stock" : ""}
                    </button>
                  );
                })}</div>
                <div className="muted small">{form.syrups.length === 0 ? "None selected — no syrup will be added" : `${form.syrups.length}/${MAX_SYRUPS} selected`}</div>
                {errors.syrups && <div className="errorText">{errors.syrups}</div>}
              </div>}

              {!drink.syrups && !drink.milk && <div className="servedOnly">☕ Pure espresso — no milk, water or syrup added</div>}

              <div className="field">
                {lbl("Notes", "(optional)")}
                <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} placeholder="Any special requests?" />
              </div>

              <button disabled={busy} className="joinBtn" onClick={submit}>{busy ? "Sending…" : "Join the Queue →"}</button>
            </>
          )}
        </section>

        <section className="queueCol privateStatusCol">
          <h2>Order Status</h2>
          <p className="sub">This screen only shows your order.</p>

          {!myOrder ? (
            <div className="empty privateEmpty">
              <div>☕</div>
              <p>Place an order and your live status will appear here.</p>
            </div>
          ) : (() => {
            const currentPosition = Math.max(1, orders.findIndex(o => o.id === myOrder.id) + 1);
            return (
              <div className={"customerStatusCard " + myOrder.status}>
                <div className="statusHero">
                  <span>{statusEmoji(myOrder.status)}</span>
                  <div>
                    <div className="label gold">Your Order</div>
                    <h3>#{String(currentPosition).padStart(3, "0")}</h3>
                  </div>
                </div>

                <div className="statusBig">{statusLabel(myOrder.status)}</div>

                <div className="customerDrinkSummary">
                  <strong>{myOrder.temp} {myOrder.drink}</strong>
                  <p>{myOrder.milk ? myOrder.milk : "No milk"}{myOrder.syrups ? ` · ${myOrder.syrups}` : ""}</p>
                  {myOrder.notes && <em>"{myOrder.notes}"</em>}
                </div>

                <div className="progressRail">
                  <div className={["waiting","making","ready","complete"].includes(myOrder.status) ? "progressStep done" : "progressStep"}>
                    <span>✓</span>
                    <p>Received</p>
                  </div>
                  <div className={["making","ready","complete"].includes(myOrder.status) ? "progressStep done" : "progressStep"}>
                    <span>{["making","ready","complete"].includes(myOrder.status) ? "✓" : "○"}</span>
                    <p>Making</p>
                  </div>
                  <div className={["ready","complete"].includes(myOrder.status) ? "progressStep done" : "progressStep"}>
                    <span>{["ready","complete"].includes(myOrder.status) ? "✓" : "○"}</span>
                    <p>Ready</p>
                  </div>
                </div>

                {myOrder.status === "waiting" && (
                  <div className="etaBox">
                    <strong>{waitText(currentPosition)}</strong>
                    <span>{ordersAheadText(currentPosition)}</span>
                    <small>Wait times are estimates and may vary.</small>
                  </div>
                )}

                {myOrder.status === "making" && <div className="makingNotice">Your drink is being prepared now.</div>}
                {myOrder.status === "ready" && <div className="readyNotice">🔔 Your drink is ready for pickup.</div>}

                {myOrder.status === "complete" && (
                  <div className="completeBox">
                    <strong>Thanks for supporting Arise Coffee!</strong>
                    <p>See you next time ☕</p>
                    <button className="ghostBtn" onClick={clearMyTicket}>Place another order</button>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      </main>
      {showDonation && <DonationModal onClose={() => setShowDonation(false)} />}
    </>
  );
}

function App() {
  const path = window.location.pathname.toLowerCase();
  return path.startsWith("/admin") ? <AdminPage /> : <CustomerPage />;
}

createRoot(document.getElementById("root")).render(<App />);
