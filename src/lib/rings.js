// Which search ring /api/blood-search takes its results from. Pure, so it can be tested.
// rings: radii in meters, smallest first. banks: [{ distanceM, isDormant, units }].
// Dormant banks (stock not updated for 30 days) are still listed, but they never
// decide the ring, because their stock can't be relied on.

// Ring radii in km, smallest first. The blood search (in meters, in its route) and the donor
// network's waves (src/lib/donorMatching.js) use the same rings.
export const URBAN_RINGS_KM = [5, 10, 15, 25];
export const RURAL_RINGS_KM = [20, 50, 100, 150];

const smallestRingWith = (rings, banks, isWanted) =>
  rings.find((radiusM) => banks.some((bank) => bank.distanceM <= radiusM && isWanted(bank))) ??
  null;

// Nearest mode: the smallest ring with an active stocked bank. When every stocked
// bank is dormant, the smallest ring with any of them, so they are still shown.
// null when no bank has stock.
export function nearestModeRing(rings, stockedBanks) {
  return (
    smallestRingWith(rings, stockedBanks, (bank) => !bank.isDormant) ??
    smallestRingWith(rings, stockedBanks, () => true)
  );
}

// Ranked mode: the smallest ring whose active banks hold the units needed, else
// the widest ring. null when no bank holds the blood group.
export function rankedModeRing(rings, usableBanks, unitsNeeded) {
  if (usableBanks.length === 0) return null;
  const activeUnitsWithin = (radiusM) =>
    usableBanks
      .filter((bank) => bank.distanceM <= radiusM && !bank.isDormant)
      .reduce((sum, bank) => sum + bank.units, 0);
  return rings.find((radiusM) => activeUnitsWithin(radiusM) >= unitsNeeded) ?? rings.at(-1);
}
