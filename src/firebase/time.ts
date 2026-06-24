// Server-clock helper. Cooldowns are written with serverTimestamp() but read/compared on the
// client; a skewed local clock would mis-measure the window. RTDB exposes the estimated
// client↔server delta at `.info/serverTimeOffset` — apply it so all cooldown math is on one clock.

import { onValue } from "firebase/database";
import { r } from "./db";

let offsetMs = 0;

export function initServerTime(): void {
  onValue(r(".info/serverTimeOffset"), (snap) => {
    const v = snap.val();
    if (typeof v === "number" && isFinite(v)) offsetMs = v;
  });
}

/** Best estimate of the server's current epoch ms (falls back to Date.now() until offset loads). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
