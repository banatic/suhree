// The raid state machine — now an ACTIVE cat-and-mouse in the strip near the taskbar.
//   • Raider: CLICK ripe crops to steal them (cropClicks per crop, from levels) while DODGING the
//     defender's cursor. Each fully-clicked crop is looted (coins + crop removed).
//   • Defender: CLICK the raider's cursor to land hits; once `evictHitsNeeded` hits land, evict.
// Attack power = 낫(scythe) level, defence power = 허수아비(scarecrow) level. The 5-minute cooldown
// still applies on every raid end (loot is kept whatever the ending).

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
import { store, toast, type CropData, type WeedData } from "../state";
import { BALANCE } from "../config/balance";
import { serverNow } from "../firebase/time";
import { cropClicksToSteal, evictHitsNeeded } from "../game/levels";
import { stageOf } from "../game/crops";
import { sellValue } from "../game/market";
import { recordDex } from "../game/dex";
import { addCoins } from "../game/economy";
import { acquireLock, releaseLock } from "./lock";
import { getCooldownRemaining, setCooldown, markFriendCooldown } from "./cooldown";
import { startRaiderCursorSub, startDefenderCursorSub, stopCursorSub } from "./cursorStream";
import { playAlarm, playSteal, playWin } from "./alarm";
import { promptLootNote } from "../render/lootNote";
import { logRaid } from "../firebase/raidlog";

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

  const remaining = await getCooldownRemaining(targetUid, me);
  if (remaining > 0) {
    markFriendCooldown(targetUid, remaining); // exact remaining — don't reset to a full 5 min
    const s = Math.ceil(remaining / 1000);
    toast(`아직 쿨다운이에요 (${s >= 60 ? Math.ceil(s / 60) + "분" : s + "초"} 남음)`);
    return;
  }

  const presence = (await get(r(paths.presence(targetUid)))).val() as
    | { lastSeen?: number; connections?: Record<string, unknown> }
    | null;
  const fresh = !!presence && serverNow() - (presence.lastSeen ?? 0) < BALANCE.presence.onlineThresholdMs;
  const socketAlive = !!presence?.connections && Object.keys(presence.connections).length > 0;
  if (!fresh && !socketAlive) {
    toast("오프라인 친구는 털 수 없어요");
    return;
  }

  const tUser = (await get(r(paths.user(targetUid)))).val() || {};
  const tCrops = ((await get(r(paths.crops(targetUid)))).val() as Record<string, CropData>) || {};
  const tWeeds = ((await get(r(paths.weeds(targetUid)))).val() as Record<string, WeedData>) || {};
  const cropClicks = cropClicksToSteal(tUser.scarecrowLv ?? 0, store.user?.scytheLv ?? 0);
  // My "health" as the raider: how many hits the defender must land to evict me. The defender
  // computes the same value (same formula/args) and syncs their running hit count via evictHits.
  const evictResist = evictHitsNeeded(store.user?.scytheLv ?? 0, tUser.scarecrowLv ?? 0);
  const startedAt = Date.now();
  const durationMs = BALANCE.raidGame.timeoutSeconds * 1000;

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
    targetWeeds: tWeeds,
    targetPlotSize: tUser.plotSize ?? BALANCE.shop.plotExpansion.startSlots,
    targetDecor: tUser.equippedDecor || "decor_none",
    targetTheme: tUser.equippedTheme || "theme_day",
    cropClicks,
    stealProgress: {},
    stolenCoins: 0,
    stolenCount: 0,
    evictHits: 0,
    evictHitsNeeded: evictResist,
    startedAt,
    durationMs,
    resolved: false,
  };
  startRaiderCursorSub(targetUid);

  // Watch my raid node: detect eviction, and mirror the defender's running hit count so I can
  // show my health (HP = evictHitsNeeded − evictHits).
  raidNodeSub = onValue(r(paths.raid(targetUid)), (snap) => {
    const v = snap.val();
    if (!v || store.raid.role !== "raiding" || store.raid.resolved) return;
    if (typeof v.evictHits === "number") store.raid.evictHits = v.evictHits;
    if (v.evicted === true) void finishThiefRaid("evicted");
  });

  toast(`${targetNick} 의 밭에 잠입! 익은 작물을 클릭해 털고, 주인 커서를 피하세요 (작물당 ${cropClicks}번)`);
}

