import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { apiGet, apiPost } from "./api/backend";

const DONATION_VENMO_URL = "https://account.venmo.com/u/HolyTransfiguration-OrthodoxCh";
const DONATION_ZELLE = "htacoc@gmail.com";
const INVENTORY_CACHE_KEY = "arise-inventory-cache";
const INVENTORY_CACHE_MS = 5 * 60 * 1000;
const TEXT_SIZE_KEY = "arise-text-size";

const DRINKS = [
  { id: "americano", label: "Americano", desc: "No milk, water only", temps: ["Hot", "Cold"], milk: false, syrups: true },
  { id: "latte", label: "Latte", desc: "Standard milk and coffee drink", temps: ["Hot", "Cold"], milk: true, syrups: true },
  { id: "cappuccino", label: "Cappuccino", desc: "More milk foam", temps: ["Hot", "Cold"], milk: true, syrups: true },
  { id: "cortado", label: "Cortado", desc: "More coffee forward, less milk", temps: ["Hot"], milk: true, syrups: true },
  { id: "espresso", label: "Double Shot Espresso", desc: "Pure espresso — no milk, water or syrup", temps: ["Hot"], milk: false, syrups: false },
  { id: "hotchoc", label: "Hot Chocolate", desc: "Rich hot chocolate", temps: ["Hot"], milk: true, syrups: false },
  { id: "coldchoc", label: "Cold Chocolate Milk", desc: "Chilled chocolate milk", temps: ["Cold"], milk: true, syrups: false, showTemp: false },
];

const MILKS = ["Whole milk", "Almond milk", "Oat milk", "Soy milk"];
const SYRUPS = ["Caramel", "Sugar Free Caramel", "Vanilla", "Sugar Free Vanilla", "Mocha", "White Chocolate", "Honey", "Cinnamon Powder", "Hazelnut"];
const MAX_SYRUPS = 2;

function makeDrinkId(label) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `drink-${Date.now()}`;
}

function normalizeDrinkItem(drink, index = 0) {
  const temps = Array.isArray(drink?.temps) && drink.temps.length
    ? drink.temps.filter(t => t === "Hot" || t === "Cold")
    : ["Hot"];

  return {
    id: String(drink?.id || makeDrinkId(drink?.label || `Drink ${index + 1}`)),
    label: String(drink?.label || "Drink").trim() || "Drink",
    desc: String(drink?.desc || "").trim(),
    temps: temps.length ? [...new Set(temps)] : ["Hot"],
    milk: Boolean(drink?.milk),
    syrups: Boolean(drink?.syrups),
    showTemp: drink?.showTemp === false ? false : true,
    active: drink?.active !== false,
    sortOrder: Number.isFinite(Number(drink?.sortOrder)) ? Number(drink.sortOrder) : index,
  };
}

function normalizeMenuDrinks(drinks, includeInactive = false) {
  const source = Array.isArray(drinks) && drinks.length ? drinks : DRINKS;
  return source
    .map(normalizeDrinkItem)
    .filter(drink => includeInactive || drink.active !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

function makeIngredientId(item) {
  return String(item || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `item-${Date.now()}`;
}

function normalizeIngredientItem(item, type, index = 0) {
  const name = typeof item === "string" ? item : item?.item;
  return {
    id: String(item?.id || makeIngredientId(name || `${type}-${index + 1}`)),
    item: String(name || "").trim() || `${type === "milk" ? "Milk" : "Syrup"} ${index + 1}`,
    type,
    available: item?.available !== false,
    active: item?.active !== false,
    sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index,
  };
}

function normalizeIngredientList(items, type, fallback, includeInactive = false) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source
    .map((item, index) => normalizeIngredientItem(item, type, index))
    .filter(item => includeInactive || item.active !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.item.localeCompare(b.item));
}

function reorderItemsById(items, fromId, toId) {
  const fromIndex = items.findIndex(item => item.id === fromId);
  const toIndex = items.findIndex(item => item.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((item, sortOrder) => ({ ...item, sortOrder }));
}

function getDrink(id, drinks = DRINKS) {
  const normalized = normalizeMenuDrinks(drinks);
  return normalized.find(d => d.id === id) || normalized[0] || normalizeDrinkItem(DRINKS[1], 1);
}

function defaultForm() {
  return { name: "", drinkId: "latte", temp: "Hot", milk: "", syrups: [], notes: "" };
}

function defaultInventory() {
  return {
    syrups: SYRUPS.map(item => ({ item, type: "syrup", available: true })),
    milks: MILKS.map(item => ({ item, type: "milk", available: true }))
  };
}

function loadCachedInventory() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(INVENTORY_CACHE_KEY) || "null");
    if (cached?.inventory && Date.now() - cached.savedAt < INVENTORY_CACHE_MS) return cached.inventory;
  } catch {}
  return defaultInventory();
}

function cacheInventory(inventory) {
  try {
    sessionStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify({ inventory, savedAt: Date.now() }));
  } catch {}
  return inventory;
}

function inventoryItemsByType(inventory, type, fallback) {
  const key = type + "s";
  const list = inventory?.[key];
  return normalizeIngredientList(list, type, fallback);
}

function buildInventoryLookup(inventory) {
  const lookup = {};
  [...inventoryItemsByType(inventory, "syrup", SYRUPS), ...inventoryItemsByType(inventory, "milk", MILKS)].forEach(x => {
    lookup[x.item] = x.available !== false;
  });
  return lookup;
}

