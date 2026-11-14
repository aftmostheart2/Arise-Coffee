import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { apiPost } from "./api/backend";
import SpecialtyRecipeOptions, { emptySpecialtyRecipe } from "./SpecialtyRecipeOptions";

export default function SpecialtyMenuEditor({ pin, drinks = [], syrups = [] }) {
  const [specialties, setSpecialties] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [startsOn, setStartsOn] = useState("");
  const [featured, setFeatured] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);

  async function request(save = false) {
    if (pending.current) return;
    if (save) {
      const invalid = specialties.some(item => !item.label.trim() || !item.temps.length ||
        (item.active && (item.recipeConfig ? !item.recipeConfig.baseDrinkId : !item.regularRecipe.trim())));
      if (invalid) { setError("Every specialty needs a name and temperature. Choose a base drink before including it in rotation."); return; }
      if (enabled && !specialties.some(item => item.active)) { setError("Include at least one specialty in rotation."); return; }
      if (!startsOn || new Date(`${startsOn}T12:00:00`).getDay() !== 0) { setError("Choose a Sunday start date."); return; }
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiPost({ action: "specialtiesAdmin", pin,
        ...(save ? { specialties, enabled, startsOn } : {}) });
      if (!data.ok) { setError(data.error || "Could not save specialties."); return; }
      if (!Array.isArray(data.specialties)) { setError("Specialties are unavailable. Please install the specialties SQL update."); return; }
      setSpecialties(data.specialties);
      setEnabled(data.enabled);
      setStartsOn(data.startsOn);
      setFeatured(data.featured);
      setLoaded(true);
      setDirty(false);
      if (save) setNotice("Specialties saved.");
    } catch { setError("Connection error. Please try again."); }
    finally { setBusy(false); pending.current = false; }
  }
  useEffect(() => { request(); }, [pin]);

  function update(id, patch) {
    setSpecialties(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
    setDirty(true);
    setNotice("");
  }
  function move(index, direction) {
    setSpecialties(items => {
      const next = [...items];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
    setDirty(true);
  }

  return <section className="specialtyMenuSection" aria-labelledby="specialties-title">
    <div className="sectionHeader">
      <div><h2 id="specialties-title"><Star size={21} />Specialties</h2>
        {loaded && <p className="sub">{dirty ? "Unsaved changes" : featured ? `This week: ${featured.label}` : enabled ? "No specialty available this week" : "Rotation paused"}</p>}
      </div>
      <div className="specialtyEditorActions">
        <button type="button" className="ghostBtn" disabled={busy} onClick={() => {
          if (!dirty || window.confirm("Discard unsaved specialty changes and reload?")) request();
        }}><RefreshCw size={16} />Reload</button>
        <button type="button" className="ghostBtn" disabled={busy || !loaded} onClick={() => {
          setSpecialties(items => [...items, { id: `specialty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label: "", desc: "", regularRecipe: "", sugarFreeRecipe: "", recipeConfig: emptySpecialtyRecipe(), temps: ["Hot", "Cold"], active: false }]);
          setDirty(true);
        }}><Plus size={16} />Add specialty</button>
      </div>
    </div>
    {error && <p className="errorText" role="alert">{error}</p>}
    {notice && <p role="status" className="specialtyNotice">{notice}</p>}
    {!loaded && busy && <p role="status">Loading specialties...</p>}
    {loaded && <form onSubmit={event => { event.preventDefault(); request(true); }}>
      <fieldset disabled={busy} className="specialtyRotationControls">
        <label className="adminCheck"><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setDirty(true); }} />Sunday rotation</label>
        <label className="settingsField"><span>First Sunday</span><input type="date" value={startsOn} required onChange={event => { setStartsOn(event.target.value); setDirty(true); }} /></label>
        <span className="muted">America/Los_Angeles</span>
      </fieldset>
      <div className="specialtyEditorGrid">
        {specialties.map((item, index) => <article className="specialtyEditorTile" key={item.id}>
          <div className="specialtyTileHeading"><span className="orderNum">#{String(index + 1).padStart(2, "0")}</span><h3>{item.label || "New specialty"}</h3></div>
          <fieldset disabled={busy}>
            <label className="settingsField"><span>Name</span><input maxLength={80} required value={item.label} onChange={event => update(item.id, { label: event.target.value })} /></label>
            <label className="settingsField"><span>Customer description</span><input maxLength={180} value={item.desc} onChange={event => update(item.id, { desc: event.target.value })} /></label>
            {!item.recipeConfig && item.regularRecipe ? <div className="specialtySavedRecipe">
              <span className="label">Saved regular recipe</span><p>{item.regularRecipe}</p>
              {item.sugarFreeRecipe && <><span className="label">Saved sugar-free recipe</span><p>{item.sugarFreeRecipe}</p></>}
              <button type="button" className="ghostBtn" onClick={() => update(item.id, { recipeConfig: emptySpecialtyRecipe() })}>Replace with menu selections</button>
            </div> : <SpecialtyRecipeOptions config={item.recipeConfig || emptySpecialtyRecipe()} drinks={drinks} syrups={syrups}
              required={item.active} onChange={recipeConfig => update(item.id, { recipeConfig })} />}
            <div className="specialtyTemps">{["Hot", "Cold"].map(temp => <label className="adminCheck" key={temp}>
              <input type="checkbox" checked={item.temps.includes(temp)} onChange={event => update(item.id, { temps: event.target.checked ? [...item.temps, temp] : item.temps.filter(value => value !== temp) })} />{temp}
            </label>)}</div>
            <label className="adminCheck"><input type="checkbox" checked={item.active} onChange={event => update(item.id, { active: event.target.checked })} />Include in rotation</label>
          </fieldset>
          <div className="specialtyTileActions">
            <button type="button" className="ghostBtn" title="Move specialty earlier" aria-label="Move specialty earlier" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={18} /></button>
            <button type="button" className="ghostBtn" title="Move specialty later" aria-label="Move specialty later" disabled={busy || index === specialties.length - 1} onClick={() => move(index, 1)}><ArrowDown size={18} /></button>
            <button type="button" className="dangerOutlineBtn" title="Remove specialty" aria-label="Remove specialty" disabled={busy} onClick={() => {
              if (window.confirm(`Remove ${item.label || "this specialty"}? Existing orders keep their recipe.`)) { setSpecialties(items => items.filter(value => value.id !== item.id)); setDirty(true); }
            }}><Trash2 size={18} /></button>
          </div>
        </article>)}
      </div>
      {specialties.length === 0 && <div className="empty">No specialties.</div>}
      <div className="specialtySaveActions"><button className="primaryBtn compactPrimary" disabled={busy} type="submit">{busy ? "Saving..." : "Save specialties"}</button></div>
    </form>}
  </section>;
}
