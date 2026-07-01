import { set, remove } from "firebase/database";
import { r, paths } from "../firebase/db";

/**
 * Join `targetUid`'s field as one of possibly-many concurrent raiders. Each raider owns their own
 * slot at raids/{targetUid}/raiders/{raiderUid}, so there is no lock and no contention — the uid
 * key guarantees uniqueness. The defender reconciles the raiders map (ignoring stale slots), and
 * onDisconnect removes just this slot if the raider's socket dies.
 */
export async function joinRaid(
  targetUid: string,
  raiderUid: string,
  startedAt: number,
  durationMs: number,
): Promise<void> {
  await set(r(paths.raidRaider(targetUid, raiderUid)), {
    startedAt,
    durationMs,
    evictHits: 0,
  });
}

/** Leave the field — remove ONLY my own slot, never the whole node (other raiders keep going). */
export async function leaveRaid(targetUid: string, raiderUid: string): Promise<void> {
  await remove(r(paths.raidRaider(targetUid, raiderUid)));
}