function isInventoryAvailable(inventoryLookup, item) {
  return inventoryLookup[item] !== false;
}

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function statusLabel(status) {
  if (status === "making") return "Being made";
  if (status === "ready") return "Ready for pickup";
  if (status === "complete") return "Ready for pickup";
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

function orderAgeText(time) {
  const startedAt = Date.parse(time);
  if (!Number.isFinite(startedAt)) return "";

  const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} hr ago`;
  return `${hours} hr ${remainingMinutes} min ago`;
}

function statusEmoji(status) {
  if (status === "making") return "🟠";
  if (status === "ready") return "🟢";
  if (status === "complete") return "🟢";
  return "🟡";
}

function normalizeOrderFromSingle(order) {
  if (!order) return null;
  const ordersAhead = Number(order.ordersAhead ?? order.ahead ?? NaN);
  const position = Number(order.position || order.queuePosition || 0) || (Number.isFinite(ordersAhead) ? ordersAhead + 1 : undefined);
  return {
    ...order,
    syrups: Array.isArray(order.syrups) ? order.syrups.join(", ") : order.syrups,
    position,
    ordersAhead
  };
}

function hasFirstAndLastName(name) {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

function formatUpdatedAt(value) {
  if (!value) return "Not updated yet";
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function TextSizeControl({ largeText, onChange }) {
  return (
    <button
      className={largeText ? "textSizeToggle active" : "textSizeToggle"}
      aria-pressed={largeText}
      title="Toggle larger text"
      onClick={() => onChange(!largeText)}
    >
      <span>Aa</span>
      {largeText ? "Large text" : "Text size"}
    </button>
  );
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
  const isAdminPage = window.location.pathname.toLowerCase().startsWith("/admin");
  return (
    <header>
      <a className="brand" href="/">
        <span>☕</span>
        <div><h1>Arise! Coffee</h1><p>Fresh Coffee • Fast Pickup</p></div>
      </a>
      {!isAdminPage && <a className="adminLink" href="/admin">Admin Access</a>}
      <div className={isOpen ? "pill open" : "pill closed"}>{statusText || (isOpen ? "● Open" : "● Closed")}</div>
    </header>
  );
}

function PinGate({ onSuccess }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function tryPin(value) {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiPost({ action: "login", pin: value });
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

  function addPinDigit(digit) {
    if (busy) return;
    setError("");
    setPin(current => {
      if (current.length >= 4) return current;
      const next = current + digit;
      tryPin(next);
      return next;
    });
  }

  function removePinDigit() {
    if (busy) return;
    setPin(current => current.slice(0, -1));
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        addPinDigit(event.key);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removePinDigit();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        tryPin(pin);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, busy]);

  return (
    <main className="pinPage">
      <div className="modal pinModal static">
        <h2>Admin Access</h2>
        <p>Enter the PIN from the Settings tab.</p>
        <div className="pinDots">{[0,1,2,3].map(i => <span key={i} className={pin.length > i ? "filled" : ""} />)}</div>
        {error && <div className="errorText">{error}</div>}
        {busy && <div className="checkingLine"><span className="miniSpinner"></span>Checking PIN…</div>}
        <div className="numpad">
          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k, i) => (
            <button key={i} disabled={busy || k === ""} className={k === "" ? "hiddenKey" : ""} onClick={() => {
              if (k === "⌫") {
                removePinDigit();
                return;
              }
              addPinDigit(String(k));
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
  const [archive, setArchive] = useState([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminView, setAdminView] = useState("dashboard");
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [menuDrinks, setMenuDrinks] = useState(() => normalizeMenuDrinks(DRINKS, true));
  const [menuMilks, setMenuMilks] = useState(() => normalizeIngredientList(null, "milk", MILKS, true));
  const [menuSyrups, setMenuSyrups] = useState(() => normalizeIngredientList(null, "syrup", SYRUPS, true));
  const [inventory, setInventory] = useState(loadCachedInventory);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [connectionOk, setConnectionOk] = useState(true);
  const [readyArchiveCount, setReadyArchiveCount] = useState(0);
  const [collapsedPanels, setCollapsedPanels] = useState({ inventory: false, orders: false });
  const ordersLoadingRef = useRef(false);
  const statusLoadingRef = useRef(false);
  const inventoryLoadingRef = useRef(false);
  const messageEditingRef = useRef(false);
  const adminSyrups = useMemo(() => inventoryItemsByType(inventory, "syrup", SYRUPS), [inventory]);
  const adminMilks = useMemo(() => inventoryItemsByType(inventory, "milk", MILKS), [inventory]);

  function syncAdminMessage(nextMessage) {
    if (!messageEditingRef.current && typeof nextMessage === "string") {
      setMessage(nextMessage || "");
    }
  }

  async function refreshOrders() {
    if (ordersLoadingRef.current) return;
    ordersLoadingRef.current = true;
    try {
      const data = await apiGet("orders");
      if (data.ok) {
        setOrders(data.orders || []);
        if (typeof data.isOpen === "boolean") setIsOpen(Boolean(data.isOpen));
        syncAdminMessage(data.message);
        setLastUpdated(new Date());
        setConnectionOk(true);
      } else {
        setConnectionOk(false);
      }
    } catch {
      setConnectionOk(false);
    } finally {
      ordersLoadingRef.current = false;
    }
  }

  async function refreshStatus() {
    if (statusLoadingRef.current) return;
    statusLoadingRef.current = true;
    try {
      const data = await apiGet("status");
      if (data.ok) {
        if (typeof data.isOpen === "boolean") setIsOpen(Boolean(data.isOpen));
        syncAdminMessage(data.message);
        setLastUpdated(new Date());
        setConnectionOk(true);
      } else {
        setConnectionOk(false);
      }
    } catch {
      setConnectionOk(false);
    } finally {
      statusLoadingRef.current = false;
    }
  }

  async function refreshInventory() {
    if (inventoryLoadingRef.current) return;
    inventoryLoadingRef.current = true;
    try {
      const data = await apiGet("inventory");
      if (data.ok && data.inventory) setInventory(cacheInventory(data.inventory));
    } catch {
    } finally {
      inventoryLoadingRef.current = false;
    }
  }

  async function refreshAdminData() {
    await Promise.all([refreshOrders(), refreshStatus(), refreshInventory()]);
  }

  useEffect(() => {
    if (!pin) return;
    refreshAdminData();
    const ordersId = setInterval(() => {
      if (isPageVisible()) refreshOrders();
    }, 3000);
    const statusId = setInterval(() => {
      if (isPageVisible()) refreshStatus();
    }, 6000);
    const inventoryId = setInterval(() => {
      if (isPageVisible()) refreshInventory();
    }, 60000);

    function refreshWhenVisible() {
      if (isPageVisible()) refreshAdminData();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(ordersId);
      clearInterval(statusId);
      clearInterval(inventoryId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [pin]);

  async function saveAdmin(payload) {
    setBusy(true);
    setNotice("");
    try {
      const data = await apiPost({ action: "admin", pin, ...payload });
      if (data.ok) {
        setNotice("Saved");
        messageEditingRef.current = false;
        if (typeof data.isOpen === "boolean") setIsOpen(Boolean(data.isOpen));
        if (typeof data.message === "string") setMessage(data.message || "");
        if (Array.isArray(data.orders)) setOrders(data.orders);
        setLastUpdated(new Date());
        setConnectionOk(true);
      } else setNotice(data.error || "Could not save");
    } catch { setNotice("Connection error"); setConnectionOk(false); }
    setBusy(false);
  }

  async function updateStatus(orderId, status) {
    setBusy(true);
    try {
      const data = await apiPost({ action: "updateStatus", pin, id: orderId, status });
      if (data.ok) {
        if (status === "complete") {
          setOrders(current => current.filter(o => o.id !== orderId));
          setReadyArchiveCount(count => count + 1);
        } else if (data.order) {
          setOrders(current => {
            const exists = current.some(o => o.id === data.order.id);
            return exists ? current.map(o => o.id === data.order.id ? data.order : o) : [...current, data.order];
          });
        } else {
          setOrders(data.orders || []);
        }
        setLastUpdated(new Date());
        setConnectionOk(true);
      }
      else alert(data.error || "Could not update order");
    } catch { alert("Connection error"); setConnectionOk(false); }
    setBusy(false);
  }

  async function toggleInventory(item, available) {
    setBusy(true);
    try {
      const data = await apiPost({ action: "setInventory", pin, item, available });
      if (data.ok) {
        setInventory(data.inventory ? cacheInventory(data.inventory) : inventory);
      } else {
        alert(data.error || "Could not update inventory");
      }
    } catch {
      alert("Connection error");
    }
    setBusy(false);
  }

  async function clearCompleted() {
    if (!confirm("Archive ready orders? They will move to Archive.")) return;
    const data = await apiPost({ action: "clearCompleted", pin });
    if (data.ok) {
      setOrders(data.orders || []);
      setReadyArchiveCount(0);
      setLastUpdated(new Date());
      setConnectionOk(true);
    }
    else alert(data.error || "Could not archive ready orders");
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

  async function loadArchive() {
    setArchiveBusy(true);
    try {
      const data = await apiPost({ action: "archive", pin });
      if (data.ok) {
        setArchive(data.archive || []);
        setArchiveLoaded(true);
      } else {
        alert(data.error || "Could not load archive");
      }
    } catch {
      alert("Connection error");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function toggleArchive() {
    setArchiveOpen(true);
    setAdminView("archive");
    if (!archiveLoaded) await loadArchive();
  }

  async function clearArchive() {
    if (!confirm("Clear archive? This permanently deletes archived orders.")) return;
    setArchiveBusy(true);
    try {
      const data = await apiPost({ action: "clearArchive", pin });
      if (data.ok) {
        setArchive([]);
        setArchiveLoaded(true);
      } else {
        alert(data.error || "Could not clear archive");
      }
    } catch {
      alert("Connection error");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function loadAnalytics() {
    setAnalyticsBusy(true);
    try {
      const data = await apiPost({ action: "analytics", pin });
      if (data.ok) {
        setAnalytics(data.analytics || null);
        setAnalyticsLoaded(true);
      } else {
        alert(data.error || "Could not load analytics");
      }
    } catch {
      alert("Connection error");
    } finally {
      setAnalyticsBusy(false);
    }
  }

  async function toggleAnalytics() {
    setAnalyticsOpen(true);
    setAdminView("analytics");
    if (!analyticsLoaded) await loadAnalytics();
  }

  async function loadMenu() {
    setMenuBusy(true);
    try {
      const data = await apiGet("menu", { pin });
      if (data.ok && Array.isArray(data.drinks)) {
        setMenuDrinks(normalizeMenuDrinks(data.drinks, true));
        setMenuMilks(normalizeIngredientList(data.milks, "milk", MILKS, true));
        setMenuSyrups(normalizeIngredientList(data.syrups, "syrup", SYRUPS, true));
        setMenuLoaded(true);
      } else if (!menuLoaded) {
        setMenuDrinks(normalizeMenuDrinks(DRINKS, true));
        setMenuMilks(normalizeIngredientList(null, "milk", MILKS, true));
        setMenuSyrups(normalizeIngredientList(null, "syrup", SYRUPS, true));
      }
    } catch {
      if (!menuLoaded) {
        setMenuDrinks(normalizeMenuDrinks(DRINKS, true));
        setMenuMilks(normalizeIngredientList(null, "milk", MILKS, true));
        setMenuSyrups(normalizeIngredientList(null, "syrup", SYRUPS, true));
      }
    } finally {
      setMenuBusy(false);
    }
  }

  async function openMenuScreen() {
    setMenuOpen(true);
    setAdminView("menu");
    if (!menuLoaded) await loadMenu();
  }

  function updateMenuDrink(id, patch) {
    setMenuDrinks(current => current.map(drink => drink.id === id ? normalizeDrinkItem({ ...drink, ...patch }, drink.sortOrder) : drink));
  }

  function addMenuDrink() {
    const nextIndex = menuDrinks.length;
    const id = makeDrinkId(`Custom Drink ${Date.now()}`);
    setMenuDrinks(current => [...current, normalizeDrinkItem({
      id,
      label: "New Drink",
      desc: "",
      temps: ["Hot", "Cold"],
      milk: true,
      syrups: true,
      showTemp: true,
      active: true,
      sortOrder: nextIndex,
    }, nextIndex)]);
  }

  function removeMenuDrink(id) {
    if (menuDrinks.length <= 1) {
      alert("Keep at least one drink on the menu.");
      return;
    }
    setMenuDrinks(current => current.filter(drink => drink.id !== id).map((drink, index) => ({ ...drink, sortOrder: index })));
  }

  function moveMenuDrink(id, direction) {
    setMenuDrinks(current => {
      const next = [...current];
      const index = next.findIndex(drink => drink.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((drink, sortOrder) => ({ ...drink, sortOrder }));
    });
  }

  function reorderMenuDrink(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    setMenuDrinks(current => reorderItemsById(current, fromId, toId));
  }

  function updateMenuIngredient(type, id, patch) {
    const setter = type === "milk" ? setMenuMilks : setMenuSyrups;
    setter(current => current.map(item => item.id === id ? normalizeIngredientItem({ ...item, ...patch }, type, item.sortOrder) : item));
  }

  function addMenuIngredient(type) {
    const setter = type === "milk" ? setMenuMilks : setMenuSyrups;
    const label = type === "milk" ? "New milk" : "New syrup";
    setter(current => [...current, normalizeIngredientItem({
      id: makeIngredientId(`${label}-${Date.now()}`),
      item: label,
      type,
      available: true,
      active: true,
      sortOrder: current.length,
    }, type, current.length)]);
  }

  function removeMenuIngredient(type, id) {
    const setter = type === "milk" ? setMenuMilks : setMenuSyrups;
    setter(current => {
      if (current.length <= 1) {
        alert(`Keep at least one ${type === "milk" ? "milk" : "syrup"} item.`);
        return current;
      }
      return current.filter(item => item.id !== id).map((item, index) => ({ ...item, sortOrder: index }));
    });
  }

  function moveMenuIngredient(type, id, direction) {
    const setter = type === "milk" ? setMenuMilks : setMenuSyrups;
    setter(current => {
      const next = [...current];
      const index = next.findIndex(item => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, sortOrder) => ({ ...item, sortOrder }));
    });
  }

  function reorderMenuIngredient(type, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const setter = type === "milk" ? setMenuMilks : setMenuSyrups;
    setter(current => reorderItemsById(current, fromId, toId));
  }

  async function saveMenuDrinks() {
    const cleaned = normalizeMenuDrinks(menuDrinks, true).map((drink, index) => ({ ...drink, sortOrder: index }));
    const cleanedMilks = normalizeIngredientList(menuMilks, "milk", MILKS, true).map((item, index) => ({ ...item, sortOrder: index }));
    const cleanedSyrups = normalizeIngredientList(menuSyrups, "syrup", SYRUPS, true).map((item, index) => ({ ...item, sortOrder: index }));
    if (cleaned.some(drink => !drink.label.trim())) {
      alert("Every drink needs a name.");
      return;
    }
    if ([...cleanedMilks, ...cleanedSyrups].some(item => !item.item.trim())) {
      alert("Every milk and syrup needs a name.");
      return;
    }
    if (!cleaned.some(drink => drink.active)) {
      alert("Keep at least one active drink.");
      return;
    }

    setMenuBusy(true);
    try {
      const data = await apiPost({ action: "saveMenu", pin, drinks: cleaned, milks: cleanedMilks, syrups: cleanedSyrups });
      if (data.ok) {
        setMenuDrinks(normalizeMenuDrinks(data.drinks || cleaned, true));
        setMenuMilks(normalizeIngredientList(data.milks || cleanedMilks, "milk", MILKS, true));
        setMenuSyrups(normalizeIngredientList(data.syrups || cleanedSyrups, "syrup", SYRUPS, true));
        setMenuLoaded(true);
        setInventory(cacheInventory({
          milks: normalizeIngredientList(data.milks || cleanedMilks, "milk", MILKS, true),
          syrups: normalizeIngredientList(data.syrups || cleanedSyrups, "syrup", SYRUPS, true),
        }));
        setNotice("Menu saved");
      } else {
        alert(data.error || "Could not save menu");
      }
    } catch {
      alert("Connection error");
    } finally {
      setMenuBusy(false);
    }
  }

  function togglePanel(panel) {
    setCollapsedPanels(current => ({ ...current, [panel]: !current[panel] }));
  }

  if (!pin) {
    return <>
      <Header isOpen={isOpen} statusText="Admin" />
      <PinGate onSuccess={p => { setPin(p); }} />
    </>;
  }

  const visibleOrders = orders.filter(o => o.status !== "complete");

  if (adminView === "menu") {
    return (
      <>
        <Header isOpen={isOpen} />
        <main className="adminPage">
          <section className="adminTop">
            <div>
              <h2>Menu</h2>
              <p className="sub">Add drinks and control what customers can order.</p>
            </div>
            <button className="ghostBtn" onClick={() => { setMenuOpen(false); setAdminView("dashboard"); }}>Back to dashboard</button>
          </section>

          <MenuEditor
            drinks={menuDrinks}
            milks={menuMilks}
            syrups={menuSyrups}
            busy={menuBusy}
            onAdd={addMenuDrink}
            onAddIngredient={addMenuIngredient}
            onRefresh={loadMenu}
            onSave={saveMenuDrinks}
            onRemove={removeMenuDrink}
            onRemoveIngredient={removeMenuIngredient}
            onMove={moveMenuDrink}
            onMoveIngredient={moveMenuIngredient}
            onReorder={reorderMenuDrink}
            onReorderIngredient={reorderMenuIngredient}
            onUpdate={updateMenuDrink}
            onUpdateIngredient={updateMenuIngredient}
          />
        </main>
      </>
    );
  }

  if (adminView === "archive") {
    return (
      <>
        <Header isOpen={isOpen} />
        <main className="adminPage">
          <section className="adminTop">
            <div>
              <h2>Archive</h2>
              <p className="sub">Latest 25 archived orders.</p>
            </div>
            <div className="adminTopActions">
              <button className="ghostBtn" disabled={archiveBusy} onClick={loadArchive}>Refresh</button>
              <button className="ghostBtn" onClick={() => { setArchiveOpen(false); setAdminView("dashboard"); }}>Back to dashboard</button>
            </div>
          </section>

          <section className="archivePanel">
            <div className="archiveHeader">
              <div>
                <h2>Orders</h2>
                <p className="sub">Use this when you need to look back after the rush.</p>
              </div>
              <div className="archiveActions">
                <button className="dangerOutlineBtn" disabled={archiveBusy || archive.length === 0} onClick={clearArchive}>Clear archive</button>
              </div>
            </div>

            {archiveBusy ? (
              <div className="empty smallEmpty">Loading archive...</div>
            ) : archive.length === 0 ? (
              <div className="empty smallEmpty">No archived orders.</div>
            ) : (
              <div className="archiveList">
                {archive.map(item => (
                  <div className="archiveOrder" key={item.id}>
                    <div>
                      <strong>{item.name || "Unnamed order"}</strong>
                      <p>{item.temp} {item.drink}{item.milk ? ` · ${item.milk}` : ""}{item.syrups ? ` · ${item.syrups}` : ""}</p>
                      {item.notes && <em>"{item.notes}"</em>}
                    </div>
                    <span>{item.archivedAt ? new Date(item.archivedAt).toLocaleString() : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </>
    );
  }

  if (adminView === "analytics") {
    return (
      <>
        <Header isOpen={isOpen} />
        <main className="adminPage">
          <section className="adminTop">
            <div>
              <h2>Analytics</h2>
              <p className="sub">Popular items based on archived orders.</p>
            </div>
            <div className="adminTopActions">
              <button className="ghostBtn" disabled={analyticsBusy} onClick={loadAnalytics}>Refresh</button>
              <button className="ghostBtn" onClick={() => { setAnalyticsOpen(false); setAdminView("dashboard"); }}>Back to dashboard</button>
            </div>
          </section>

          <section className="analyticsPanel">
            {analyticsBusy ? (
              <div className="empty smallEmpty">Loading analytics...</div>
            ) : !analytics || Number(analytics.totalOrders || 0) === 0 ? (
              <div className="empty smallEmpty">No archived orders to analyze.</div>
            ) : (
              <>
                <div className="analyticsSummary">
                  <div>
                    <span>Total orders</span>
                    <strong>{analytics.totalOrders || 0}</strong>
                  </div>
                  <div>
                    <span>Hot</span>
                    <strong>{analytics.hotOrders || 0}</strong>
                  </div>
                  <div>
                    <span>Cold</span>
                    <strong>{analytics.coldOrders || 0}</strong>
                  </div>
                </div>

                <div className="analyticsGrid">
                  <AnalyticsList title="Top Drinks" items={analytics.topDrinks || []} />
                  <AnalyticsList title="Top Milks" items={analytics.topMilks || []} />
                  <AnalyticsList title="Top Syrups" items={analytics.topSyrups || []} />
                </div>
              </>
            )}
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Header isOpen={isOpen} />
      <main className="adminPage">
        <section className="adminTop">
          <div>
            <h2>Admin Control</h2>
            <p className="sub">Orders update automatically.</p>
            <div className="adminMeta">
              <span>Active orders: {visibleOrders.length}</span>
              <span className={connectionOk ? "online" : "offline"}>{connectionOk ? "Online" : "Connection issue"}</span>
              <span>Updated {formatUpdatedAt(lastUpdated)}</span>
            </div>
          </div>
          <div className="adminTopActions">
            <button className="ghostBtn" onClick={refreshAdminData}>Refresh</button>
            <button className="ghostBtn" onClick={() => { setPin(""); }}>Log out</button>
          </div>
        </section>

        <section className="adminCommandCenter">
          <div className="queueCommand">
            <div>
              <div className="label">Queue Status</div>
              <div className={isOpen ? "statusOpen" : "statusClosed"}>{isOpen ? "● Open" : "● Closed"}</div>
            </div>
            <button disabled={busy} className={isOpen ? "dangerBtn" : "successBtn"} onClick={() => saveAdmin({ isOpen: !isOpen, message })}>
              {isOpen ? "Close Queue" : "Open Queue"}
            </button>
          </div>

          <div className="adminQuickActions">
            <button className="ghostBtn" onClick={clearCompleted}>Archive ready ({readyArchiveCount})</button>
            <button className="dangerOutlineBtn" onClick={clearAll}>Clear all after close</button>
          </div>
        </section>

        <section className="adminTools">
          <button className="toolTile" onClick={openMenuScreen}>
            <strong>Menu</strong>
            <span>Drinks, milks, syrups</span>
          </button>
          <button className={archiveOpen ? "toolTile active" : "toolTile"} onClick={toggleArchive}>
            <strong>Archive</strong>
            <span>View past orders</span>
          </button>
          <button className={analyticsOpen ? "toolTile active" : "toolTile"} onClick={toggleAnalytics}>
            <strong>Analytics</strong>
            <span>Popular items</span>
          </button>
        </section>

        <section className="panel closedMessagePanel">
          <div className="label">Closed message</div>
          <textarea
            value={message}
            onFocus={() => { messageEditingRef.current = true; }}
            onBlur={() => { messageEditingRef.current = false; }}
            onChange={e => {
              messageEditingRef.current = true;
              setMessage(e.target.value);
            }}
            rows={2}
          />
          <button className="primaryBtn" disabled={busy} onClick={() => saveAdmin({ isOpen, message })}>Save message</button>
          {notice && <div className="notice">{notice}</div>}
        </section>

        <section className="inventoryPanel">
          <div className="sectionHeader">
            <div>
              <h2>Syrup & Milk Inventory</h2>
              <p className="sub">Tap an item to mark it available or out of stock.</p>
            </div>
            <button className="collapseBtn" onClick={() => togglePanel("inventory")}>{collapsedPanels.inventory ? "Show" : "Hide"}</button>
          </div>

          {!collapsedPanels.inventory && (
            <>
              <div className="inventoryGroup">
                <div className="label">Syrups</div>
                <div className="inventoryGrid">
                  {adminSyrups.map(x => (
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
                  {adminMilks.map(x => (
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
            </>
          )}
        </section>

        <section className="orders">
          <div className="sectionHeader">
            <h2>Active Orders</h2>
            <button className="collapseBtn" onClick={() => togglePanel("orders")}>{collapsedPanels.orders ? "Show" : "Hide"}</button>
          </div>

          {!collapsedPanels.orders && (
            visibleOrders.length === 0 ? <div className="empty smallEmpty">No active orders.</div> : visibleOrders.map((o, idx) => (
              <div className={"adminOrder " + o.status} key={o.id}>
                <div className="orderTop">
                  <div className="orderNum">#{String(idx + 1).padStart(3, "0")}</div>
                  <div>
                    <strong>{o.name}</strong>
                    <p>{o.temp} {o.drink}{o.milk ? ` · ${o.milk}` : ""}{o.syrups ? ` · ${o.syrups}` : ""}</p>
                    {orderAgeText(o.time) && <span className="orderAge">Ordered {orderAgeText(o.time)}</span>}
                    {o.notes && <em>"{o.notes}"</em>}
                  </div>
                  <span className={"statusBadge " + o.status}>{statusLabel(o.status)}</span>
                </div>
                <div className="adminActions">
                  <button onClick={() => updateStatus(o.id, "waiting")}>Waiting</button>
                  <button onClick={() => updateStatus(o.id, "making")}>Start Making</button>
                  <button onClick={() => updateStatus(o.id, "complete")}>Ready for Pickup</button>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </>
  );
}

function MenuEditor({
  drinks,
  milks,
  syrups,
  busy,
  onAdd,
  onAddIngredient,
  onRefresh,
  onSave,
  onRemove,
  onRemoveIngredient,
  onMove,
  onMoveIngredient,
  onReorder,
  onReorderIngredient,
  onUpdate,
  onUpdateIngredient,
}) {
  function toggleTemp(drink, temp) {
    const hasTemp = drink.temps.includes(temp);
    const nextTemps = hasTemp ? drink.temps.filter(t => t !== temp) : [...drink.temps, temp];
    onUpdate(drink.id, {
      temps: nextTemps.length ? nextTemps : [temp],
      showTemp: nextTemps.length > 1 ? drink.showTemp : false,
    });
  }

  return (
    <section className="menuPanel">
      <div className="sectionHeader">
        <div>
          <h2>Menu</h2>
          <p className="sub">Customer menu changes only save when you press Save menu.</p>
        </div>
        <div className="archiveActions">
          <div className="menuSaveBar">
            <button className="primaryBtn compactPrimary" disabled={busy} onClick={onSave}>{busy ? "Saving..." : "Save menu"}</button>
          </div>
          <button className="ghostBtn" disabled={busy} onClick={onRefresh}>Refresh</button>
          <button className="ghostBtn" disabled={busy} onClick={onAdd}>Add drink</button>
        </div>
      </div>

      <div className="menuSectionCard">
        <div className="menuSubhead">
          <div>
            <h3>Drinks</h3>
            <p>Control the order form drink choices.</p>
          </div>
          <span>{drinks.filter(drink => drink.active).length} visible</span>
        </div>

        <div className="menuEditorList">
          {drinks.map((drink, index) => (
            <div
              className={drink.active ? "menuEditorItem" : "menuEditorItem inactive"}
              key={drink.id}
              draggable={!busy}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", drink.id);
              }}
              onDragOver={event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={event => {
                event.preventDefault();
                onReorder(event.dataTransfer.getData("text/plain"), drink.id);
              }}
            >
              <div className="menuCardHeader">
                <div>
                  <span className="menuOrder" title="Drag to reorder">#{String(index + 1).padStart(2, "0")}</span>
                  <strong>{drink.label || "New Drink"}</strong>
                </div>
                <span className={drink.active ? "menuState active" : "menuState"}>{drink.active ? "Visible" : "Hidden"}</span>
              </div>

              <div className="menuCardBody">
                <label>
                  <span className="label">Name</span>
                  <input value={drink.label} onChange={e => onUpdate(drink.id, { label: e.target.value })} placeholder="Drink name" />
                </label>
                <label>
                  <span className="label">Description</span>
                  <input value={drink.desc} onChange={e => onUpdate(drink.id, { desc: e.target.value })} placeholder="Short description" />
                </label>
              </div>

              <div className="menuCardControls">
                <div>
                  <div className="label">Temperature</div>
                  <div className="menuTempRow">
                    <button className={drink.temps.includes("Hot") ? "choice active" : "choice"} onClick={() => toggleTemp(drink, "Hot")}>Hot</button>
                    <button className={drink.temps.includes("Cold") ? "choice active" : "choice"} onClick={() => toggleTemp(drink, "Cold")}>Cold</button>
                  </div>
                </div>

                <div>
                  <div className="label">Options</div>
                  <div className="menuOptionGrid">
                    <label className="adminCheck">
                      <input type="checkbox" checked={drink.milk} onChange={e => onUpdate(drink.id, { milk: e.target.checked })} />
                      Needs milk
                    </label>
                    <label className="adminCheck">
                      <input type="checkbox" checked={drink.syrups} onChange={e => onUpdate(drink.id, { syrups: e.target.checked })} />
                      Allows syrup
                    </label>
                    <label className="adminCheck">
                      <input type="checkbox" checked={drink.showTemp !== false && drink.temps.length > 1} disabled={drink.temps.length < 2} onChange={e => onUpdate(drink.id, { showTemp: e.target.checked })} />
                      Show temp choice
                    </label>
                  </div>
                </div>
              </div>

              <div className="menuItemActions">
                <button className="ghostBtn" disabled={busy} onClick={() => onUpdate(drink.id, { active: !drink.active })}>{drink.active ? "Hide" : "Show"}</button>
                <button className="ghostBtn" disabled={busy || index === 0} onClick={() => onMove(drink.id, -1)}>Move up</button>
                <button className="ghostBtn" disabled={busy || index === drinks.length - 1} onClick={() => onMove(drink.id, 1)}>Move down</button>
                <button className="dangerOutlineBtn" disabled={busy || drinks.length <= 1} onClick={() => onRemove(drink.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <IngredientMenuSection
        title="Milks"
        type="milk"
        items={milks}
        busy={busy}
        onAdd={onAddIngredient}
        onUpdate={onUpdateIngredient}
        onMove={onMoveIngredient}
        onReorder={onReorderIngredient}
        onRemove={onRemoveIngredient}
      />

      <IngredientMenuSection
        title="Syrups"
        type="syrup"
        items={syrups}
        busy={busy}
        onAdd={onAddIngredient}
        onUpdate={onUpdateIngredient}
        onMove={onMoveIngredient}
        onReorder={onReorderIngredient}
        onRemove={onRemoveIngredient}
      />
    </section>
  );
}

function IngredientMenuSection({ title, type, items, busy, onAdd, onUpdate, onMove, onReorder, onRemove }) {
  return (
    <div className="menuSectionCard ingredientMenuSection">
      <div className="menuSubhead">
        <div>
          <h3>{title}</h3>
          <p>{type === "milk" ? "Milk choices for drinks that need milk." : "Syrup choices shown to customers."}</p>
        </div>
        <div className="menuSubActions">
          <span>{items.filter(item => item.active).length} visible</span>
          <button className="ghostBtn" disabled={busy} onClick={() => onAdd(type)}>Add {type === "milk" ? "milk" : "syrup"}</button>
        </div>
      </div>

      <div className="ingredientEditorGrid">
        {items.map((item, index) => (
          <div
            className={item.active ? "ingredientEditorItem" : "ingredientEditorItem inactive"}
            key={item.id}
            draggable={!busy}
            onDragStart={event => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={event => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={event => {
              event.preventDefault();
              onReorder(type, event.dataTransfer.getData("text/plain"), item.id);
            }}
          >
            <div className="menuCardHeader">
              <div>
                <span className="menuOrder" title="Drag to reorder">#{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.item}</strong>
              </div>
              <span className={item.active ? "menuState active" : "menuState"}>{item.active ? "Visible" : "Hidden"}</span>
            </div>

            <label className="menuNameField">
              <span>Name</span>
              <input value={item.item} onChange={e => onUpdate(type, item.id, { item: e.target.value })} />
            </label>

            <div className="menuItemActions">
              <button className="ghostBtn" disabled={busy} onClick={() => onUpdate(type, item.id, { active: !item.active })}>{item.active ? "Hide" : "Show"}</button>
              <button className="ghostBtn" disabled={busy} onClick={() => onUpdate(type, item.id, { available: !item.available })}>{item.available ? "Mark out" : "Mark available"}</button>
              <button className="ghostBtn" disabled={busy || index === 0} onClick={() => onMove(type, item.id, -1)}>Up</button>
              <button className="ghostBtn" disabled={busy || index === items.length - 1} onClick={() => onMove(type, item.id, 1)}>Down</button>
              <button className="dangerOutlineBtn" disabled={busy || items.length <= 1} onClick={() => onRemove(type, item.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsList({ title, items }) {
  return (
    <div className="analyticsList">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">No data yet.</p>
      ) : items.map(item => (
        <div className="analyticsRow" key={item.item}>
          <span>{item.item}</span>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
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
          Arise! Coffee is free, but donations help support Holy Transfiguration Church.
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
  const [menuDrinks, setMenuDrinks] = useState(() => normalizeMenuDrinks(DRINKS));
  const [inventory, setInventory] = useState(loadCachedInventory);
  const [myOrderId, setMyOrderId] = useState(localStorage.getItem("coffee-my-order-id") || "");
  const [myOrder, setMyOrder] = useState(null);
  const [myOrderPosition, setMyOrderPosition] = useState(1);
  const [busy, setBusy] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [readyAlertShown, setReadyAlertShown] = useState(false);
  const [largeText, setLargeText] = useState(() => localStorage.getItem(TEXT_SIZE_KEY) === "large");
  const submittingRef = useRef(false);
  const orderLoadingRef = useRef(false);
  const statusLoadingRef = useRef(false);
  const inventoryLoadingRef = useRef(false);
  const menuLoadingRef = useRef(false);
  const previousStatusRef = useRef("");
  const nameRef = useRef(null);

  const customerDrinks = useMemo(() => normalizeMenuDrinks(menuDrinks), [menuDrinks]);
  const drink = useMemo(() => getDrink(form.drinkId, customerDrinks), [form.drinkId, customerDrinks]);
  const inventoryLookup = useMemo(() => buildInventoryLookup(inventory), [inventory]);
  const customerMilks = useMemo(() => inventoryItemsByType(inventory, "milk", MILKS), [inventory]);
  const customerSyrups = useMemo(() => inventoryItemsByType(inventory, "syrup", SYRUPS), [inventory]);

  function updateTextSize(nextLargeText) {
    setLargeText(nextLargeText);
    localStorage.setItem(TEXT_SIZE_KEY, nextLargeText ? "large" : "normal");
  }

  function updateMyOrder(order, positionFromResponse) {
    const found = normalizeOrderFromSingle(order);
    if (!found) {
      setMyOrder(null);
      return;
    }

    const nextPosition = found.position || Number(positionFromResponse || 0) || 1;
    setMyOrderPosition(nextPosition);
    setMyOrder({ ...found, position: nextPosition });

    const isReadyForPickup = ["ready", "complete"].includes(found.status);
    const wasReadyForPickup = ["ready", "complete"].includes(previousStatusRef.current);

    if (isReadyForPickup && !wasReadyForPickup && !readyAlertShown) {
      ringReadyAlert();
      setReadyAlertShown(true);
    }

    previousStatusRef.current = found.status;
  }

  async function refreshOrder() {
    if (!myOrderId) return;
    if (orderLoadingRef.current) return;
    orderLoadingRef.current = true;
    try {
      const data = await apiGet("order", { id: myOrderId });
      if (data.ok === false) return;
      if (typeof data.isOpen === "boolean") setIsOpen(Boolean(data.isOpen));
      if (typeof data.message === "string") setMessage(data.message || "");
      if (data.inventory) setInventory(cacheInventory(data.inventory));
      updateMyOrder(data.order, data.position);
    } catch {
    } finally {
      orderLoadingRef.current = false;
    }
  }

  async function refreshInitialCustomerData() {
    try {
      const data = await apiGet();
      if (data.ok) {
        if (typeof data.isOpen === "boolean") setIsOpen(Boolean(data.isOpen));
        if (typeof data.message === "string") setMessage(data.message || "");
      }
    } catch {}
    await refreshInventoryOnly();
  }

  async function refreshInventoryOnly() {
    if (inventoryLoadingRef.current) return;
    inventoryLoadingRef.current = true;
    try {
      const data = await apiGet("inventory");
      if (data.ok && data.inventory) setInventory(cacheInventory(data.inventory));
    } catch {
    } finally {
      inventoryLoadingRef.current = false;
    }
  }

  async function refreshMenuOnly() {
    if (menuLoadingRef.current) return;
    menuLoadingRef.current = true;
    try {
      const data = await apiGet("menu");
      if (data.ok && Array.isArray(data.drinks)) setMenuDrinks(normalizeMenuDrinks(data.drinks));
    } catch {
    } finally {
      menuLoadingRef.current = false;
    }
  }

  async function refreshStatusOnly() {
    if (statusLoadingRef.current) return isOpen;
    statusLoadingRef.current = true;
    try {
      const data = await apiGet("status");
      if (data.ok) {
        setIsOpen(Boolean(data.isOpen));
        setMessage(data.message || "");
        return Boolean(data.isOpen);
      }
    } catch {
    } finally {
      statusLoadingRef.current = false;
    }
    return isOpen;
  }

  useEffect(() => {
    if (myOrderId) refreshOrder();
    else refreshInitialCustomerData();
    refreshMenuOnly();

    const orderId = myOrderId ? setInterval(() => {
      if (isPageVisible()) refreshOrder();
    }, 6000) : null;
    const inventoryId = setInterval(() => {
      if (isPageVisible()) refreshInventoryOnly();
    }, 60000);
    const statusId = myOrderId ? null : setInterval(() => {
      if (isPageVisible()) refreshStatusOnly();
    }, 6000);

    function refreshWhenVisible() {
      if (!isPageVisible()) return;
      if (myOrderId) refreshOrder();
      else refreshInitialCustomerData();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      if (orderId) clearInterval(orderId);
      clearInterval(inventoryId);
      if (statusId) clearInterval(statusId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [myOrderId]);

  useEffect(() => {
    const d = getDrink(form.drinkId, customerDrinks);
    setForm(f => ({ ...f, temp: d.temps[0], milk: "", syrups: [] }));
    setErrors({});
  }, [form.drinkId, customerDrinks]);

  useEffect(() => {
    if (!customerDrinks.some(d => d.id === form.drinkId)) {
      setForm(f => ({ ...f, drinkId: customerDrinks[0]?.id || "latte" }));
    }
  }, [customerDrinks, form.drinkId]);

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
    else if (!hasFirstAndLastName(form.name)) e.name = "Please enter first and last name";
    if (drink.milk && !form.milk) e.milk = "Please choose a milk";
    if (form.milk && !isInventoryAvailable(inventoryLookup, form.milk)) e.milk = form.milk + " is out of stock";
    const outSyrup = form.syrups.find(s => !isInventoryAvailable(inventoryLookup, s));
    if (outSyrup) e.syrups = outSyrup + " is out of stock";
    return e;
  }

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);

    const queueIsOpen = await refreshStatusOnly();
    if (!queueIsOpen) {
      setBusy(false);
      submittingRef.current = false;
      return;
    }

    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      if (e.name) nameRef.current?.focus();
      setBusy(false);
      submittingRef.current = false;
      return;
    }

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
        await refreshStatusOnly();
        setBusy(false);
        submittingRef.current = false;
        return;
      }

      localStorage.setItem("arise-customer-name", form.name.trim());
      localStorage.setItem("coffee-my-order-id", data.id);
      setReadyAlertShown(false);
      previousStatusRef.current = "waiting";
      setMyOrderId(data.id);
      setMyOrderPosition(Number(data.position || 1));
      setMyOrder({
        id: data.id,
        name: form.name.trim(),
        drink: drink.label,
        temp: form.temp,
        milk: form.milk,
        syrups: form.syrups.join(", "),
        notes: form.notes,
        status: "waiting",
        position: Number(data.position || 1)
      });
      setForm(defaultForm());
      setShowDonation(true);
    } catch {
      alert("Connection error. Try again.");
    }
    setBusy(false);
    submittingRef.current = false;
  }

  function clearMyTicket() {
    localStorage.removeItem("coffee-my-order-id");
    setMyOrderId("");
    setMyOrder(null);
    setMyOrderPosition(1);
  }

  const lbl = (text, hint) => <div className="label">{text}{hint && <span> {hint}</span>}</div>;

  if (!isOpen && !myOrder) {
    return <>
      <Header isOpen={isOpen} />
      <main className={largeText ? "closedPage customerLargeText" : "closedPage"}>
        <div className="customerTools closedTools">
          <TextSizeControl largeText={largeText} onChange={updateTextSize} />
        </div>
        <div className="closedIcon">🚫</div>
        <h1>We're closed</h1>
        <p>{message || "Orders aren't being taken right now. Check back soon!"}</p>
        <button className="ghostBtn" onClick={refreshStatusOnly}>Refresh status</button>
      </main>
    </>;
  }

  return (
    <>
      <Header isOpen={isOpen} />
      <main className={largeText ? "layout customerLargeText" : "layout"}>
        <section className="formCol">
          <div className="customerSectionHead">
            <div>
              <h2>Place your order</h2>
              <p className="sub">{isOpen ? "We'll hold your spot in line." : "Queue is closed, but your current order status still updates."}</p>
            </div>
            <TextSizeControl largeText={largeText} onChange={updateTextSize} />
          </div>

          {isOpen && (
            <>
              <div className="field">
                {lbl("Your name")}
                <input ref={nameRef} value={form.name} onChange={e => { setForm(f => ({...f, name: e.target.value})); setErrors(er => ({...er, name: ""})); }} placeholder="e.g. Alex Morgan" />
                {errors.name && <div className="errorText">{errors.name}</div>}
              </div>

              <div className="field">
                {lbl("Drink")}
                <div className="drinkList">
                  {customerDrinks.map(d => <button key={d.id} className={form.drinkId === d.id ? "drink active" : "drink"} onClick={() => setForm(f => ({...f, drinkId: d.id}))}><strong>{d.label}</strong><span>{d.desc}</span></button>)}
                </div>
              </div>

              {drink.showTemp !== false && (drink.temps.length > 1 ? (
                <div className="field">
                  {lbl("Temperature")}
                  <div className="row">{drink.temps.map(t => <button key={t} className={form.temp === t ? "choice active" : "choice"} onClick={() => setForm(f => ({...f, temp: t}))}>{t}</button>)}</div>
                </div>
              ) : <div className="servedOnly">Served <strong>{drink.temps[0].toLowerCase()}</strong> only</div>)}

              {drink.milk && <div className="field">
                {lbl("Milk", "(required)")}
                <div className="row wrap">{customerMilks.map(m => (
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
                <div className="syrups">{customerSyrups.map(s => {
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
            const currentPosition = Math.max(1, Number(myOrder.position || myOrderPosition || 1));
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
                {["ready","complete"].includes(myOrder.status) && <div className="readyNotice">🔔 Your drink is ready for pickup.</div>}
                {myOrder.status === "complete" && <button className="ghostBtn" onClick={clearMyTicket}>Place another order</button>}
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
