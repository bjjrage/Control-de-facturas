/**
 * AUCTION SANDBOX — tiny pure formatters (no dependencies, client-safe).
 */

/**
 * "% por debajo del Ground Floor": ((floor - competitor) / floor) * 100.
 * INFORMATION for the human only — never a behavior band. Rounds to 4
 * decimals, trims zeros, es-PY comma decimals:
 *   floor 980000, comp 979999 → "~0,0001%"
 *   floor 980000, comp 833000 → "~15%"
 */
export function formatPctBelowGroundFloor(groundFloorPyg: number, competitorPricePyg: number): string {
  if (!Number.isFinite(groundFloorPyg) || groundFloorPyg <= 0) return '—';
  const pct = ((groundFloorPyg - competitorPricePyg) / groundFloorPyg) * 100;
  if (!(pct > 0)) return '0%';
  const rounded = Math.round(pct * 10000) / 10000;
  if (rounded <= 0) return '<0,0001%';
  return `~${rounded.toLocaleString('es-PY', { maximumFractionDigits: 4 })}%`;
}
