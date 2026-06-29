// Cursor exchange — ACTIVE ONLY DURING A RAID. The active mechanic is cat-and-mouse, so BOTH
// sides publish their cursor (band-normalised 0..1) and subscribe to the other's:
//   • Raider: publish raiderCursor; subscribe ownerCursor (the defender ghost to DODGE).
//   • Defender: publish ownerCursor; subscribe raiderCursor (the raider ghost to CLICK).
// Nothing is written/read outside a raid (privacy + Spark write budget).

import { set, onValue, type Unsubscribe } from "firebase/database";
import { getCursorInBand } from "../platform/tauri";
import { r, paths } from "../firebase/db";
import { store, type RaidRole } from "../state";
import { BALANCE } from "../config/balance";

let lastSend = 0;
let cursorSub: Unsubscribe | null = null;
let rawOther: { x: number; y: number } | null = null;

/** Raider: watch the defender's (owner's) cursor so it can be dodged. */
export function startRaiderCursorSub(targetUid: string): void {
  stopCursorSub();
  cursorSub = onValue(r(paths.raidCursor(targetUid)), (snap) => {
    const v = snap.val();
    if (v && typeof v.x === "number" && typeof v.y === "number") rawOther = { x: v.x, y: v.y };
  });
}

/** Defender: watch the raider's cursor so it can be clicked (evicted). */
export function startDefenderCursorSub(myUid: string): void {
  stopCursorSub();
  cursorSub = onValue(r(paths.raidRaiderCursor(myUid)), (snap) => {
    const v = snap.val();
    if (v && typeof v.x === "number" && typeof v.y === "number") rawOther = { x: v.x, y: v.y };
  });
}

export function stopCursorSub(): void {
  if (cursorSub) {
    cursorSub();
    cursorSub = null;
  }
  rawOther = null;
}

/** Called every frame from the game loop. */
export function tickCursorStream(): void {
  const role = store.raid.role;
  if (role === "none" || !store.raid.startedAt) return;

  // Both sides publish their own cursor at the raid rate.
  const interval = 1000 / BALANCE.raidGame.cursorHz;
  const now = Date.now();
  if (now - lastSend >= interval) {
    lastSend = now;
    void publishMyCursor(role);
  }

  // Smooth the received ghost toward its raw target.
  if (rawOther) {
    const a = BALANCE.raidGame.cursorSmoothing;
    if (role === "raiding") {
      const cur = store.raid.ownerCursor || rawOther;
      store.raid.ownerCursor = { x: cur.x + (rawOther.x - cur.x) * a, y: cur.y + (rawOther.y - cur.y) * a };
    } else {
      const cur = store.raid.raiderCursor || rawOther;
      store.raid.raiderCursor = { x: cur.x + (rawOther.x - cur.x) * a, y: cur.y + (rawOther.y - cur.y) * a };
    }
  }
}

async function publishMyCursor(role: Exclude<RaidRole, "none">): Promise<void> {
  const pos = await getCursorInBand();
  if (!pos) return;
  const path =
    role === "defending" ? paths.raidCursor(store.uid) : paths.raidRaiderCursor(store.raid.targetUid!);
  try {
    await set(r(path), { x: pos[0], y: pos[1] });
  } catch {
    /* ignore transient write errors */
  }
}
