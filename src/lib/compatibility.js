import { BLOOD_GROUPS, getComponentName } from "./constants";

// Blood compatibility by component, for ranking sources.
// INFORMATIONAL ONLY: real transfusions always need cross-matching by a blood bank.
//
// Rules (recipient -> acceptable donor groups):
// - Red cells (PRBC, SAGM, irradiated, leukoreduced): donor red cells must not carry
//   antigens the recipient has antibodies to. O gives to all; AB receives from all.
// - Whole blood: contains both cells and plasma, so ABO must be identical.
// - Plasma, cryoprecipitate: the reverse of red cells. AB gives to all; O receives from all.
//   Rh does not matter.
// - Platelets: ABO by plasma rules; Rh-negative recipients get Rh-negative platelets.
// - Bombay (Oh) recipients only receive Bombay blood. Bombay donors are reserved
//   for Bombay recipients.
// - Rh for cellular products: Rh-negative recipients receive only Rh-negative.

export const MEDICAL_DISCLAIMER =
  "Compatibility shown here is informational. The blood bank must cross-match before any transfusion.";

// eRaktKosh component code -> compatibility category.
const COMPONENT_CATEGORIES = {
  11: "whole_blood",
  12: "red_cells",
  28: "red_cells",
  29: "red_cells",
  30: "red_cells",
  13: "plasma",
  17: "plasma",
  18: "plasma",
  19: "plasma",
  21: "plasma",
  14: "platelets",
  16: "platelets",
  20: "platelets",
  23: "platelets",
};

// Recipient ABO -> donor ABO groups whose red cells it can receive.
const RED_CELL_DONORS = { O: ["O"], A: ["A", "O"], B: ["B", "O"], AB: ["AB", "A", "B", "O"] };
// Recipient ABO -> donor ABO groups whose plasma it can receive.
const PLASMA_DONORS = { O: ["O", "A", "B", "AB"], A: ["A", "AB"], B: ["B", "AB"], AB: ["AB"] };

export function componentCategory(componentCode) {
  return COMPONENT_CATEGORIES[String(componentCode)] ?? null;
}

// "O-Ve" -> { abo: "O", rh: "-" }, "Oh+VE" -> { abo: "Oh", rh: "+" }
export function parseGroupName(name) {
  const match = typeof name === "string" ? name.trim().match(/^(AB|A|B|Oh|O)\s*([+-])/i) : null;
  if (!match) return null;
  const abo = match[1].toUpperCase() === "OH" ? "Oh" : match[1].toUpperCase();
  return { abo, rh: match[2] };
}

export function groupCodeForName(name) {
  const wantedName = typeof name === "string" ? name.trim().toLowerCase() : "";
  return BLOOD_GROUPS.find((group) => group.name.toLowerCase() === wantedName)?.code ?? null;
}

function isRhCompatible(recipientRh, donorRh, category) {
  if (category === "plasma") return true;
  return recipientRh === "+" || donorRh === "-";
}

function isAboCompatible(recipientAbo, donorAbo, category) {
  const isRecipientBombay = recipientAbo === "Oh";
  const isDonorBombay = donorAbo === "Oh";
  if (isRecipientBombay || isDonorBombay) return isRecipientBombay && isDonorBombay;
  if (category === "whole_blood") return recipientAbo === donorAbo;
  if (category === "red_cells") return RED_CELL_DONORS[recipientAbo].includes(donorAbo);
  return PLASMA_DONORS[recipientAbo].includes(donorAbo); // plasma and platelets
}

// Groups a recipient can receive for a component, exact match first.
// Returns [{ code, name, exact }]. With exactOnly, only the recipient's own group.
export function donorGroupsFor(recipientCode, componentCode, { exactOnly = false } = {}) {
  const recipient = BLOOD_GROUPS.find((group) => group.code === String(recipientCode));
  const category = componentCategory(componentCode);
  if (!recipient || !category) return [];
  const recipientGroup = parseGroupName(recipient.name);

  return BLOOD_GROUPS.filter((group) => {
    if (group.code === recipient.code) return true;
    if (exactOnly) return false;
    const donorGroup = parseGroupName(group.name);
    return (
      isAboCompatible(recipientGroup.abo, donorGroup.abo, category) &&
      isRhCompatible(recipientGroup.rh, donorGroup.rh, category)
    );
  })
    .map((group) => ({ code: group.code, name: group.name, exact: group.code === recipient.code }))
    .sort((a, b) => Number(b.exact) - Number(a.exact));
}

export function describeCompatibility(recipientCode, componentCode) {
  const groups = donorGroupsFor(recipientCode, componentCode);
  return {
    component: getComponentName(componentCode),
    category: componentCategory(componentCode),
    groups: groups.map((group) => group.name),
  };
}
