// Ownership / unlock rules for cosmetics (decor, themes, titles). A cosmetic is either BUYABLE
// (price > 0, recorded in the user's `cosmetics` map once purchased) or an ACHIEVEMENT reward
// (price 0 + a `req` key, "owned" the moment the milestone is reached — never bought).

import { BALANCE, type CosmeticItem } from "../config/balance";
import { store } from "../state";
import { allDiscovered, harvestedCount } from "./dex";

/** Is an achievement condition (CosmeticItem.req) currently satisfied? No req → always true. */
export function reqMet(req: string | undefined): boolean {
  if (!req) return true;
  const u = store.user;
  switch (req) {
    case "dexComplete":
      return allDiscovered();
    case "plotMax":
      return (u?.plotSize ?? 0) >= BALANCE.shop.plotExpansion.maxSlots;
    case "scytheMaster":
      return (u?.scytheLv ?? 0) >= BALANCE.cosmetics.scytheMasterLv;
    case "scarecrowMaster":
      return (u?.scarecrowLv ?? 0) >= BALANCE.cosmetics.scarecrowMasterLv;
    default:
      return false;
  }
}

/**
 * Is a crop tier plantable? Normal tiers are always unlocked; SPECIAL tiers are gated —
 * either by a milestone `req` (the first one) or by a harvest chain (`afterTier`×`harvests`).
 */
export function cropUnlocked(tier: number): boolean {
  const t = BALANCE.crops.tiers[tier];
  if (!t || !t.special) return true;
  const g = t.unlock;
  if (!g) return true;
  if (g.req && !reqMet(g.req)) return false;
  if (g.afterTier != null && harvestedCount(g.afterTier) < (g.harvests ?? 1)) return false;
  return true;
}

/** Short Korean note for why a special crop is still locked (seed picker), or null if unlocked. */
export function cropLockReason(tier: number): string | null {
  if (cropUnlocked(tier)) return null;
  const g = BALANCE.crops.tiers[tier]?.unlock;
  if (!g) return null;
  if (g.req === "dexComplete") return "도감 완성 시 해금";
  if (g.afterTier != null) {
    const prev = BALANCE.crops.tiers[g.afterTier];
    return `${prev?.label ?? "이전 작물"} ${g.harvests ?? 1}번 수확 시 해금`;
  }
  return "잠김";
}

/** Can I equip this cosmetic? Free items unlock via their req; priced items via purchase. */
export function cosmeticOwned(item: CosmeticItem): boolean {
  if (item.price === 0) return reqMet(item.req);
  return !!store.user?.cosmetics?.[item.id];
}

/** Short Korean note for why a free item is still locked (shop UI), or null if owned/buyable. */
export function lockReason(item: CosmeticItem): string | null {
  if (cosmeticOwned(item)) return null;
  if (item.price > 0) return null; // not locked — just needs buying
  switch (item.req) {
    case "dexComplete":
      return "도감 완성 시 해금";
    case "plotMax":
      return "밭 최대 확장 시 해금";
    case "scytheMaster":
      return `낫 Lv${BALANCE.cosmetics.scytheMasterLv} 해금`;
    case "scarecrowMaster":
      return `허수아비 Lv${BALANCE.cosmetics.scarecrowMasterLv} 해금`;
    default:
      return "잠김";
  }
}
