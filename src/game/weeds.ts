// 잡초(weed) griefing. While raiding, a thief can plant a weed in an EMPTY slot of the victim's
// plot; the owner must click it BALANCE.weed.removeClicks times to pull it before that slot can be
// replanted. Weeds live at plots/{uid}/weeds/{slot} — the same plot node a raider may already write
// to during a raid, so no new permission is needed (see database.rules.json).

import { set, remove, serverTimestamp } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, type WeedData } from "../state";

/** Raider plants a weed in an empty slot of the victim's plot. False if not raiding / slot taken. */
export async function plantWeed(victimUid: string, slot: number): Promise<boolean> {
  const raid = store.raid;
  if (raid.role !== "raiding" || raid.resolved || raid.targetUid !== victimUid) return false;
  const key = String(slot);
  if (raid.targetCrops?.[key] || raid.targetWeeds?.[key]) return false; // slot must be empty
  raid.targetWeeds = { ...(raid.targetWeeds ?? {}), [key]: { by: store.uid, at: Date.now() } }; // optimistic
  try {
    await set(r(paths.weed(victimUid, slot)), { by: store.uid, at: serverTimestamp() });
    return true;
  } catch {
    if (raid.targetWeeds) delete raid.targetWeeds[key];
    return false;
  }
}

/** Owner pulls a fully-clicked weed from their own plot, freeing the slot. */
export async function removeWeed(slot: number): Promise<void> {
  const key = String(slot);
  if (!store.weeds[key]) return;
  delete store.weeds[key]; // optimistic; the subscription restores it if the delete fails
  try {
    await remove(r(paths.weed(store.uid, slot)));
  } catch {
    /* ignore */
  }
}
