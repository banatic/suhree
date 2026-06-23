// The raid state machine. Ties together the transaction lock, the countdown, eviction,
// the 50%-steal/50%-evaporate resolution, the left message, and the 5-minute cooldown.

import {
  get,
  set,
  remove,
  push,
  onValue,
  onDisconnect,
  serverTimestamp,
  type Unsubscribe,
  type OnDisconnect,
} from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, toast, type CropData } from "../state";
import { BALANCE } from "../config/balance";
import { raidSeconds } from "../game/levels";
import { stageOf, ripeValue } from "../game/crops";
import { addCoins } from "../game/economy";
import { acquireLock, releaseLock } from "./lock";
import { isOnCooldown, setCooldown, markFriendCooldown } from "./cooldown";
import { startThiefCursorSub, stopThiefCursorSub } from "./cursorStream";
import { playAlarm, playSteal, playWin } from "./alarm";

let raidNodeSub: Unsubscribe | null = null;
let defenseSub: Unsubscribe | null = null;
let raidDisconnect: OnDisconnect | null = null;
let alarmedFor: string | null = null;

const MESSAGES = [
  "잘 먹고 갑니다 😋",
  "여기 작물 맛있네요!",
  "다음에 또 올게요~",
  "문단속 잘 하세요!",
  "배가 고파서 그만…",
  "서리의 추억 ✿",
];
function pickMessage(): string {
  return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
}

// ── Thief side ───────────────────────────────────────────────────────────────

export async function startRaid(targetUid: string, targetNick: string): Promise<void> {
  if (store.raid.role !== "none") {
    toast("이미 raid 중이에요");
    return;
  }
  const me = store.uid;
  if (!me || targetUid === me) return;

  if (await isOnCooldown(targetUid, me)) {
    toast("아직 쿨다운이에요");
    markFriendCooldown(targetUid);
    return;
  }

  const onlineSnap = await get(r(paths.presenceOnline(targetUid)));
  if (onlineSnap.val() !== true) {
    toast("오프라인 친구는 털 수 없어요");
    return;
  }

  const tUser = (await get(r(paths.user(targetUid)))).val() || {};
  const tCrops = ((await get(r(paths.crops(targetUid)))).val() as Record<string, CropData>) || {};
  const T = raidSeconds(tUser.scarecrowLv ?? 0, store.user?.scytheLv ?? 0);
  const startedAt = Date.now();
  const durationMs = Math.round(T * 1000);

  const lock = await acquireLock(targetUid, me, startedAt, durationMs);
  if (!lock.ok) {
    toast("다른 도둑이 이미 들어가 있어요");
    return;
  }

  // Crash-safety: drop the lock automatically if our socket dies mid-raid.
  raidDisconnect = onDisconnect(r(paths.raid(targetUid)));
  raidDisconnect.remove().catch(() => {});

  store.raid = {
    role: "raiding",
    targetUid,
    targetNick,
    targetCrops: tCrops,
    startedAt,
    durationMs,
    resolved: false,
  };
  startThiefCursorSub(targetUid);

  // Detect eviction (the owner sets `evicted: true`).
  raidNodeSub = onValue(r(paths.raid(targetUid)), (snap) => {
    const v = snap.val();
    if (v && v.evicted === true && store.raid.role === "raiding" && !store.raid.resolved) {
      void failRaid();
    }
  });

  toast(`${targetNick} 의 밭에 잠입! ${T.toFixed(0)}초 안에 들키지 마세요`);
}

/** Called every frame: resolve a steal once the timer elapses. */
export function tickRaid(): void {
  const raid = store.raid;
  if (
    raid.role === "raiding" &&
    !raid.resolved &&
    raid.startedAt &&
    raid.durationMs &&
    Date.now() - raid.startedAt >= raid.durationMs
  ) {
    raid.resolved = true;
    void resolveSteal();
  }
}

