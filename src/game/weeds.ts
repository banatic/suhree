// 잡초(weed) griefing. While raiding, a thief can plant a weed in an EMPTY slot of the victim's
// plot; the owner must click it BALANCE.weed.removeClicks times to pull it before that slot can be
// replanted. Weeds live at plots/{uid}/weeds/{slot} — the same plot node a raider may already write
// to during a raid, so no new permission is needed (see database.rules.json).

import { set, remove, update, serverTimestamp } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, type WeedData } from "../state";
import { BALANCE } from "../config/balance";

// Slots I planted a weed in during the CURRENT raid. The 낙서 카드 is drawn after the raid is over
// (drawing mid-raid would freeze a timed run), so we have to remember where to stamp it.
let plantedThisRaid: { victimUid: string; slots: number[] } = { victimUid: "", slots: [] };

/** Slots I weeded in this raid on `victimUid` (empty once the raid is finalized). */
export function myWeedSlots(victimUid: string): number[] {
  return plantedThisRaid.victimUid === victimUid ? [...plantedThisRaid.slots] : [];
}

/** Forget the current raid's weeds — called when a raid ends, after any card has been attached. */
export function clearMyWeedSlots(): void {
  plantedThisRaid = { victimUid: "", slots: [] };
}

/** Raider plants a weed in an empty slot of the victim's plot. False if not raiding / slot taken. */
export async function plantWeed(victimUid: string, slot: number): Promise<boolean> {
  const raid = store.raid;
  if (raid.role !== "raiding" || raid.resolved || raid.targetUid !== victimUid) return false;
  const key = String(slot);
  if (raid.targetCrops?.[key] || raid.targetWeeds?.[key]) return false; // slot must be empty
  const nick = store.user?.nickname || "누군가";
  const skin = store.user?.equippedWeedSkin;
  const mark = skin && skin !== "weed_default" ? { skin } : {};
  raid.targetWeeds = { ...(raid.targetWeeds ?? {}), [key]: { by: store.uid, at: Date.now(), nick, ...mark } }; // optimistic
  try {
    await set(r(paths.weed(victimUid, slot)), { by: store.uid, at: serverTimestamp(), nick, ...mark });
    if (plantedThisRaid.victimUid !== victimUid) plantedThisRaid = { victimUid, slots: [] };
    plantedThisRaid.slots.push(slot);
    return true;
  } catch {
    if (raid.targetWeeds) delete raid.targetWeeds[key];
    return false;
  }
}

/** Stamp the 낙서 onto every weed I planted in this raid. MUST run while the raid lock is still held —
 *  the plot write rule only lets a raider through while they hold it (see database.rules.json). */
export async function attachDoodleToMyWeeds(victimUid: string, art: string): Promise<void> {
  const slots = myWeedSlots(victimUid);
  if (!slots.length || !art || art.length > BALANCE.doodle.maxLen) return;
  const cardSkin = store.user?.equippedMsgSkin || "skin_plain";
  await Promise.all(
    slots.map((slot) =>
      // update(), not set(): the weed record already holds by/at/nick/skin and a set would blow
      // them away, leaving a weed nobody can attribute.
      update(r(paths.weed(victimUid, slot)), { art, cardSkin }).catch(() => {}),
    ),
  );
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
