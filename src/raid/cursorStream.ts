// Owner-cursor sharing — ACTIVE ONLY DURING A RAID.
//   • Defender (my plot raided): publish my cursor (band-normalised 0..1) at ~5 Hz.
//   • Thief (raiding): subscribe to the owner's cursor, smooth it, expose as a ghost.
// Nothing is written/read outside a raid (privacy + Spark write budget).

import { set, onValue, type Unsubscribe } from "firebase/database";
import { getCursorInBand } from "../platform/tauri";
import { r, paths } from "../firebase/db";
import { store } from "../state";
import { BALANCE } from "../config/balance";

let lastOwnerSend = 0;
let cursorSub: Unsubscribe | null = null;
let rawTarget: { x: number; y: number } | null = null;

export function startThiefCursorSub(targetUid: string): void {
  stopThiefCursorSub();
  rawTarget = null;
  cursorSub = onValue(r(paths.raidCursor(targetUid)), (snap) => {
    const v = snap.val();
    if (v && typeof v.x === "number" && typeof v.y === "number") {
      rawTarget = { x: v.x, y: v.y };
    }
  });
}

export function stopThiefCursorSub(): void {
  if (cursorSub) {
    cursorSub();
    cursorSub = null;
  }
  rawTarget = null;
}

/** Called every frame from the game loop. */
export function tickCursorStream(): void {
  const role = store.raid.role;
  if (role === "defending" && store.raid.startedAt) {
    const hz = Math.min(BALANCE.cursorStream.hz, BALANCE.cursorStream.maxHz);
    const interval = 1000 / hz;
    const now = Date.now();
    if (now - lastOwnerSend >= interval) {
      lastOwnerSend = now;
      void publishOwnerCursor();
    }
  } else if (role === "raiding") {
    if (rawTarget) {
      const a = BALANCE.cursorStream.smoothing;
      const cur = store.raid.ownerCursor || rawTarget;
      store.raid.ownerCursor = {
        x: cur.x + (rawTarget.x - cur.x) * a,
        y: cur.y + (rawTarget.y - cur.y) * a,
      };
    }
  }
}

async function publishOwnerCursor(): Promise<void> {
  const pos = await getCursorInBand();
  if (!pos) return;
  try {
    await set(r(paths.raidCursor(store.uid)), { x: pos[0], y: pos[1] });
  } catch {
    /* ignore transient write errors */
  }
}