async function resolveSteal(): Promise<void> {
  const targetUid = store.raid.targetUid!;
  const me = store.uid;

  // Re-read crops fresh in case the owner harvested some during the raid.
  let fresh: Record<string, CropData> = {};
  try {
    fresh = ((await get(r(paths.crops(targetUid)))).val() as Record<string, CropData>) || {};
  } catch {
    /* ignore */
  }

  let stolen = 0;
  const ops: Promise<unknown>[] = [];
  for (const [slot, c] of Object.entries(fresh)) {
    if (stageOf(c.plantedAt, c.tier, Date.now()) === "ripe") {
      stolen += Math.floor(ripeValue(c.tier) * BALANCE.raid.stealFraction);
      ops.push(remove(r(paths.crop(targetUid, slot)))); // 50% taken, 50% evaporates
    }
  }
  try {
    await Promise.all(ops);
  } catch {
    /* ignore */
  }
  if (stolen > 0) {
    try {
      await addCoins(me, stolen);
    } catch {
      /* ignore */
    }
  }

  // Leave a one-line message (still holding the lock → rules allow it).
  try {
    const msgRef = push(r(paths.messages(targetUid)));
    await set(msgRef, {
      from: me,
      text: pickMessage(),
      at: serverTimestamp(),
      skin: store.user?.equippedMsgSkin || "skin_plain",
    });
  } catch {
    /* ignore */
  }

  await setCooldown(targetUid, me).catch(() => {});
  markFriendCooldown(targetUid);
  await cleanupThiefRaid(targetUid);

  toast(stolen > 0 ? `서리 성공! +${stolen} 코인 훔쳤다` : "익은 작물이 없었다...");
  playSteal();
}

/** Thief flees voluntarily — same 5-minute cooldown applies. */
export async function cancelRaid(): Promise<void> {
  if (store.raid.role !== "raiding" || store.raid.resolved) return;
  store.raid.resolved = true;
  const targetUid = store.raid.targetUid!;
  await setCooldown(targetUid, store.uid).catch(() => {});
  markFriendCooldown(targetUid);
  await cleanupThiefRaid(targetUid);
  toast("도망쳤다! (쿨다운 5분)");
}

/** Thief got caught (owner evicted). */
async function failRaid(): Promise<void> {
  if (store.raid.role !== "raiding" || store.raid.resolved) return;
  store.raid.resolved = true;
  const targetUid = store.raid.targetUid!;
  await setCooldown(targetUid, store.uid).catch(() => {});
  markFriendCooldown(targetUid);
  await cleanupThiefRaid(targetUid);
  toast("들켰다! 쫓겨났어요 (쿨다운 5분)");
}

async function cleanupThiefRaid(targetUid: string): Promise<void> {
  stopThiefCursorSub();
  if (raidNodeSub) {
    raidNodeSub();
    raidNodeSub = null;
  }
  if (raidDisconnect) {
    try {
      await raidDisconnect.cancel();
    } catch {
      /* ignore */
    }
    raidDisconnect = null;
  }
  await releaseLock(targetUid, store.uid).catch(() => {});
  store.raid = { role: "none" };
}

// ── Defender side ──────────────────────────────────────────────────────────────

/** Watch my own raid node; when someone occupies it, go into defending mode. */
export function startDefenseWatch(myUid: string): void {
  if (defenseSub) return;
  defenseSub = onValue(r(paths.raid(myUid)), async (snap) => {
    const v = snap.val();
    const active =
      v &&
      v.raiderUid &&
      v.evicted !== true &&
      Date.now() - (v.startedAt || 0) < BALANCE.raid.lockStaleMs;

    if (active) {
      if (store.raid.role !== "defending" || store.raid.raiderUid !== v.raiderUid) {
        let nick = "누군가";
        try {
          nick = (await get(r(paths.user(v.raiderUid)))).val()?.nickname || nick;
        } catch {
          /* ignore */
        }
        store.raid = {
          role: "defending",
          raiderUid: v.raiderUid,
          raiderNick: nick,
          startedAt: v.startedAt,
          durationMs: v.durationMs || BALANCE.raid.baseSeconds * 1000,
        };
        if (alarmedFor !== v.raiderUid) {
          alarmedFor = v.raiderUid;
          playAlarm();
        }
      } else {
        store.raid.startedAt = v.startedAt;
        store.raid.durationMs = v.durationMs || store.raid.durationMs;
      }
    } else {
      if (store.raid.role === "defending") store.raid = { role: "none" };
      alarmedFor = null;
    }
  });
}

/** Defender clicks "쫓아내기" — flag eviction; the thief aborts and clears the node. */
export async function evict(): Promise<void> {
  if (store.raid.role !== "defending") return;
  try {
    await set(r(paths.raidEvicted(store.uid)), true);
  } catch {
    /* ignore */
  }
  playWin();
  toast("침입자를 쫓아냈어요!");
}
