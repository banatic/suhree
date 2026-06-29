import { get, set, serverTimestamp } from "firebase/database";
import { r, paths } from "../firebase/db";
import { BALANCE } from "../config/balance";
import { store } from "../state";
import { serverNow } from "../firebase/time";

/** ms left on a cooldown given its start stamp (server ms). 0 if absent/expired. */
export function cooldownRemainingFromStamp(stamp: number | null | undefined): number {
  if (stamp == null) return 0;
  return Math.max(0, stamp + BALANCE.raid.cooldownMs - serverNow());
}

/** Authoritative remaining ms from the server (use before committing to a raid). */
export async function getCooldownRemaining(targetUid: string, raiderUid: string): Promise<number> {
  const snap = await get(r(paths.cooldown(targetUid, raiderUid)));
  return cooldownRemainingFromStamp(snap.exists() ? (snap.val() as number) : null);
}

export async function isOnCooldown(targetUid: string, raiderUid: string): Promise<boolean> {
  return (await getCooldownRemaining(targetUid, raiderUid)) > 0;
}

export async function setCooldown(
  targetUid: string,
  raiderUid: string,
  durationMs: number = BALANCE.raid.cooldownMs,
): Promise<void> {
  // Everywhere computes `remaining = stamp + cooldownMs − now`, so a SHORTER cooldown is stored by
  // back-dating the start stamp by exactly (cooldownMs − durationMs). The full cooldown still uses
  // the authoritative server stamp.
  if (durationMs >= BALANCE.raid.cooldownMs) {
    await set(r(paths.cooldown(targetUid, raiderUid)), serverTimestamp());
  } else {
    const stamp = serverNow() - (BALANCE.raid.cooldownMs - durationMs);
    await set(r(paths.cooldown(targetUid, raiderUid)), stamp);
  }
}

/**
 * Optimistic local reflection for instant feedback; the per-friend cooldown subscription
 * reconciles it to the exact server value. `remainingMs` defaults to a fresh full window
 * (a raid that just ended); pass the real remaining when reusing an existing cooldown.
 */
export function markFriendCooldown(targetUid: string, remainingMs = BALANCE.raid.cooldownMs): void {
  const f = store.friends.find((x) => x.uid === targetUid);
  if (f) f.cooldownUntil = serverNow() + remainingMs; // server-clock absolute time
}
