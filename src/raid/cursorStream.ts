// Cursor exchange — ACTIVE ONLY DURING A RAID. The active mechanic is cat-and-mouse:
//   • Raider: publish my cursor to raiders/{me}/cursor; subscribe the defender's shared ownerCursor
//     (the ghost to DODGE).
//   • Defender: publish ONE ownerCursor (shared by every intruder); the raiders' cursors arrive via
//     the raiders-map watcher in the controller, and are smoothed per-raider here (the ghosts to CLICK).
// Nothing is written/read outside a raid (privacy + Spark write budget).

import { set, onValue, type Unsubscribe } from "firebase/database";
import { getCursorInBand } from "../platform/tauri";
import { r, paths } from "../firebase/db";
import { store, type RaidRole } from "../state";
import { BALANCE } from "../config/balance";

let lastSend = 0;
let cursorSub: Unsubscribe | null = null; // raider-side: the defender's shared ownerCursor
let rawOwner: { x: number; y: number } | null = null; // raider-side: latest owner cursor position

/** Raider: watch the defender's shared (owner's) cursor so it can be dodged. */
export function startRaiderCursorSub(targetUid: string): void {
  stopCursorSub();
  cursorSub = onValue(r(paths.raidOwnerCursor(targetUid)), (snap) => {
    const v = snap.val();
    if (v && typeof v.x === "number" && typeof v.y === "number") rawOwner = { x: v.x, y: v.y };
  });
}

export function stopCursorSub(): void {
  if (cursorSub) {
    cursorSub();
    cursorSub = null;
  }
  rawOwner = null;
}

/** Called every frame from the game loop. */
export function tickCursorStream(): void {
  const role = store.raid.role;
  if (role === "none" || !raidActive()) return;

  // Both sides publish their own cursor at the raid rate.
  const interval = 1000 / BALANCE.raidGame.cursorHz;
  const now = Date.now();
  if (now - lastSend >= interval) {
    lastSend = now;
    void publishMyCursor(role);
  }

  const a = BALANCE.raidGame.cursorSmoothing;
  if (role === "raiding") {
    // Smooth the single owner ghost toward its raw target.
    if (rawOwner) {
      const cur = store.raid.ownerCursor || rawOwner;
      store.raid.ownerCursor = { x: cur.x + (rawOwner.x - cur.x) * a, y: cur.y + (rawOwner.y - cur.y) * a };
    }
  } else {
    // Defending: smooth every intruder ghost toward its raw (network) position.
    const raiders = store.raid.raiders;
    if (raiders) {
      for (const rv of Object.values(raiders)) {
        const raw = rv.rawCursor;
        if (!raw) continue;
        const cur = rv.cursor || raw;
        rv.cursor = { x: cur.x + (raw.x - cur.x) * a, y: cur.y + (raw.y - cur.y) * a };
      }
    }
  }
}

/** A raid is worth streaming for while I'm raiding (startedAt set) or defending (≥1 intruder). */
function raidActive(): boolean {
  if (store.raid.role === "raiding") return !!store.raid.startedAt;
  if (store.raid.role === "defending") return !!store.raid.raiders && Object.keys(store.raid.raiders).length > 0;
  return false;
}

async function publishMyCursor(role: Exclude<RaidRole, "none">): Promise<void> {
  const pos = await getCursorInBand();
  if (!pos) return;
  const path =
    role === "defending"
      ? paths.raidOwnerCursor(store.uid) // one shared cursor every intruder dodges
      : paths.raidRaiderCursor(store.raid.targetUid!, store.uid);
  try {
    await set(r(path), { x: pos[0], y: pos[1] });
  } catch {
    /* ignore transient write errors */
  }
}
