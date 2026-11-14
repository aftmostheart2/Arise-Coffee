import React from "react";

export function emptySpecialtyRecipe() {
  return { baseDrinkId: "", regularSyrups: [], sugarFreeEnabled: false, sugarFreeSyrups: [] };
}

export default function SpecialtyRecipeOptions({ config, drinks, syrups, onChange, required }) {
  const bases = drinks.filter(drink => drink.active !== false && drink.label.trim());
  const ingredients = syrups.filter(syrup => syrup.active !== false && syrup.item.trim());
  const selectedBaseMissing = config.baseDrinkId && !bases.some(drink => drink.id === config.baseDrinkId);

  function syrupChoices(field, title) {
    const selected = config[field] || [];
    const missing = selected.filter(name => !ingredients.some(syrup => syrup.item === name));
    return <fieldset className="specialtySyrupOptions">
      <legend>{title}</legend>
      {ingredients.length === 0 && <p className="muted">No syrups in the menu.</p>}
      {[...ingredients, ...missing.map(item => ({ item, missing: true }))].map(syrup => <label className="adminCheck" key={syrup.item}>
        <input type="checkbox" checked={selected.includes(syrup.item)}
          disabled={!selected.includes(syrup.item) && selected.length >= 10}
          onChange={event => onChange({ ...config, [field]: event.target.checked
            ? [...selected, syrup.item] : selected.filter(item => item !== syrup.item) })} />
        <span>{syrup.item}{syrup.missing ? " (not on menu)" : syrup.available === false ? " (out of stock)" : ""}</span>
      </label>)}
    </fieldset>;
  }

  return <div className="specialtyRecipeOptions">
    <label className="settingsField"><span>Base drink</span>
      <select value={config.baseDrinkId} required={required} onChange={event => onChange({ ...config, baseDrinkId: event.target.value })}>
        <option value="">Choose a drink</option>
        {selectedBaseMissing && <option value={config.baseDrinkId} disabled>Unavailable drink</option>}
        {bases.map(drink => <option key={drink.id} value={drink.id}>{drink.label}</option>)}
      </select>
    </label>
    {syrupChoices("regularSyrups", "Regular version syrups")}
    <label className="adminCheck specialtySugarFreeToggle">
      <input type="checkbox" checked={config.sugarFreeEnabled} onChange={event => onChange({ ...config, sugarFreeEnabled: event.target.checked })} />
      Offer sugar-free version
    </label>
    {config.sugarFreeEnabled && syrupChoices("sugarFreeSyrups", "Sugar-free version syrups")}
  </div>;
}
