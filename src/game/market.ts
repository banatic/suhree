// Daily crop market. The SELL price of each crop drifts day to day so "what's worth planting /
// harvesting today" becomes a small strategic choice. Seed BUY prices stay fixed.
//
// Spark plan = no Cloud Functions, so there's no server-rolled price. Instead the multiplier is a
// PURE function of (KST day index, tier): every client computes the same value with no backend and
// no stored state. Uses serverNow() (server-clock) so all clients agree on which day it is.

import { BALANCE } from "../config/balance";
import { serverNow } from "../firebase/time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day index on the server clock, shifted so the price rolls over at KST (UTC+9) midnight. */
export function marketDay(): number {
  return Math.floor((serverNow() + BALANCE.market.dayOffsetMs) / DAY_MS);
}

/** Deterministic 32-bit hash of (day, tier) → spreads consecutive days/tiers apart. */
function hash(day: number, tier: number): number {
  let h = (day * 0x9e3779b1 + tier * 0x85ebca77 + 0x165667b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** Today's sell-price multiplier for a crop tier (e.g. 0.7 .. 1.6). Deterministic, no RNG. */
export function priceFactor(tier: number, day: number = marketDay()): number {
  const { minFactor, steps, stepSize } = BALANCE.market;
  const bucket = hash(day, tier) % steps;
  // round to kill binary float drift (0.7000000001) so the ×label is exact
  return Math.round((minFactor + bucket * stepSize) * 100) / 100;
}

/** Base (un-multiplied) harvest value of a tier, straight from the balance table. */
export function baseValue(tier: number): number {
  return BALANCE.crops.tiers[tier]?.harvestValue ?? 0;
}

/** Coins a crop sells for TODAY (base × today's factor). Used for both harvest and raid steals. */
export function sellValue(tier: number): number {
  return Math.round(baseValue(tier) * priceFactor(tier));
}

/** Tier with the highest multiplier today (for a "오늘의 인기 작물" highlight). */
export function topCropTier(): number {
  const day = marketDay();
  let best = 0;
  let bestF = -Infinity;
  for (let t = 0; t < BALANCE.crops.tiers.length; t++) {
    const f = priceFactor(t, day);
    if (f > bestF) {
      bestF = f;
      best = t;
    }
  }
  return best;
}

/** Compact "×1.3 📈" / "×0.8 📉" / "×1.0 ➖" label for UI. */
export function factorLabel(tier: number): string {
  const f = priceFactor(tier);
  const arrow = f > 1 ? "📈" : f < 1 ? "📉" : "➖";
  return `×${f.toFixed(1)} ${arrow}`;
}
