import React, { useEffect, useRef, useState } from "react";
import { apiPost } from "./api/backend";

export default function PickupSettings({ pin }) {
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);

  async function request(next) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiPost({ action: "pickupSettings", pin, options: next });
      if (!data.ok) { setError(data.error || "Could not save settings."); return; }
      setOptions(data.pickupOptions);
      if (next) setNotice("Pickup settings saved.");
    } catch { setError("Connection error. Please try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  useEffect(() => { request(); }, [pin]);
  function save(event) {
    event.preventDefault();
    const minutes = Number(options.archiveMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      setError("Enter a whole number from 1 to 240 minutes.");
      return;
    }
    request({ ...options, archiveMinutes: minutes });
  }

  return <section className="pickupStrikes" aria-labelledby="pickup-settings-title">
    <h3 id="pickup-settings-title">Pickup &amp; Archive</h3>
    {!options && !error && <p role="status">Loading pickup settings...</p>}
    {options && <form onSubmit={save}>
      <label className="adminCheck settingsToggle">
        <input type="checkbox" disabled={busy} checked={options.showReady}
          onChange={event => setOptions({ ...options, showReady: event.target.checked })} />
        Show Ready for Pickup on TV
      </label>
      <label className="settingsField" htmlFor="pickup-archive-minutes">
        <span>Auto archive after ready (minutes)</span>
        <input id="pickup-archive-minutes" type="number" min="1" max="240" step="1" required
          disabled={busy} value={options.archiveMinutes}
          onChange={event => setOptions({ ...options, archiveMinutes: event.target.value })} />
      </label>
      <label className="adminCheck settingsToggle">
        <input type="checkbox" disabled={busy} checked={options.adminPickup}
          onChange={event => setOptions({ ...options, adminPickup: event.target.checked })} />
        Allow admin pickup confirmation
      </label>
      <button className="primaryBtn" disabled={busy} type="submit">{busy ? "Saving..." : "Save pickup settings"}</button>
    </form>}
    {error && <p className="errorText" role="alert">{error}</p>}
    {!options && error && <button className="ghostBtn" disabled={busy} onClick={() => request()}>Retry</button>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
