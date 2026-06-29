import { update } from "firebase/database";
import { BALANCE } from "../config/balance";
import { r, paths } from "../firebase/db";
import { store, toast, markPanelsDirty } from "../state";
import { trySpend } from "./economy";
import { levelCost, plotCost } from "./levels";

export async function buyPlotExpansion(uid: string): Promise<boolean> {
  const u = store.user;
  if (!u) return false;
  if (u.plotSize >= BALANCE.shop.plotExpansion.maxSlots) {
    toast("밭이 이미 최대 크기예요");
    return false;
  }
  const cost = plotCost(u.plotSize);
  if (!(await trySpend(uid, cost))) {
    toast("코인이 부족해요");
    return false;
  }
  await update(r(paths.user(uid)), { plotSize: u.plotSize + 1 });
  u.plotSize += 1;
  toast("밭을 넓혔어요");
  markPanelsDirty();
  return true;
}

export async function buyLevel(uid: string, kind: "scarecrow" | "scythe"): Promise<boolean> {
  const u = store.user;
  if (!u) return false;
  const lv = kind === "scarecrow" ? u.scarecrowLv : u.scytheLv;
  const cost = levelCost(kind, lv);
  if (!(await trySpend(uid, cost))) {
    toast("코인이 부족해요");
    return false;
  }
  const field = kind === "scarecrow" ? "scarecrowLv" : "scytheLv";
  await update(r(paths.user(uid)), { [field]: lv + 1 });
  if (kind === "scarecrow") u.scarecrowLv += 1;
  else u.scytheLv += 1;
  toast(kind === "scarecrow" ? "허수아비 강화!" : "낫 강화!");
  markPanelsDirty();
  return true;
}

export type CosmeticType = "decor" | "msgSkin" | "theme" | "title";

export async function buyCosmetic(
  uid: string,
  type: CosmeticType,
  id: string,
  price: number,
): Promise<boolean> {
  const u = store.user;
  if (!u) return false;
  if (u.cosmetics?.[id]) {
    await equipCosmetic(uid, type, id);
    return true;
  }
  if (!(await trySpend(uid, price))) {
    toast("코인이 부족해요");
    return false;
  }
  u.cosmetics = { ...(u.cosmetics ?? {}), [id]: true };
  await update(r(paths.user(uid)), { [`cosmetics/${id}`]: true });
  await equipCosmetic(uid, type, id);
  toast("구매 완료!");
  return true;
}

const EQUIP_FIELD: Record<CosmeticType, "equippedDecor" | "equippedMsgSkin" | "equippedTheme" | "equippedTitle"> = {
  decor: "equippedDecor",
  msgSkin: "equippedMsgSkin",
  theme: "equippedTheme",
  title: "equippedTitle",
};

export async function equipCosmetic(uid: string, type: CosmeticType, id: string): Promise<void> {
  const u = store.user;
  if (!u) return;
  const field = EQUIP_FIELD[type];
  await update(r(paths.user(uid)), { [field]: id });
  u[field] = id;
  markPanelsDirty();
}
