import { ref, onValue, onDisconnect, set, serverTimestamp } from "firebase/database";
import { db } from "./app";
import { r, paths } from "./db";
import { BALANCE } from "../config/balance";

/**
 * Heartbeat presence (the "ping" model).
 *
 * The old per-connection-marker approach flipped users offline whenever Firebase recycled the
 * socket (idle/reconnect/sleep-resume): the server-side `onDisconnect` removed the marker, and the
 * `.info/connected` re-fire that should re-create it can be throttled in a hidden webview — so the
 * marker stayed gone while the app was alive. "Does a child exist" is a fragile signal.
 *
 * Instead we keep ONE value, `/presence/{uid}/lastSeen`, and re-stamp it on a timer. A reader treats
 * it as online iff it is fresh (`serverNow − lastSeen < onlineThresholdMs`). This is robust to socket
 * recycling and missed events, and multi-instance-safe: any live instance keeps the stamp fresh, and
 * once every instance is gone it simply goes stale.
 */
let heartbeatTimer: number | null = null;

export function setupPresence(uid: string): void {
  const connectedRef = ref(db, ".info/connected");
  const lastSeenRef = r(paths.presenceLastSeen(uid));

  const beat = (): void => {
    set(lastSeenRef, serverTimestamp()).catch(() => {
      /* offline writes are buffered by the SDK and flush on reconnect */
    });
  };

  onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    // Record an accurate "last seen" if we vanish, then stamp immediately so we appear online now.
    onDisconnect(lastSeenRef).set(serverTimestamp()).catch(() => {});
    beat();
  });

  // The ping: keep presence fresh while alive. Idempotent across repeated setupPresence calls.
  if (heartbeatTimer == null) {
    heartbeatTimer = window.setInterval(beat, BALANCE.presence.heartbeatMs);
  }
  // Re-ping the moment we regain focus/visibility (snappier re-appearance after sleep/minimise).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) beat();
  });
}
