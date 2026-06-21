import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbzZondDOOrB3twVF7dScV02b4Mw2mrIEBf82g7BrcVLRmgBFjkt4uaWPlV27-PKq3Aymw/exec";

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

function Header({ isOpen, statusText }) {
  return (
    <header>
      <a className="brand" href="/">
        <span>☕</span>
        <div><h1>Arise Coffee</h1><p>Ordering System</p></div>
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
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const data = await apiGet("orders");
      if (data.ok) {
        setIsOpen(Boolean(data.isOpen));
        setMessage(data.message || "");
        setOrders(data.orders || []);
      }
    } catch {}
  }

  useEffect(() => {
    if (!pin) return;
    refresh();
    const id = setInterval(refresh, 5000);
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
                <button onClick={() => updateStatus(o.id, "making")}>Start</button>
                <button onClick={() => updateStatus(o.id, "ready")}>Ready</button>
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

function CustomerPage() {
  const [form, setForm] = useState(defaultForm());
  const [errors, setErrors] = useState({});
  const [isOpen, setIsOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [myOrderId, setMyOrderId] = useState(localStorage.getItem("coffee-my-order-id") || "");
  const [myOrder, setMyOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  const drink = getDrink(form.drinkId);

  async function refresh() {
    try {
      const data = await apiGet("orders");
      if (data.ok) {
        setIsOpen(Boolean(data.isOpen));
        setMessage(data.message || "");
        setOrders(data.orders || []);
        if (myOrderId) {
          const found = (data.orders || []).find(o => o.id === myOrderId);
          if (found) setMyOrder(found);
          else {
            const single = await apiGet("order", { id: myOrderId });
            setMyOrder(single.order || null);
          }
        }
      }
    } catch {}
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
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

      localStorage.setItem("coffee-my-order-id", data.id);
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
          {myOrder && (
            <div className={"myTicket " + myOrder.status}>
              <div className="label gold">Your Order</div>
              <div className="ticketLine">
                <div className="queueNumSmall">#{String(Math.max(1, orders.findIndex(o => o.id === myOrder.id) + 1)).padStart(3, "0")}</div>
                <div>
                  <strong>{statusLabel(myOrder.status)}</strong>
                  <p>{myOrder.temp} {myOrder.drink}{myOrder.milk ? ` · ${myOrder.milk}` : ""}{myOrder.syrups ? ` · ${myOrder.syrups}` : ""}</p>
                </div>
              </div>
              {myOrder.status === "ready" && <div className="readyNotice">Your drink is ready for pickup.</div>}
              {myOrder.status === "complete" && <button className="ghostBtn" onClick={clearMyTicket}>Clear my ticket</button>}
            </div>
          )}

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
                <div className="row wrap">{MILKS.map(m => <button key={m} className={form.milk === m ? "choice active" : "choice"} onClick={() => { setForm(f => ({...f, milk: m})); setErrors(er => ({...er, milk: ""})); }}>{m}</button>)}</div>
                {errors.milk && <div className="errorText">{errors.milk}</div>}
              </div>}

              {drink.syrups && <div className="field">
                {lbl("Syrup", `— pick up to ${MAX_SYRUPS}`)}
                <div className="syrups">{SYRUPS.map(s => {
                  const selected = form.syrups.includes(s);
                  const maxed = !selected && form.syrups.length >= MAX_SYRUPS;
                  return <button key={s} disabled={maxed} className={selected ? "syrup active" : "syrup"} onClick={() => toggleSyrup(s)}>{selected ? "✓ " : ""}{s}</button>
                })}</div>
                <div className="muted small">{form.syrups.length === 0 ? "None selected — no syrup will be added" : `${form.syrups.length}/${MAX_SYRUPS} selected`}</div>
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

        <section className="queueCol">
          <h2>Live Queue</h2>
          <p className="sub">{orders.length === 0 ? "No active orders." : `${orders.length} active order${orders.length > 1 ? "s" : ""}`}</p>
          {orders.length === 0 ? <div className="empty"><div>☕</div><p>The queue is empty.</p></div> : orders.map((o, idx) => (
            <div className={"queueItem " + o.status} key={o.id}>
              <div className="orderNum">#{String(idx + 1).padStart(3, "0")}</div>
              <div>
                <strong>{o.name}</strong>
                <p>{o.temp} {o.drink} · {statusLabel(o.status)}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}

function App() {
  const path = window.location.pathname.toLowerCase();
  return path.startsWith("/admin") ? <AdminPage /> : <CustomerPage />;
}

createRoot(document.getElementById("root")).render(<App />);
