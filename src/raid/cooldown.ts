import { get, set, serverTimestamp } from "firebase/database";
import { r, paths } from "../firebase/db";
import { BALANCE } from "../config/balance";
import { store } from "../state";

export async function isOnCooldown(targetUid: string, raiderUid: string): Promise<boolean> {
  const snap = await get(r(paths.cooldown(targetUid, raiderUid)));
  if (!snap.exists()) return false;
  const at = snap.val() as number;
  return Date.now() - at < BALANCE.raid.cooldownMs;
}

export async function setCooldown(targetUid: string, raiderUid: string): Promise<void> {
  await set(r(paths.cooldown(targetUid, raiderUid)), serverTimestamp());
}

/** Reflect the cooldown locally so the friends panel shows it immediately. */
export function markFriendCooldown(targetUid: string): void {
  const f = store.friends.find((x) => x.uid === targetUid);
  if (f) f.cooldownUntil = Date.now() + BALANCE.raid.cooldownMs;
}
