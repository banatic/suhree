import { ref, onValue, onDisconnect, set, push, get, remove, child, serverTimestamp } from "firebase/database";
import { db } from "./app";
import { r, paths } from "./db";
import { BALANCE } from "../config/balance";

/**
 * Dual-signal presence — robust against the two ways a *live* user wrongly looked offline:
 *
 *  1) Heartbeat: re-stamp `/presence/{uid}/lastSeen` every heartbeatMs (the "ping"). Survives socket
 *     recycling and is multi-instance-safe, but a backgrounded strip's setInterval is throttled by
 *     Chromium to ~once/min, so on its own it needs a generous freshness window.
 *  2) Socket marker: push a child under `/presence/{uid}/connections`, removed `onDisconnect`. The
 *     websocket keepalive is NOT throttled by the JS timer governor, so the marker stays present
 *     while the app is alive even when the heartbeat is throttled, and the server removes it within
 *     seconds of an actual disconnect/crash.
 *
 * A reader treats the user as online if EITHER signal says so, so neither failure mode flips a live
 * user offline. Both signals carry a serverTimestamp so the reader can ignore STALE ones: onDisconnect
 * removal is best-effort (a crash / ungraceful close / a network drop before the handler registers can
 * strand a marker), and a marker that merely counted by existence would pin a long-gone user "online"
 * forever. We re-stamp the live marker every heartbeat so an orphan ages out of the freshness window.
 */
let heartbeatTimer: number | null = null;
let conRef: ReturnType<typeof push> | null = null;

/** Remove our own connection markers whose last stamp is older than the reader's freshness window. */
async function sweepStaleConnections(connsRef: ReturnType<typeof r>): Promise<void> {
  try {
    const snap = await get(connsRef);
    const conns = (snap.val() as Record<string, unknown>) || {};
    const cutoff = Date.now() - BALANCE.presence.onlineThresholdMs;
    await Promise.all(
      Object.entries(conns)
        .filter(([, v]) => typeof v !== "number" || (v as number) < cutoff)
        .map(([k]) => remove(child(connsRef, k)).catch(() => {})),
    );
  } catch {
    /* best-effort cleanup */
  }
}

export function setupPresence(uid: string): void {
  const connectedRef = ref(db, ".info/connected");
  const connsRef = r(paths.presenceConnections(uid));
  const lastSeenRef = r(paths.presenceLastSeen(uid));

  const beat = (): void => {
    set(lastSeenRef, serverTimestamp()).catch(() => {});
    // Refresh our marker too — re-creates it if it was somehow removed while we're still alive, and
    // re-stamps its timestamp so the reader keeps counting us as a fresh connection.
    if (conRef) set(conRef, serverTimestamp()).catch(() => {});
  };

  onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    // Purge any orphaned markers from a prior crash so they don't accumulate in the DB.
    void sweepStaleConnections(connsRef);
    // Fresh marker for this (re)connection; register cleanup BEFORE writing so a crash can't strand it.
    conRef = push(connsRef);
    onDisconnect(conRef).remove().catch(() => {});
    // Stamp the marker immediately so it never lingers value-less (a null-valued child would read as a
    // non-numeric, hence always-stale, marker — harmless, but this keeps the fast path clean).
    beat();
  });

  // The ping: keep presence fresh while alive. Idempotent across repeated setupPresence calls.
  if (heartbeatTimer == null) {
    heartbeatTimer = window.setInterval(beat, BALANCE.presence.heartbeatMs);
  }
  // Beat the instant we regain focus/visibility (snappy re-appearance after sleep/minimise/fullscreen).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) beat();
  });
  window.addEventListener("focus", beat);
}
