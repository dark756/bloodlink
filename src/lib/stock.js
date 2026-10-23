// Helpers for eRaktKosh stock data. Pure functions, safe on client and server.

// "O-Ve : 3, A+Ve : 86" -> [{ group: "O-Ve", units: 3 }, { group: "A+Ve", units: 86 }]
export function parseQuantities(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .split(",")
    .map((part) => part.trim().match(/^(.+?)\s*:\s*(\d+)$/))
    .filter(Boolean)
    .map((match) => ({ group: match[1].trim(), units: Number(match[2]) }));
}

// Summarise the stock that matches the user's filters.
// eRaktKosh returns every bank in the state whatever the filters, so a bank
// only counts as a hit when this returns totalUnits > 0.
export function summarizeStock(bank, { componentName, bloodGroupName } = {}) {
  const components = bank?.components ?? {};
  let componentNames = Object.keys(components);

  if (componentName) {
    const wantedComponent = componentName.toLowerCase();
    const matchingNames = componentNames.filter((name) => name.toLowerCase() === wantedComponent);
    // eRaktKosh already filters by componentId; if its label differs from ours
    // and only one component came back, trust that one.
    componentNames =
      matchingNames.length > 0 ? matchingNames : componentNames.length === 1 ? componentNames : [];
  }

  const matchingComponents = componentNames
    .map((name) => {
      let units = parseQuantities(components[name]?.available_WithQty).filter(
        (entry) => entry.units > 0,
      );
      if (bloodGroupName) {
        const wantedGroup = bloodGroupName.toLowerCase();
        units = units.filter((entry) => entry.group.toLowerCase() === wantedGroup);
      }
      return {
        component: name,
        units,
        total: units.reduce((sum, entry) => sum + entry.units, 0),
      };
    })
    .filter((component) => component.total > 0);

  return {
    components: matchingComponents,
    totalUnits: matchingComponents.reduce((sum, component) => sum + component.total, 0),
  };
}

// Units per blood group for one component of a bank, e.g. for
// "Packed Red Blood Cells" -> [{ group: "O-Ve", units: 3 }, ...]. Zero-unit groups dropped.
export function unitsForComponent(bank, componentName) {
  const components = bank?.components ?? {};
  const componentNames = Object.keys(components);
  const wantedComponent = componentName?.toLowerCase();
  const componentKey =
    componentNames.find((name) => name.toLowerCase() === wantedComponent) ??
    (componentNames.length === 1 ? componentNames[0] : null); // eRaktKosh already filtered by componentId
  if (!componentKey) return [];
  return parseQuantities(components[componentKey]?.available_WithQty).filter(
    (entry) => entry.units > 0,
  );
}

// "Phone: 9763245312 ,Fax: -, Email: x@y.com" -> "9763245312"
export function extractPhone(contactText) {
  if (!contactText || typeof contactText !== "string") return null;
  const match = contactText.match(/Phone:\s*([+\d][\d\s-]{5,}\d)/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

// eRaktKosh's entrydate is "YYYY-MM-DD HH:mm:ss" in Indian time.
export function parseEntryDate(entryDate) {
  if (!entryDate || typeof entryDate !== "string") return null;
  const date = new Date(entryDate.trim().replace(" ", "T") + "+05:30");
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUpdatedAgo(entryDate, now = new Date()) {
  const date = parseEntryDate(entryDate);
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
    entryDate: row.entrydate ?? null,
    stock: summarizeStock(row, filters),
  };
}
