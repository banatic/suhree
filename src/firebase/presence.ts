import { ref, onValue, onDisconnect, set, push, serverTimestamp } from "firebase/database";
import { db } from "./app";
import { r, paths } from "./db";

/**
 * Presence via per-connection markers (multi-instance safe).
 *
 * Each running instance pushes a child under `/presence/{uid}/connections` and removes it
 * `onDisconnect`. A user is "online" iff that node has ANY child — so a second window, or a
 * brief reconnect, never wrongly flips friends offline (the old single `online` boolean did:
 * closing one instance, or one socket hiccup, set everyone offline). `lastSeen` is stamped
 * on disconnect.
 */
export function setupPresence(uid: string): void {
  const connectedRef = ref(db, ".info/connected");
  const connsRef = r(paths.presenceConnections(uid));
  const lastSeenRef = r(paths.presenceLastSeen(uid));

  onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    const conRef = push(connsRef);
    // Register the cleanup BEFORE claiming presence, so a crash can't strand the marker.
    onDisconnect(conRef).remove();
    onDisconnect(lastSeenRef).set(serverTimestamp());
    set(conRef, true).catch(() => {
      /* transient; a new connection marker is added on the next connect event */
    });
  });
}
