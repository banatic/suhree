import { set, remove, serverTimestamp } from "firebase/database";
import { BALANCE, type CropTier } from "../config/balance";
import { r, paths } from "../firebase/db";
import { store, toast } from "../state";
import { addCoins, trySpend } from "./economy";
import { sellValue } from "./market";
import { recordDex } from "./dex";

export type Stage = "empty" | "seed" | "sprout" | "growing" | "ripe";

export function tierOf(tier: number): CropTier | undefined {
  return BALANCE.crops.tiers[tier];
}

/** Cumulative stage thresholds (ms from plantedAt). After `growing` the crop is ripe forever. */
function thresholds(t: CropTier): [number, number, number] {
  const s = t.stages;
  const a1 = s.seed;
  const a2 = a1 + s.sprout;
  const a3 = a2 + s.growing;
  return [a1, a2, a3];
}

export function stageOf(plantedAt: number, tier: number, now: number): Stage {
  const t = tierOf(tier);
  if (!t) return "empty";
  const age = now - plantedAt;
  const [a1, a2, a3] = thresholds(t);
  if (age < a1) return "seed";
  if (age < a2) return "sprout";
  if (age < a3) return "growing";
  return "ripe"; // ripe never decays — it waits to be harvested or stolen
}

/** 0..1 progress through the whole grow cycle up to ripe (for a growth bar). */
export function growthFraction(plantedAt: number, tier: number, now: number): number {
  const t = tierOf(tier);
  if (!t) return 0;
  const [, , a3] = thresholds(t);
  return Math.max(0, Math.min(1, (now - plantedAt) / a3));
}

/** ms remaining until ripe (0 if already ripe). */
export function msToRipe(plantedAt: number, tier: number, now: number): number {
  const t = tierOf(tier);
  if (!t) return 0;
  const [, , a3] = thresholds(t);
  return Math.max(0, plantedAt + a3 - now);
}

export function ripeValue(tier: number): number {
  return tierOf(tier)?.harvestValue ?? 0;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function plant(uid: string, slot: number, tier: number): Promise<boolean> {
  const t = tierOf(tier);
  if (!t) return false;
  if (store.crops[String(slot)]) {
    toast("이미 작물이 있어요");
    return false;
  }
  if (!(await trySpend(uid, t.price))) {
    toast("코인이 부족해요");
    return false;
  }
  // serverTimestamp keeps stage agreement across players (raider reads plantedAt).
  await set(r(paths.crop(uid, slot)), { tier, plantedAt: serverTimestamp() });
  store.crops[String(slot)] = { tier, plantedAt: Date.now() }; // optimistic; listener corrects
  toast(`${t.label} 씨앗을 심었어요`);
  return true;
}

export async function harvest(uid: string, slot: number): Promise<number> {
  const key = String(slot);
  const c = store.crops[key];
  if (!c) return 0;
  if (stageOf(c.plantedAt, c.tier, Date.now()) !== "ripe") return 0;
  const value = sellValue(c.tier); // base × today's market factor
  // Remove locally FIRST so a rapid double-click can't harvest (and credit) the same crop twice.
  delete store.crops[key];
  await remove(r(paths.crop(uid, slot)));
  await addCoins(uid, value); // direct harvest = 100% of today's sell price
  void recordDex(uid, c.tier, "harvest");
  toast(`+${value} 코인`);
  return value;
}
