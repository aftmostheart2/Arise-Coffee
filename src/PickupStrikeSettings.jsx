import React, { useEffect, useRef, useState } from "react";
import { apiPost } from "./api/backend";

export default function PickupStrikeSettings({ pin }) {
  const [entries, setEntries] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef(false);

  async function update(operation, values = {}) {
    if (requestRef.current) return;
    requestRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiPost({ action: "customerStrikes", pin, operation, ...values });
      if (!data.ok) {
        setError(data.error || "Could not save pickup strikes. Please try again.");
        return;
      }
      setEntries(data.entries || []);
      setEnabled(Boolean(data.enabled));
      setLoaded(true);
      if (operation === "add") {
        setName("");
        setSearch("");
        setNotice(`Strike added for ${values.name}.`);
      } else if (operation === "reset") {
        setNotice(`Strikes cleared for ${values.name}.`);
      } else if (operation === "remove") {
        setNotice(`One strike removed for ${values.name}.`);
      } else if (operation === "delete") {
        setNotice(`${values.name} deleted from the missed-pickup list.`);
      } else if (operation === "setEnabled") {
        setNotice(data.enabled ? "Three-strike blacklisting enabled." : "Blacklisting paused. Existing strikes are saved.");
      }
    } catch {
      setError("Could not save pickup strikes. Please check the connection and refresh before trying again.");
    } finally {
      setBusy(false);
      requestRef.current = false;
    }
  }

  useEffect(() => { update("list"); }, [pin]);

  function addStrike(event) {
    event.preventDefault();
    const customerName = name.trim();
    if (customerName.split(/\s+/).length < 2) {
      setError("Please enter first and last name.");
      return;
    }
    if (window.confirm(`Add one missed-pickup strike for ${customerName}? The third strike blacklists the name.`)) {
      update("add", { name: customerName });
    }
  }

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter(entry => terms.every(term => entry.name.toLowerCase().includes(term)));

  return (
    <section className="pickupStrikes" aria-labelledby="pickup-strikes-title" aria-busy={busy}>
      <div className="pickupStrikesHeader">
        <h3 id="pickup-strikes-title">Missed Pickups</h3>
        <button className="ghostBtn" disabled={busy} onClick={() => update("list")}>Refresh list</button>
      </div>
      <label className="adminCheck settingsToggle">
        <input type="checkbox" checked={enabled} disabled={busy || !loaded}
          onChange={event => update("setEnabled", { enabled: event.target.checked })} />
        Blacklist normal orders after 3 strikes
      </label>
      {loaded && <p className="pickupStrikesState">{enabled ? "Enforcement on" : "Enforcement paused"}</p>}
      <form className="pickupStrikeForm" onSubmit={addStrike}>
        <label className="settingsField" htmlFor="pickup-strike-name">
          <span>First and last name</span>
          <input id="pickup-strike-name" value={name} onChange={event => setName(event.target.value)}
            autoComplete="off" required disabled={busy || !loaded} />
        </label>
        <button className="primaryBtn" type="submit" disabled={busy || !loaded}>Add strike</button>
      </form>
      {error && <p className="errorText" role="alert">{error}</p>}
      {notice && <p className="pickupStrikeNotice" role="status">{notice}</p>}
      {busy && !loaded && <p role="status">Loading pickup strikes...</p>}
      {loaded && (
        <>
          <label className="settingsField" htmlFor="pickup-strike-search">
            <span>Find a name</span>
            <input id="pickup-strike-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <ul className="pickupStrikeList">
            {filtered.map(entry => (
              <li className="pickupStrikeRow" key={entry.nameKey}>
                <div className="pickupStrikePerson">
                  <strong>{entry.name}</strong>
                  <span>{entry.strikes} / 3 strikes</span>
                  {entry.blacklisted && <b className="pickupBlacklistStatus">{enabled ? "Blacklisted" : "Blacklist paused"}</b>}
                </div>
                <div className="pickupStrikeActions">
                  <button className="ghostBtn" disabled={busy || entry.strikes === 0}
                    onClick={() => update("remove", { name: entry.name })}>Remove 1 strike</button>
                  <button className="ghostBtn" disabled={busy || entry.strikes === 0} onClick={() => {
                    if (window.confirm(`Clear all strikes and remove any blacklist for ${entry.name}?`)) {
                      update("reset", { name: entry.name });
                    }
                  }}>{entry.blacklisted ? "Remove blacklist" : "Clear strikes"}</button>
                  <button className="dangerBtn" disabled={busy} onClick={() => {
                    if (window.confirm(`Delete ${entry.name} from the missed-pickup list? This removes all their strikes and any blacklist. Their orders will not be deleted.`)) {
                      update("delete", { name: entry.name });
                    }
                  }}>Delete name</button>
                </div>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p className="pickupStrikesState">{entries.length ? "No matching names." : "No pickup strikes recorded."}</p>}
        </>
      )}
    </section>
  );
}
