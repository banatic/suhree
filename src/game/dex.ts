// Crop 도감 (collection). Records every crop the player has obtained — how many they've HARVESTED
// directly, and how many they've STOLEN (서리) and from whom. Collecting all crops pays a one-time
// coin bonus. Stored under users/{uid}/dex/{tier} = { h, s:{victimUid:count} }; the self
// subscription (subscribeSelf) echoes writes back into store.user, so reads come for free.

import { runTransaction } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, toast, markPanelsDirty } from "../state";
import { BALANCE } from "../config/balance";
import { addCoins } from "./economy";
import { tierOf } from "./crops";
import { playDexNew, playFanfare } from "../sfx";

type DexEntry = { h?: number; s?: Record<string, number> };

function entry(tier: number): DexEntry | undefined {
  return store.user?.dex?.[String(tier)];
}

export function harvestedCount(tier: number): number {
  return entry(tier)?.h ?? 0;
}

/** Per-victim steal counts for a tier, highest first (empty if never stolen). */
export function stolenBreakdown(tier: number): { uid: string; count: number }[] {
  const s = entry(tier)?.s ?? {};
  return Object.entries(s)
    .map(([uid, count]) => ({ uid, count: Number(count) || 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function stolenTotal(tier: number): number {
  return stolenBreakdown(tier).reduce((a, x) => a + x.count, 0);
}

export function isDiscovered(tier: number): boolean {
  const e = entry(tier);
  return !!e && ((e.h ?? 0) > 0 || stolenTotal(tier) > 0);
}

/** SPECIAL crops are a separate endgame track — they don't count toward base dex completion. */
function isBaseTier(tier: number): boolean {
  return !BALANCE.crops.tiers[tier]?.special;
}

/** Number of BASE (non-special) crops in the ladder — the denominator for completion. */
export function baseTierCount(): number {
  return BALANCE.crops.tiers.filter((t) => !t.special).length;
}

export function discoveredCount(): number {
  let n = 0;
  for (let t = 0; t < BALANCE.crops.tiers.length; t++) if (isBaseTier(t) && isDiscovered(t)) n++;
  return n;
}

export function allDiscovered(): boolean {
  return discoveredCount() >= baseTierCount();
}

/**
 * Bump the dex for a crop the player just obtained. `harvest` → h++, `steal` → s[victim]++.
 * The transaction runs against the server value (safe across tabs); the self subscription
 * refreshes store.user + flags the panels dirty, so we don't mutate the store here.
 */
export async function recordDex(
  uid: string,
  tier: number,
  kind: "harvest" | "steal",
  victimUid?: string,
): Promise<void> {
  const wasNew = !isDiscovered(tier);
  try {
    await runTransaction(r(paths.dexTier(uid, tier)), (cur: DexEntry | null) => {
      const e: DexEntry = cur || {};
      if (kind === "harvest") {
        e.h = (e.h ?? 0) + 1;
      } else {
        const v = victimUid || "unknown";
        e.s = { ...(e.s ?? {}), [v]: (e.s?.[v] ?? 0) + 1 };
      }
      return e;
    });
  } catch {
    return; // ignore transient write errors — the crop value was already credited
  }
  if (wasNew) {
    toast(`📖 도감에 새 작물 발견: ${tierOf(tier)?.label ?? "작물"}!`);
    playDexNew();
  }
}

/** Pay the completion bonus once, guarded by an atomic flip of dexClaimed false→true. */
export async function claimDexReward(uid: string): Promise<void> {
  if (!store.user) return;
  if (!allDiscovered()) {
    toast("아직 도감을 다 채우지 못했어요");
    return;
  }
  if (store.user.dexClaimed) {
    toast("이미 보상을 받았어요");
    return;
  }
  let won = false;
  try {
    const res = await runTransaction(r(paths.dexClaimed(uid)), (cur) => {
      if (cur === true) return; // already claimed → abort
      return true;
    });
    won = res.committed && res.snapshot.val() === true;
  } catch {
    return;
  }
  if (!won) {
    toast("이미 보상을 받았어요");
    return;
  }
  store.user.dexClaimed = true;
  await addCoins(uid, BALANCE.dex.completionReward).catch(() => {});
  toast(`🏆 도감 완성! +${BALANCE.dex.completionReward} 코인`);
  playFanfare();
  markPanelsDirty();
}
