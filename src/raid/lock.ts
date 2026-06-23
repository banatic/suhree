import { runTransaction, get, set } from "firebase/database";
import { r, paths } from "../firebase/db";
import { BALANCE } from "../config/balance";

export interface LockResult {
  ok: boolean;
  reason?: "occupied";
}

/**
 * Acquire the single raid slot for `targetUid` via an RTDB transaction (optimistic
 * concurrency — only one raider wins). A lock older than `lockStaleMs` is treated as
 * abandoned (the previous raider crashed before onDisconnect fired) and overwritten.
 */
export async function acquireLock(
  targetUid: string,
  raiderUid: string,
  startedAt: number,
  durationMs: number,
): Promise<LockResult> {
  const res = await runTransaction(r(paths.raid(targetUid)), (cur) => {
    if (cur && cur.raiderUid) {
      const age = Date.now() - (cur.startedAt || 0);
      if (age < BALANCE.raid.lockStaleMs) return; // genuinely occupied → abort
    }
    return { raiderUid, startedAt, locked: true, durationMs };
  });
  if (res.committed && res.snapshot.exists() && res.snapshot.val()?.raiderUid === raiderUid) {
    return { ok: true };
  }
  return { ok: false, reason: "occupied" };
}

/** Release the lock — only if we still hold it. */
export async function releaseLock(targetUid: string, raiderUid: string): Promise<void> {
  const snap = await get(r(paths.raid(targetUid)));
  if (snap.exists() && snap.val()?.raiderUid === raiderUid) {
    await set(r(paths.raid(targetUid)), null);
  }
}
