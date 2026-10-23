// Helpers for eRaktKosh stock data. Pure functions with no imports, so they are
// safe on client and server and in the Node scripts.

// The 10 blood-group names, spelt as in assets/district_data.json.
export const GROUP_NAMES = [
  "A+Ve",
  "A-Ve",
  "B+Ve",
  "B-Ve",
  "O+Ve",
  "O-Ve",
  "AB+Ve",
  "AB-Ve",
  "Oh+VE",
  "Oh-VE",
];
// Stock older than this is "dormant": still listed, but left out of plans.
export const DORMANT_DAYS = 30;

const GROUP_NAMES_BY_KEY = new Map(
  GROUP_NAMES.map((name) => [name.replace(/\s+/g, "").toUpperCase(), name]),
);

// Some banks write "O +ve" or "Oh +ve". Returns the canonical name, or null.
export function normalizeGroupName(label) {
  if (typeof label !== "string") return null;
  return GROUP_NAMES_BY_KEY.get(label.replace(/\s+/g, "").toUpperCase()) ?? null;
}

// "O-Ve : 3, A +ve : 86" -> [{ group: "O-Ve", units: 3 }, { group: "A+Ve", units: 86 }]
// Known groups get their canonical name; unknown labels are kept as written.
export function parseQuantities(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .split(",")
    .map((part) => part.trim().match(/^(.+?)\s*:\s*(\d+)$/))
    .filter(Boolean)
    .map((match) => ({
      group: normalizeGroupName(match[1]) ?? match[1].trim(),
      units: Number(match[2]),
    }));
}

// Components are matched by name only. eRaktKosh names a filtered component
// exactly as componentList does (checked for every component on 2026-10-24), and
// the saved copy holds every component, so a bank's only component must never
// stand in for the one asked for.

// Summarise the stock that matches the user's filters.
// eRaktKosh returns banks without matching stock too, so a bank only counts as a
// hit when this returns totalUnits > 0.
export function summarizeStock(bank, { componentName, bloodGroupName } = {}) {
  const components = bank?.components ?? {};
  let componentNames = Object.keys(components);

  if (componentName) {
    const wantedComponent = componentName.toLowerCase();
    componentNames = componentNames.filter((name) => name.toLowerCase() === wantedComponent);
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
  const wantedComponent = componentName?.toLowerCase();
  const componentKey = Object.keys(components).find(
    (name) => name.toLowerCase() === wantedComponent,
  );
  if (!componentKey) return [];
  return parseQuantities(components[componentKey]?.available_WithQty).filter(
    (entry) => entry.units > 0,
  );
}

// Rows cut down to one component, the shape eRaktKosh returns when filtered by
// componentId: banks that don't list the component are left out, and the others
// keep only that component. Used for the saved copy, which holds every component.
export function keepOnlyComponent(rows, componentName) {
  const wantedComponent = componentName.toLowerCase();
  return rows.flatMap((row) => {
    const componentKey = Object.keys(row.components ?? {}).find(
      (name) => name.toLowerCase() === wantedComponent,
    );
    return componentKey
      ? [{ ...row, components: { [componentKey]: row.components[componentKey] } }]
      : [];
  });
}

// Units of exactly one blood group for one component, or 0. Ranked search lists a
// bank only when this is above 0; compatible substitute groups don't count.
export function exactGroupUnits(bank, componentName, bloodGroupName) {
  const wantedGroup = bloodGroupName?.toLowerCase();
  return unitsForComponent(bank, componentName)
    .filter((entry) => entry.group.toLowerCase() === wantedGroup)
    .reduce((sum, entry) => sum + entry.units, 0);
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

export function isDormant(entryDate, now = new Date()) {
  const date = parseEntryDate(entryDate);
  return date !== null && now - date > DORMANT_DAYS * 86_400_000;
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