/** The raider clicks one ripe crop. Once it's been clicked `cropClicks` times it's looted. */
export async function registerStealClick(slotKey: string): Promise<void> {
  const raid = store.raid;
  if (raid.role !== "raiding" || raid.resolved) return;
  const crop = raid.targetCrops?.[slotKey];
  if (!crop || !raid.stealProgress) return;
  if (stageOf(crop.plantedAt, crop.tier, Date.now()) !== "ripe") return;

  const need = raid.cropClicks ?? 3;
  const prog = (raid.stealProgress[slotKey] ?? 0) + 1;
  if (prog < need) {
    raid.stealProgress[slotKey] = prog;
    return;
  }

  // Fully clicked → steal this crop. Remove locally first so it can't be double-counted.
  delete raid.targetCrops![slotKey];
  delete raid.stealProgress[slotKey];
  const value = Math.floor(sellValue(crop.tier) * BALANCE.raidGame.stealValueFraction); // today's price
  raid.stolenCoins = (raid.stolenCoins ?? 0) + value;
  raid.stolenCount = (raid.stolenCount ?? 0) + 1;
  const targetUid = raid.targetUid!;
  try {
    await remove(r(paths.crop(targetUid, slotKey)));
  } catch {
    /* ignore */
  }
  if (value > 0) {
    try {
      await addCoins(store.uid, value);
    } catch {
      /* ignore */
    }
  }
  void recordDex(store.uid, crop.tier, "steal", targetUid); // log it in my 도감 (who I stole from)
  playSteal();
  toast(`+${value} 코인 훔쳤다! (총 +${raid.stolenCoins})`);

  // Cleaned them out? Flee with the loot.
  const anyRipe = Object.values(raid.targetCrops!).some(
    (c) => stageOf(c.plantedAt, c.tier, Date.now()) === "ripe",
  );
  if (!anyRipe) await finishThiefRaid("cleared");
}

/** Called every frame: hard timeout so a lock can't hang — the raider auto-flees with their loot. */
export function tickRaid(): void {
  const raid = store.raid;
  if (
    raid.role === "raiding" &&
    !raid.resolved &&
    raid.startedAt &&
    raid.durationMs &&
    Date.now() - raid.startedAt >= raid.durationMs
  ) {
    void finishThiefRaid("timeout");
  }
}

/** Thief flees voluntarily — same 5-minute cooldown applies. */
export async function cancelRaid(): Promise<void> {
  await finishThiefRaid("fled");
}

async function leaveLootMessage(targetUid: string, text: string): Promise<void> {
  try {
    const msgRef = push(r(paths.messages(targetUid)));
    await set(msgRef, {
      from: store.uid,
      text: text.slice(0, BALANCE.raid.messageMaxLen),
      at: serverTimestamp(),
      skin: store.user?.equippedMsgSkin || "skin_plain",
    });
  } catch {
    /* ignore */
  }
}

async function finishThiefRaid(reason: "fled" | "evicted" | "timeout" | "cleared"): Promise<void> {
  const raid = store.raid;
  if (raid.role !== "raiding" || raid.resolved) return;
  raid.resolved = true;
  const targetUid = raid.targetUid!;
  const targetNick = raid.targetNick || "농부";
  const looted = raid.stolenCoins ?? 0;

  // A voluntary flee is a cheaper penalty than getting caught / timing out / clearing the plot.
  const cooldownMs = reason === "fled" ? BALANCE.raid.fleeCooldownMs : BALANCE.raid.cooldownMs;

  const tail = looted > 0 ? ` (+${looted} 코인)` : "";
  const mins = Math.round(cooldownMs / 60000);
  if (reason === "evicted") toast(`들켰다! 쫓겨났어요${tail} · 쿨다운 ${mins}분`);
  else if (reason === "timeout") toast(`시간 초과로 도주${tail} · 쿨다운 ${mins}분`);
  else if (reason === "cleared") toast(`밭을 싹 털었다!${tail} · 쿨다운 ${mins}분`);
  else toast(`도망쳤다!${tail} · 쿨다운 ${mins}분`);

  // Record the steal in the server-wide 서리 feed (one append per looted raid).
  if (looted > 0) void logRaid(targetUid, targetNick, looted, raid.stolenCount ?? 0);

  // Stole at least one crop → let the raider hand-write a parting note. The DB rule requires the
  // raid lock to still be held to write into the victim's messages, so we keep the lock until the
  // composer resolves, then write the note (if any) and finalize. Empty/skip leaves no note.
  if (looted > 0) {
    promptLootNote(targetNick, looted, pickMessage(), (text) => {
      void (async () => {
        const t = (text ?? "").trim();
        if (t) await leaveLootMessage(targetUid, t);
        await finalizeThiefRaid(targetUid, cooldownMs);
      })();
    });
  } else {
    await finalizeThiefRaid(targetUid, cooldownMs);
  }
}

