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

// ── Dead-reckoning between 10Hz network samples ─────────────────────────────────────────────
// Paint runs at 60fps during a raid, but each ghost's position only updates over the network at
// cursorHz. A plain lerp-toward-last-sample converges almost fully within ~2 paint frames' worth
// of `a`, then holds still until the next sample lands — a visible "dart then freeze" stutter.
// Tracking each ghost's velocity between samples and extrapolating forward fills that gap with
// continuous motion instead.
interface VelTrack {
  sampleX: number;
  sampleY: number;
  sampleAt: number;
  vx: number;
  vy: number;
}
const velTracks = new Map<string, VelTrack>();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smooth `raw` (latest network sample) toward `cur` (last painted position), extrapolating the
 *  ghost's last known velocity across the gap between samples. `key` identifies the ghost (owner,
 *  or a raider/co-raider uid) so multiple ghosts can be tracked independently. */
function trackAndSmooth(
  key: string,
  raw: { x: number; y: number } | undefined,
  cur: { x: number; y: number } | undefined,
  a: number,
  now: number,
): { x: number; y: number } | undefined {
  if (!raw) {
    velTracks.delete(key);
    return cur;
  }
  let t = velTracks.get(key);
  if (!t) {
    t = { sampleX: raw.x, sampleY: raw.y, sampleAt: now, vx: 0, vy: 0 };
    velTracks.set(key, t);
  } else if (t.sampleX !== raw.x || t.sampleY !== raw.y) {
    // A fresh sample landed — derive velocity from the gap since the previous one.
    const dt = Math.max(now - t.sampleAt, 1);
    t.vx = (raw.x - t.sampleX) / dt;
    t.vy = (raw.y - t.sampleY) / dt;
    t.sampleX = raw.x;
    t.sampleY = raw.y;
    t.sampleAt = now;
  }
  const elapsed = Math.min(now - t.sampleAt, BALANCE.raidGame.cursorExtrapolationMs);
  const target = { x: clamp01(raw.x + t.vx * elapsed), y: clamp01(raw.y + t.vy * elapsed) };
  const base = cur || target;
  return { x: base.x + (target.x - base.x) * a, y: base.y + (target.y - base.y) * a };
}

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
  velTracks.delete("owner");
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
    // Smooth the single owner ghost toward its dead-reckoned target.
    store.raid.ownerCursor = trackAndSmooth("owner", rawOwner ?? undefined, store.raid.ownerCursor, a, now);
    // Smooth every fellow-thief ghost toward its dead-reckoned (network) position.
    const co = store.raid.coRaiders;
    if (co) {
      for (const [uid, rv] of Object.entries(co)) {
        rv.cursor = trackAndSmooth(uid, rv.rawCursor, rv.cursor, a, now);
      }
    }
  } else {
    // Defending: smooth every intruder ghost toward its dead-reckoned (network) position.
    const raiders = store.raid.raiders;
    if (raiders) {
      for (const [uid, rv] of Object.entries(raiders)) {
        rv.cursor = trackAndSmooth(uid, rv.rawCursor, rv.cursor, a, now);
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
