// Helpers for eRaktKosh stock data. Pure functions, safe on client and server.

// "O-Ve : 3, A+Ve : 86" -> [{ group: "O-Ve", units: 3 }, { group: "A+Ve", units: 86 }]
export function parseQty(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .split(",")
    .map((part) => part.trim().match(/^(.+?)\s*:\s*(\d+)$/))
    .filter(Boolean)
    .map((m) => ({ group: m[1].trim(), units: Number(m[2]) }));
}

// Summarise the stock that matches the user's filters.
// eRaktKosh returns every bank in the state whatever the filters, so a bank
// only counts as a hit when this returns totalUnits > 0.
export function summarizeStock(bank, { componentName, bloodGroupName } = {}) {
  const components = bank?.components ?? {};
  let names = Object.keys(components);

  if (componentName) {
    const wanted = componentName.toLowerCase();
    const matching = names.filter((n) => n.toLowerCase() === wanted);
    // eRaktKosh already filters by componentId; if its label differs from ours
    // and only one component came back, trust that one.
    names = matching.length > 0 ? matching : names.length === 1 ? names : [];
  }

  const list = names
    .map((name) => {
      let units = parseQty(components[name]?.available_WithQty).filter((u) => u.units > 0);
      if (bloodGroupName) {
        const wanted = bloodGroupName.toLowerCase();
        units = units.filter((u) => u.group.toLowerCase() === wanted);
      }
      return { component: name, units, total: units.reduce((sum, u) => sum + u.units, 0) };
    })
    .filter((c) => c.total > 0);

  return { components: list, totalUnits: list.reduce((sum, c) => sum + c.total, 0) };
}

// "Phone: 9763245312 ,Fax: -, Email: x@y.com" -> "9763245312"
export function extractPhone(contactText) {
  if (!contactText || typeof contactText !== "string") return null;
  const match = contactText.match(/Phone:\s*([+\d][\d\s-]{5,}\d)/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

// eRaktKosh entrydate is "YYYY-MM-DD HH:mm:ss" in Indian time.
export function parseEntryDate(entrydate) {
  if (!entrydate || typeof entrydate !== "string") return null;
  const date = new Date(entrydate.trim().replace(" ", "T") + "+05:30");
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUpdatedAgo(entrydate, now = new Date()) {
  const date = parseEntryDate(entrydate);
  if (!date) return null;
  const minutes = Math.max(0, Math.round((now - date) / 60000));
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `updated ${hours} h ago`;
  return `updated ${Math.round(hours / 24)} days ago`;
}

// eRaktKosh names and addresses sometimes end with stray commas or spaces.
export function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/[,\s]+$/, "") : "";
}

// Shape a blood-availability row for display.
export function normalizeAvailabilityRow(row, filters = {}) {
  return {
    hospitalCode: String(row.hospitalCode),
    name: cleanText(row.hospitalname) || "Blood bank",
    address: cleanText(row.hospitaladd),
    phone: extractPhone(row.hospitalcontact),
    type: row.hospitalType ?? null,
    entrydate: row.entrydate ?? null,
    stock: summarizeStock(row, filters),
  };
}
