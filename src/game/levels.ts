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

/**
 * Active raid — clicks the RAIDER must land on a single ripe crop to steal it.
 * Defence (target's scarecrow) makes crops tougher; attack (raider's scythe) makes them easier.
 * Logarithmic so infinite levels still asymptote, then clamped and rounded to a whole number.
 */
export function cropClicksToSteal(targetScarecrowLv: number, thiefScytheLv: number): number {
  const { base, kDef, kAtk, min, max } = BALANCE.raidGame.steal;
  const n =
    base +
    kDef * Math.log(1 + Math.max(0, targetScarecrowLv)) -
    kAtk * Math.log(1 + Math.max(0, thiefScytheLv));
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Active raid — hits the DEFENDER must land on the raider's cursor to evict them.
 * Attack (raider's scythe) makes the raider slipperier; defence (defender's scarecrow) catches faster.
 */
export function evictHitsNeeded(thiefScytheLv: number, defenderScarecrowLv: number): number {
  const { base, kAtk, kDef, min, max } = BALANCE.raidGame.evict;
  const n =
    base +
    kAtk * Math.log(1 + Math.max(0, thiefScytheLv)) -
    kDef * Math.log(1 + Math.max(0, defenderScarecrowLv));
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function levelCost(kind: "scarecrow" | "scythe", currentLv: number): number {
  const c = BALANCE.shop[kind];
  return Math.round(c.baseCost * Math.pow(c.growth, currentLv));
}

export function plotCost(ownedSlots: number): number {
  const c = BALANCE.shop.plotExpansion;
  return Math.round(c.baseCost * Math.pow(c.growth, ownedSlots - c.startSlots));
}