/** Set the cooldown, reflect it locally, and tear down the raid (releasing the lock). */
async function finalizeThiefRaid(targetUid: string, cooldownMs: number): Promise<void> {
  await setCooldown(targetUid, store.uid, cooldownMs).catch(() => {});
  markFriendCooldown(targetUid, cooldownMs);
  await cleanupThiefRaid(targetUid);
}

async function cleanupThiefRaid(targetUid: string): Promise<void> {
  stopCursorSub();
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
    // While I'm out raiding someone else, ignore incoming raids on my own farm. Flipping to
    // "defending" here would abandon my own raid lock (it'd linger until lockStaleMs) and, when
    // two players raid each other at once, strand BOTH of us in a frozen defend state — neither
    // side keeps publishing the cursor the other must click, so no one can evict. My farm is
    // simply undefended until my raid ends; the raider's ~10Hz cursor writes then re-fire this
    // watcher and I drop into defending.
    if (store.raid.role === "raiding") return;

    const v = snap.val();
    const active =
      v &&
      v.raiderUid &&
      v.evicted !== true &&
      Date.now() - (v.startedAt || 0) < BALANCE.raid.lockStaleMs;

    if (active) {
      if (store.raid.role !== "defending" || store.raid.raiderUid !== v.raiderUid) {
        let nick = "누군가";
        let raiderScytheLv = 0;
        try {
          const ru = (await get(r(paths.user(v.raiderUid)))).val();
          nick = ru?.nickname || nick;
          raiderScytheLv = ru?.scytheLv ?? 0;
        } catch {
          /* ignore */
        }
        store.raid = {
          role: "defending",
          raiderUid: v.raiderUid,
          raiderNick: nick,
          evictHits: 0,
          evictHitsNeeded: evictHitsNeeded(raiderScytheLv, store.user?.scarecrowLv ?? 0),
          startedAt: v.startedAt,
          durationMs: v.durationMs || BALANCE.raidGame.timeoutSeconds * 1000,
        };
        startDefenderCursorSub(myUid);
        if (alarmedFor !== v.raiderUid) {
          alarmedFor = v.raiderUid;
          playAlarm();
        }
      } else {
        store.raid.startedAt = v.startedAt;
        store.raid.durationMs = v.durationMs || store.raid.durationMs;
      }
    } else {
      if (store.raid.role === "defending") {
        stopCursorSub();
        store.raid = { role: "none" };
      }
      alarmedFor = null;
    }
  });
}

function addEvictHit(sound: boolean): void {
  const raid = store.raid;
  if (raid.role !== "defending" || raid.resolved) return;
  raid.evictHits = (raid.evictHits ?? 0) + 1;
  if (sound) playWin();
  // Sync the count to my raid node so the raider can see their health drop.
  void set(r(paths.raidEvictHits(store.uid)), raid.evictHits).catch(() => {});
  if (raid.evictHits >= (raid.evictHitsNeeded ?? 3)) void evict();
}

/** Defender clicks in the band; `landed` = the click was within range of the raider's ghost cursor. */
export function registerEvictClick(landed: boolean): void {
  if (!landed) return; // a miss — the raider dodged
  addEvictHit(true);
}

/**
 * Grazing the raider's cursor with the mouse lands a hit too — no click needed (clicking the tiny
 * fast ghost was too hard). Fires repeatedly while the cursor overlaps, so feedback is visual-only
 * (the strip adds a pop per graze); the win sound is reserved for the final eviction.
 */
export function registerEvictGraze(): void {
  addEvictHit(false);
}

/** Enough hits landed → flag eviction; the thief aborts and clears the node. */
export async function evict(): Promise<void> {
  if (store.raid.role !== "defending" || store.raid.resolved) return;
  store.raid.resolved = true;
  try {
    await set(r(paths.raidEvicted(store.uid)), true);
  } catch {
    /* ignore */
  }
  stopCursorSub();
  playWin();
  toast("침입자를 쫓아냈어요!");
}
