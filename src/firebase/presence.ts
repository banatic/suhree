import { ref, onValue, onDisconnect, set, serverTimestamp } from "firebase/database";
import { db } from "./app";
import { r, paths } from "./db";

/**
 * Standard Firebase presence: watch `.info/connected`; on (re)connect register the
 * onDisconnect handler FIRST, then mark ourselves online. RTDB flips us offline
 * automatically if the socket drops (app closed, network lost, crash).
 */
export function setupPresence(uid: string): void {
  const connectedRef = ref(db, ".info/connected");
  const presRef = r(paths.presence(uid));

  onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    onDisconnect(presRef)
      .set({ online: false, lastSeen: serverTimestamp() })
      .then(() => {
        set(presRef, { online: true, lastSeen: serverTimestamp() });
      })
      .catch(() => {
        /* offline; will retry on next connect event */
      });
  });
}
