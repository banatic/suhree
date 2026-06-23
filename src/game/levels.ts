import { BALANCE } from "../config/balance";

/**
 * Steal time T in seconds. Logarithmic in both levels so infinite levels still
 * have an asymptote (diminishing returns), then clamped to [min, max].
 *   T = base + a·ln(1 + scarecrowLv) − b·ln(1 + scytheLv)
 */
export function raidSeconds(targetScarecrowLv: number, thiefScytheLv: number): number {
  const { baseSeconds, aScarecrow, bScythe, minSeconds, maxSeconds } = BALANCE.raid;
  const t =
    baseSeconds +
    aScarecrow * Math.log(1 + Math.max(0, targetScarecrowLv)) -
    bScythe * Math.log(1 + Math.max(0, thiefScytheLv));
  return Math.max(minSeconds, Math.min(maxSeconds, t));
}

export function levelCost(kind: "scarecrow" | "scythe", currentLv: number): number {
  const c = BALANCE.shop[kind];
  return Math.round(c.baseCost * Math.pow(c.growth, currentLv));
}

export function plotCost(ownedSlots: number): number {
  const c = BALANCE.shop.plotExpansion;
  return Math.round(c.baseCost * Math.pow(c.growth, ownedSlots - c.startSlots));
}
