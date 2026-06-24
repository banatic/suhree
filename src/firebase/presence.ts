import { ref, onValue, onDisconnect, set, push, serverTimestamp } from "firebase/database";
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
 * user offline.
 */
let heartbeatTimer: number | null = null;
let conRef: ReturnType<typeof push> | null = null;

export function setupPresence(uid: string): void {
  const connectedRef = ref(db, ".info/connected");
  const connsRef = r(paths.presenceConnections(uid));
  const lastSeenRef = r(paths.presenceLastSeen(uid));

  const beat = (): void => {
    set(lastSeenRef, serverTimestamp()).catch(() => {});
    // Refresh our marker too — re-creates it if it was somehow removed while we're still alive.
    if (conRef) set(conRef, serverTimestamp()).catch(() => {});
  };

  onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    // Fresh marker for this (re)connection; register cleanup BEFORE writing so a crash can't strand it.
    conRef = push(connsRef);
    onDisconnect(conRef).remove().catch(() => {});
    onDisconnect(lastSeenRef).set(serverTimestamp()).catch(() => {});
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
