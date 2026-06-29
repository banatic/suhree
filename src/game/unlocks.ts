// Ownership / unlock rules for cosmetics (decor, themes, titles). A cosmetic is either BUYABLE
// (price > 0, recorded in the user's `cosmetics` map once purchased) or an ACHIEVEMENT reward
// (price 0 + a `req` key, "owned" the moment the milestone is reached — never bought).

import { BALANCE, type CosmeticItem } from "../config/balance";
import { store } from "../state";
import { allDiscovered } from "./dex";

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
