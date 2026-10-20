// Read-only fixtures, loaded only by a development build without backend credentials.
const orders = [
  ["preview-1", "Alex Morgan", "Latte", "Hot", "making"],
  ["preview-2", "Miriam Hanna", "Cappuccino", "Cold", "waiting"],
  ["preview-3", "Christopher Alexander", "Americano", "Hot", "waiting"],
  ["preview-4", "Marianne Abdelmalek", "Cold Chocolate Milk", "Cold", "waiting"],
].map(([id, name, drink, temp, status], index) => ({
  id, name, drink, temp, status, position: index + 1, fulfillmentType: "pickup",
  milk: drink === "Americano" ? "" : "Whole Milk", syrups: "", notes: "",
  time: new Date().toISOString(),
}));
const ready = [{ ...orders[0], id: "preview-ready", name: "Daniel George", status: "complete" }];
const pickupOptions = { showReady: true, archiveMinutes: 30, adminPickup: true };

export function previewRpc(name, args = {}) {
  const status = { ok: true, isOpen: true, queueTimerEnabled: false, queueTimerMinutes: 30,
    queueClosesAt: "", clergyOrderingEnabled: true, deliveryEnabled: true, message: "" };
  switch (name) {
    case "arise_status": return status;
    case "arise_login": return args.input_pin === "0000" ? status : { ok: false, error: "Preview PIN is 0000." };
    case "arise_orders": return { ...status, orders };
    case "arise_display": return { ...status, orders, ready, pickupOptions };
    case "arise_order": return { ok: true, order: null };
    case "arise_menu": return { ok: true };
    case "arise_inventory": return { ok: true, inventory: [
      ...["Whole Milk", "Oat Milk", "Almond Milk"].map(item => ({ item, type: "milk", available: true })),
      ...["Vanilla", "Caramel", "Hazelnut"].map(item => ({ item, type: "syrup", available: true })),
    ] };
    case "arise_pickup_admin": return { ok: true, ready, collected: [], pickupOptions };
    case "arise_pickup_settings":
      if (!args.input_options) return { ok: true, pickupOptions };
      break;
    case "arise_customer_strikes":
      if (!args.input_action || args.input_action === "list") return { ok: true, enabled: false, entries: [] };
      break;
    case "arise_archive": return { ok: true, archive: [] };
    case "arise_analytics": return { ok: true, analytics: null };
    case "arise_reviews_admin": return { ok: true, page: 0, pageSize: 25, totalReviews: 0,
      averageRating: null, filteredTotal: 0, ratingCounts: {}, reviews: [] };
  }
  return { ok: false, error: "This is a read-only design preview. No orders or settings were changed." };
}
