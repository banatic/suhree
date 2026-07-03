// The raid state machine — now an ACTIVE cat-and-mouse in the strip near the taskbar.
//   • Raider: CLICK ripe crops to steal them (cropClicks per crop, from levels) while DODGING the
//     defender's cursor. Each fully-clicked crop is looted (coins + crop removed).
//   • Defender: CLICK the raider's cursor to land hits; once `evictHitsNeeded` hits land, evict.
// Attack power = 낫(scythe) level, defence power = 허수아비(scarecrow) level. The 5-minute cooldown
// still applies on every raid end (loot is kept whatever the ending).

import {
  get,
  set,
  push,
  onValue,
  onDisconnect,
  runTransaction,
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
import { joinRaid, leaveRaid } from "./lock";
import { getCooldownRemaining, setCooldown, markFriendCooldown } from "./cooldown";
import { startRaiderCursorSub, stopCursorSub } from "./cursorStream";
import { playAlarm, playSteal, playWin } from "./alarm";
import { promptLootNote } from "../render/lootNote";
import { logRaid } from "../firebase/raidlog";
import { recordRaidStat } from "../game/stats";
import { announceToChat } from "../firebase/chat";

// One raider's slot as stored under raids/{target}/raiders/{raiderUid}.
interface RaiderSlot {
  startedAt?: number;
  durationMs?: number;
  evicted?: boolean;
  evictHits?: number;
  cursor?: { x: number; y: number };
}

let raidNodeSub: Unsubscribe | null = null; // my own slot on the target (HP + evicted)
let raidCropsSub: Unsubscribe | null = null; // the target's live crops (so others' steals disappear)
let raidWeedsSub: Unsubscribe | null = null; // the target's live weeds (so co-raiders' weeds sync in)
let defenseSub: Unsubscribe | null = null; // the raiders map on MY field
let raidDisconnect: OnDisconnect | null = null; // drops my slot if my socket dies mid-raid
const alarmedUids = new Set<string>(); // raiders we've already sounded the alarm for
const fetchingRaiders = new Set<string>(); // raiders whose user data we're fetching (avoid double-fetch)
const fetchingCoRaiders = new Set<string>(); // fellow thieves (raiding side) we're fetching user data for

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

/** One-line 서리 result for the village chat — brags on a haul, owns up on a bust. */
function raidChatLine(
  victimNick: string,
  reason: "fled" | "evicted" | "timeout" | "cleared",
  looted: number,
  count: number,
): string {
  const v = victimNick || "농부";
  if (looted > 0) return `🌾 ${v}님 밭에서 작물 ${count}개를 서리했어요! (+${looted}💰)`;
  if (reason === "evicted") return `🚨 ${v}님 밭에서 서리하다 들켜서 쫓겨났어요…`;
  if (reason === "timeout") return `⏱️ ${v}님 밭에서 빈손으로 시간만 보냈어요…`;
  return `🌿 ${v}님 밭을 노렸지만 빈손으로 돌아왔어요…`;
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

  // Join as one of possibly-many raiders — no lock, my own slot keyed by uid (never "occupied").
  await joinRaid(targetUid, me, startedAt, durationMs);

  // Crash-safety: drop only MY slot automatically if our socket dies mid-raid (others keep going).
  raidDisconnect = onDisconnect(r(paths.raidRaider(targetUid, me)));
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
    ownerCursorSkin: tUser.equippedCursor || "cursor_default",
    cropClicks,
    stealProgress: {},
    stolenCoins: 0,
    stolenCount: 0,
    evictHits: 0,
    evictHitsNeeded: evictResist,
    coRaiders: {},
    startedAt,
    durationMs,
    resolved: false,
  };
  startRaiderCursorSub(targetUid);

  // Watch the whole raiders map on this field: (a) MY slot for eviction + the defender's running
  // hit count (my HP), and (b) my fellow thieves' cursors so we can see each other robbing together.
  raidNodeSub = onValue(r(paths.raidRaiders(targetUid)), (snap) => {
    const raid = store.raid;
    if (raid.role !== "raiding" || raid.resolved) return;
    const all = (snap.val() as Record<string, RaiderSlot>) || {};

    // (a) my own slot → HP + eviction
    const mine = all[me];
    if (mine) {
      if (typeof mine.evictHits === "number") raid.evictHits = mine.evictHits;
      if (mine.evicted === true) {
        void finishThiefRaid("evicted");
        return;
      }
    }

    // (b) fellow raiders → track their cursors (fetch nick/skin once per newcomer)
    const now = Date.now();
    const map = (raid.coRaiders ??= {});
    const activeOthers = new Set<string>();
    for (const [uid, s] of Object.entries(all)) {
      if (uid === me || !s || s.evicted === true) continue;
      if (now - (s.startedAt || 0) >= BALANCE.raid.lockStaleMs) continue;
      activeOthers.add(uid);
      const cur = s.cursor;
      const existing = map[uid];
      if (existing) {
        if (cur && typeof cur.x === "number" && typeof cur.y === "number") {
          existing.rawCursor = { x: cur.x, y: cur.y };
        }
      } else if (!fetchingCoRaiders.has(uid)) {
        fetchingCoRaiders.add(uid);
        void (async () => {
          let nick = "다른 도둑";
          let cursorSkin = "cursor_default";
          try {
            const ru = (await get(r(paths.user(uid)))).val();
            nick = ru?.nickname || nick;
            cursorSkin = ru?.equippedCursor || "cursor_default";
          } catch {
            /* ignore */
          }
          fetchingCoRaiders.delete(uid);
          if (store.raid.role !== "raiding" || store.raid.resolved) return;
          const m2 = (store.raid.coRaiders ??= {});
          if (m2[uid]) return; // a later snapshot beat us to it
          m2[uid] = {
            uid,
            nick,
            cursorSkin,
            rawCursor: cur && typeof cur.x === "number" ? { x: cur.x, y: cur.y } : undefined,
          };
        })();
      }
    }
    for (const uid of Object.keys(map)) if (!activeOthers.has(uid)) delete map[uid]; // left/evicted/stale
  });

  // Watch the target's live crops so a crop stolen by ANOTHER raider (or harvested by the owner)
  // disappears from my strip too — no phantom crops to keep clicking.
  raidCropsSub = onValue(r(paths.crops(targetUid)), (snap) => {
    const raid = store.raid;
    if (raid.role !== "raiding" || raid.resolved) return;
    const live = ((snap.val() as Record<string, CropData>) || {});
    raid.targetCrops = live;
    if (raid.stealProgress) {
      for (const k of Object.keys(raid.stealProgress)) {
        if (!live[k]) delete raid.stealProgress[k]; // that crop is gone — reset any partial progress
      }
    }
  });

  // Watch the target's live weeds so a weed a FELLOW raider plants (or the owner pulls) shows up on
  // my strip too — otherwise I'd only have the one-time snapshot from when I joined and could try to
  // plant on a slot someone else already took. Mirrors raidCropsSub above.
  raidWeedsSub = onValue(r(paths.weeds(targetUid)), (snap) => {
    const raid = store.raid;
    if (raid.role !== "raiding" || raid.resolved) return;
    raid.targetWeeds = (snap.val() as Record<string, WeedData>) || {};
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

  // Fully clicked → RACE to claim this crop. First raider to win the transaction gets it; if
  // someone already took it (or the owner harvested), my clicks are wasted — no reward.
  delete raid.stealProgress[slotKey];
  const targetUid = raid.targetUid!;
  const tier = crop.tier;
  let won = false;
  try {
    const res = await runTransaction(r(paths.crop(targetUid, slotKey)), (cur) => {
      if (!cur) return undefined; // already taken/harvested → abort (committed = false)
      return null; // I claim it → delete the crop
    });
    won = res.committed;
  } catch {
    won = false;
  }
  if (!won) {
    if (raid.targetCrops) delete raid.targetCrops[slotKey]; // it's gone; the live sub confirms too
    toast("이 작물은 다른 도둑이 가로챘어요!");
    return;
  }

  // Won it — only the winner mints coins, so no double-spend across concurrent raiders.
  if (raid.targetCrops) delete raid.targetCrops[slotKey];
  const value = Math.floor(sellValue(tier) * BALANCE.raidGame.stealValueFraction); // today's price
  raid.stolenCoins = (raid.stolenCoins ?? 0) + value;
  raid.stolenCount = (raid.stolenCount ?? 0) + 1;
  if (value > 0) {
    try {
      await addCoins(store.uid, value);
    } catch {
      /* ignore */
    }
  }
  void recordDex(store.uid, tier, "steal", targetUid); // log it in my 도감 (who I stole from)
  playSteal();
  toast(`+${value} 코인 훔쳤다! (총 +${raid.stolenCoins})`);

  // Cleaned them out? Flee with the loot.
  const anyRipe = Object.values(raid.targetCrops ?? {}).some(
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
  const stolen = raid.stolenCount ?? 0;
  if (looted > 0) void logRaid(targetUid, targetNick, looted, stolen);

  // Bump my personal 서리 통계 (lifetime + today, aggregate + this victim). Gated on crops stolen so
  // busted/empty runs don't count as raids; my own node only, so no rule/permission juggling.
  if (stolen > 0) void recordRaidStat(targetUid, looted, stolen);

  // Mirror EVERY raid — success or failure — into the village chat so the whole server sees it.
  void announceToChat(raidChatLine(targetNick, reason, looted, raid.stolenCount ?? 0));

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
  if (raidCropsSub) {
    raidCropsSub();
    raidCropsSub = null;
  }
  if (raidWeedsSub) {
    raidWeedsSub();
    raidWeedsSub = null;
  }
  if (raidDisconnect) {
    try {
      await raidDisconnect.cancel();
    } catch {
      /* ignore */
    }
    raidDisconnect = null;
  }
  await leaveRaid(targetUid, store.uid).catch(() => {});
  fetchingCoRaiders.clear();
  store.raid = { role: "none" };
}

// ── Defender side ──────────────────────────────────────────────────────────────

/** Watch the raiders map on MY field; reconcile it into store.raid.raiders (N intruders at once). */
export function startDefenseWatch(myUid: string): void {
  if (defenseSub) return;
  defenseSub = onValue(r(paths.raidRaiders(myUid)), (snap) => {
    reconcileDefense(myUid, snap.val() as Record<string, RaiderSlot> | null);
  });
}

/**
 * Fold the latest raiders snapshot into store.raid.raiders: add newcomers (fetching their level/skin
 * once), refresh live cursors, and drop raiders that left / were evicted / went stale. The defender's
 * own cursor (published once, shared) is dodged by every raider; each raider is evicted individually.
 */
function reconcileDefense(myUid: string, raw: Record<string, RaiderSlot> | null): void {
  // While I'm out raiding someone else, ignore incoming raids on my own farm — my farm is simply
  // undefended until my raid ends (a single mouse can't dodge in one strip and click in another).
  if (store.raid.role === "raiding") return;

  const now = Date.now();
  const slots = raw || {};
  const activeUids = new Set<string>();
  for (const [uid, s] of Object.entries(slots)) {
    if (!s || s.evicted === true) continue;
    if (now - (s.startedAt || 0) >= BALANCE.raid.lockStaleMs) continue; // abandoned slot
    activeUids.add(uid);
  }

  // Nobody's raiding me → leave defending.
  if (activeUids.size === 0) {
    if (store.raid.role === "defending") store.raid = { role: "none" };
    alarmedUids.clear();
    return;
  }

  // Ensure we're in defending mode with a raiders map to fold into.
  if (store.raid.role !== "defending" || !store.raid.raiders) {
    store.raid = { role: "defending", raiders: {} };
  }
  const map = store.raid.raiders!;

  // Drop raiders that are gone/evicted/stale.
  for (const uid of Object.keys(map)) {
    if (!activeUids.has(uid)) {
      delete map[uid];
      alarmedUids.delete(uid);
    }
  }

  // Add newcomers (async user fetch) and refresh live cursors for existing ones.
  for (const uid of activeUids) {
    const s = slots[uid];
    const existing = map[uid];
    if (existing) {
      existing.startedAt = s.startedAt ?? existing.startedAt;
      const cur = s.cursor;
      if (cur && typeof cur.x === "number" && typeof cur.y === "number") {
        existing.rawCursor = { x: cur.x, y: cur.y };
      }
      continue;
    }
    if (fetchingRaiders.has(uid)) continue; // fetch already in flight
    fetchingRaiders.add(uid);
    void (async () => {
      let nick = "누군가";
      let raiderScytheLv = 0;
      let cursorSkin = "cursor_default";
      try {
        const ru = (await get(r(paths.user(uid)))).val();
        nick = ru?.nickname || nick;
        raiderScytheLv = ru?.scytheLv ?? 0;
        cursorSkin = ru?.equippedCursor || "cursor_default";
      } catch {
        /* ignore */
      }
      fetchingRaiders.delete(uid);
      // May have flipped to raiding, or the raider may have left, while we fetched.
      if (store.raid.role !== "defending" || !store.raid.raiders) return;
      if (store.raid.raiders[uid]) return; // a later snapshot beat us to it
      const cur = s.cursor;
      store.raid.raiders[uid] = {
        uid,
        nick,
        cursorSkin,
        rawCursor: cur && typeof cur.x === "number" ? { x: cur.x, y: cur.y } : undefined,
        evictHits: typeof s.evictHits === "number" ? s.evictHits : 0,
        evictHitsNeeded: evictHitsNeeded(raiderScytheLv, store.user?.scarecrowLv ?? 0),
        startedAt: s.startedAt ?? now,
      };
      if (!alarmedUids.has(uid)) {
        alarmedUids.add(uid);
        playAlarm();
      }
    })();
  }
}

/** Land one eviction hit on a specific raider; mirror the count to their slot so they see HP drop. */
function addEvictHit(raiderUid: string, sound: boolean): void {
  if (store.raid.role !== "defending") return;
  const rv = store.raid.raiders?.[raiderUid];
  if (!rv || rv.resolved) return;
  rv.evictHits += 1;
  if (sound) playWin();
  void set(r(paths.raidRaiderEvictHits(store.uid, raiderUid)), rv.evictHits).catch(() => {});
  if (rv.evictHits >= rv.evictHitsNeeded) void evict(raiderUid);
}

/** Defender clicks in the band; `landed` = the click was within range of THAT raider's ghost cursor. */
export function registerEvictClick(raiderUid: string, landed: boolean): void {
  if (!landed) return; // a miss — the raider dodged
  addEvictHit(raiderUid, true);
}

/**
 * Grazing a raider's cursor with the mouse lands a hit too — no click needed (clicking the tiny
 * fast ghost was too hard). Fires repeatedly while the cursor overlaps, so feedback is visual-only
 * (the strip adds a pop per graze); the win sound is reserved for the final eviction.
 */
export function registerEvictGraze(raiderUid: string): void {
  addEvictHit(raiderUid, false);
}

/** Enough hits landed on one raider → flag their eviction; that thief aborts and leaves their slot. */
export async function evict(raiderUid: string): Promise<void> {
  if (store.raid.role !== "defending") return;
  const rv = store.raid.raiders?.[raiderUid];
  if (!rv || rv.resolved) return;
  rv.resolved = true;
  try {
    await set(r(paths.raidRaiderEvicted(store.uid, raiderUid)), true);
  } catch {
    /* ignore */
  }
  playWin();
  toast("침입자를 쫓아냈어요!");
  // The raider sees evicted=true and tears down; our next reconcile drops them from the map.
}
