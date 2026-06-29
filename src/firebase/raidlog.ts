// Server-wide 서리(steal) feed. One append per raid that looted at least one crop, so anyone can
// see who's been robbing whom across the whole server. Spark-friendly like the village chat: no
// Cloud Functions / server pruning — readers only pull the most recent N entries (limitToLast),
// and the node grows slowly (one write per successful raid).

import { push, set, serverTimestamp, query, limitToLast, onValue } from "firebase/database";
import { r, paths } from "./db";
import { store, markPanelsDirty, type RaidLogEntry } from "../state";
import { BALANCE } from "../config/balance";

/** Mirror the most-recent slice of the feed into the store (oldest→newest). */
export function subscribeRaidLog(): void {
  const q = query(r(paths.raidlog()), limitToLast(BALANCE.raidLog.keep));
  onValue(q, (snap) => {
    const v = (snap.val() as Record<string, any>) || {};
    store.raidlog = Object.entries(v)
      .map(
        ([id, m]) =>
          ({
            id,
            raider: m.raider,
            raiderNick: m.raiderNick,
            victim: m.victim,
            victimNick: m.victimNick,
            coins: Number(m.coins) || 0,
            count: Number(m.count) || 0,
            at: m.at,
          }) as RaidLogEntry,
      )
      .sort((a, b) => a.at - b.at);
    // The feed panel is read-only (no input to clobber), so a dirty flag is enough to refresh it.
    if (store.ui.panel === "raidlog") markPanelsDirty();
  });
}

/** Append one finished-raid summary. Fire-and-forget; failures are non-fatal (loot already paid). */
export async function logRaid(
  victimUid: string,
  victimNick: string,
  coins: number,
  count: number,
): Promise<void> {
  const raiderNick = (store.user?.nickname || "농부").slice(0, 16);
  try {
    await set(push(r(paths.raidlog())), {
      raider: store.uid,
      raiderNick,
      victim: victimUid,
      victimNick: (victimNick || "농부").slice(0, 16),
      coins,
      count,
      at: serverTimestamp(),
    });
  } catch {
    /* ignore transient write errors */
  }
}
