import { set, remove, serverTimestamp } from "firebase/database";
import { BALANCE, type CropTier } from "../config/balance";
import { r, paths } from "../firebase/db";
import { store, toast } from "../state";
import { addCoins, trySpend } from "./economy";
import { sellValue } from "./market";
import { recordDex } from "./dex";
import { cropUnlocked, cropLockReason } from "./unlocks";
import { playPlant, playHarvest } from "../sfx";

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

// Slots with a plant/harvest write in flight. Both actions await a coin transaction and a DB
// write before `store.crops` reflects the result, so without this a rapid double-click on the
// same slot passes the "empty slot" check twice and pays for the seed twice.
const busySlots = new Set<number>();

export async function plant(uid: string, slot: number, tier: number): Promise<boolean> {
  const t = tierOf(tier);
  if (!t) return false;
  if (!cropUnlocked(tier)) {
    toast(`🔒 ${cropLockReason(tier) ?? "아직 심을 수 없어요"}`);
    return false;
  }
  if (store.crops[String(slot)]) {
    toast("이미 작물이 있어요");
    return false;
  }
  if (busySlots.has(slot)) return false; // extra click while this slot is still being written
  busySlots.add(slot);
  try {
    if (!(await trySpend(uid, t.price))) {
      toast("코인이 부족해요");
      return false;
    }
    try {
      // serverTimestamp keeps stage agreement across players (raider reads plantedAt).
      await set(r(paths.crop(uid, slot)), { tier, plantedAt: serverTimestamp() });
    } catch {
      await addCoins(uid, t.price); // write failed → nothing was planted, give the seed cost back
      toast("씨앗을 심지 못했어요");
      return false;
    }
    store.crops[String(slot)] = { tier, plantedAt: Date.now() }; // optimistic; listener corrects
    toast(`${t.label} 씨앗을 심었어요`);
    playPlant();
    return true;
  } finally {
    busySlots.delete(slot);
  }
}

export async function harvest(uid: string, slot: number): Promise<number> {
  const key = String(slot);
  const c = store.crops[key];
  if (!c) return 0;
  if (stageOf(c.plantedAt, c.tier, Date.now()) !== "ripe") return 0;
  if (busySlots.has(slot)) return 0;
  const value = sellValue(c.tier); // base × today's market factor
  // Remove locally FIRST so a rapid double-click can't harvest (and credit) the same crop twice.
  delete store.crops[key];
  // Hold the slot until the write lands, so the clicks that follow a harvest can't start a plant
  // against a slot the server still thinks is occupied.
  busySlots.add(slot);
  try {
    await remove(r(paths.crop(uid, slot)));
    await addCoins(uid, value); // direct harvest = 100% of today's sell price
  } finally {
    busySlots.delete(slot);
  }
  void recordDex(uid, c.tier, "harvest");
  toast(`+${value} 코인`);
  playHarvest();
  return value;
}
