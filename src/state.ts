// Central mutable store. The render loop reads it every frame; event handlers mutate it
// and (for DOM panels) flag them dirty.

import type { StripGeometry } from "./platform/tauri";
import { BALANCE } from "./config/balance";

const CHAT_NOTIFY_KEY = "suhree_chat_notify";
const SOUND_KEY = "suhree_sound";

export interface CropData {
  tier: number;
  plantedAt: number;
}

export interface WeedData {
  by: string; // uid of the raider who planted this weed
  at: number;
  nick?: string; // planter's nickname at plant time — shown as a tag above the weed ("다녀감" 도장)
  skin?: string; // planter's equipped 잡초 스킨 id (falls back to the default weed art if absent)
}

export interface FriendData {
  uid: string;
  nickname: string;
  friendCode: string;
  online: boolean;
  coins?: number; // last-known balance (for the gold ranking)
  cooldownUntil?: number; // local estimate of when I can raid them again
  equippedDecor?: string; // for the farm preview thumbnail
  equippedTheme?: string;
  equippedTitle?: string; // shown next to their nick in chat/ranking
}

export interface ChatMessage {
  id: string;
  uid: string;
  nick: string;
  text: string;
  at: number;
  img?: string; // optional inline JPEG data URL (clipboard-pasted image); base64, size-capped
}

export interface RaidLogEntry {
  id: string;
  raider: string; // raider uid
  raiderNick: string;
  victim: string; // victim uid
  victimNick: string;
  coins: number; // total looted this raid
  count: number; // crops stolen this raid
  at: number;
}

export interface UserRecord {
  nickname: string;
  friendCode: string;
  coins: number;
  scarecrowLv: number;
  scytheLv: number;
  plotSize: number;
  equippedDecor: string;
  equippedMsgSkin: string;
  equippedTheme?: string; // band background theme (defaults to "theme_day")
  equippedTitle?: string; // title shown next to my nick (defaults to "title_none")
  equippedCursor?: string; // raid cursor shape + trail (defaults to "cursor_default")
  equippedWeedSkin?: string; // 잡초 스킨 planted in friends' plots (defaults to "weed_default")
  cosmetics?: Record<string, boolean | string>;
  // Crop 도감: per-tier { h: harvested count, s: { victimUid: stolen count } }.
  dex?: Record<string, { h?: number; s?: Record<string, number> }>;
  dexClaimed?: boolean; // completion bonus already paid out
}

export interface LeftMessage {
  id: string;
  from: string;
  text: string;
  at: number;
  skin?: string;
}

export type RaidRole = "none" | "raiding" | "defending";

/** A fellow thief robbing the same field, as seen by another raider — shown as a ghost (no threat). */
export interface CoRaiderView {
  uid: string;
  nick: string;
  cursorSkin: string; // their equipped cursor id — their ghost wears it
  rawCursor?: { x: number; y: number }; // latest network position (band-normalised 0..1)
  cursor?: { x: number; y: number }; // smoothed ghost
}

/** One intruder as seen by the defender — the defending strip holds a map of these (N raiders at once). */
export interface DefenderRaiderView {
  uid: string;
  nick: string;
  cursorSkin: string; // the raider's equipped cursor id — their ghost wears it
  rawCursor?: { x: number; y: number }; // latest network position (band-normalised 0..1)
  cursor?: { x: number; y: number }; // smoothed ghost — CLICK this
  evictHits: number; // hits landed on this raider so far
  evictHitsNeeded: number; // hits needed to evict this raider (from levels)
  startedAt: number;
  resolved?: boolean; // this raider has been evicted (flag written); ignore further hits
}

export interface RaidState {
  role: RaidRole;
  // raiding (I am the thief): click ripe crops to steal while dodging the owner's cursor.
  targetUid?: string;
  targetNick?: string;
  targetCrops?: Record<string, CropData>;
  targetWeeds?: Record<string, WeedData>; // weeds already in the victim's plot (can't double-plant)
  targetPlotSize?: number; // victim's plot size — the raid view shows THEIR slots
  targetDecor?: string; // the victim's equipped decor/theme — so the raider sees their decorated farm
  targetTheme?: string;
  ownerCursorSkin?: string; // the victim's equipped cursor id — their ghost wears it (raiding view)
  ownerCursor?: { x: number; y: number }; // smoothed defender ghost (band-normalised 0..1) — DODGE this
  cropClicks?: number; // clicks needed to steal one ripe crop (from levels)
  stealProgress?: Record<string, number>; // slot → clicks landed so far
  stolenCoins?: number; // running total looted this raid
  stolenCount?: number; // crops fully stolen this raid (for the 서리 log)
  evictHits?: number; // MY health as the thief: hits the defender has landed on me (synced from my slot)
  evictHitsNeeded?: number; // hits the defender needs to evict me (from levels)
  coRaiders?: Record<string, CoRaiderView>; // other thieves on THIS field — their cursors (key = uid)
  // defending (my plot is being robbed): click each raider's cursor to evict them individually.
  // N raiders can hit one field at once, so the defending side is a map keyed by raiderUid.
  raiders?: Record<string, DefenderRaiderView>;
  // shared timing (raiding side only — the defender tracks per-raider startedAt in the map):
  startedAt?: number;
  durationMs?: number;
  resolved?: boolean;
}

export type PanelKind =
  | "none"
  | "shop"
  | "friends"
  | "chat"
  | "ranking"
  | "messages"
  | "cosmetics"
  | "dex"
  | "raidlog"
  | "stats"
  | "spy"
  | "settings";

export interface Store {
  ready: boolean;
  uid: string;
  user: UserRecord | null;
  crops: Record<string, CropData>;
  weeds: Record<string, WeedData>; // weeds raiders planted in MY plot (slot → weed)
  friends: FriendData[];
  messages: LeftMessage[];
  chat: ChatMessage[];
  chatUnread: boolean;
  chatNotify: boolean; // show the corner popup for new chat messages
  soundEnabled: boolean; // master switch for every procedural sound effect (sfx.ts)
  raidlog: RaidLogEntry[]; // server-wide 서리 feed (newest last)
  geometry: StripGeometry | null;
  hiddenFullscreen: boolean;
  selectedSeedTier: number;
  raid: RaidState;
  ui: { panel: PanelKind; toast: string | null; toastUntil: number };
  now: number;
}

export const store: Store = {
  ready: false,
  uid: "",
  user: null,
  crops: {},
  weeds: {},
  friends: [],
  messages: [],
  chat: [],
  chatUnread: false,
  chatNotify: localStorage.getItem(CHAT_NOTIFY_KEY) !== "0", // default on; "0" means muted
  soundEnabled: localStorage.getItem(SOUND_KEY) !== "0", // default on; "0" means muted
  raidlog: [],
  geometry: null,
  hiddenFullscreen: false,
  selectedSeedTier: 0,
  raid: { role: "none" },
  ui: { panel: "none", toast: null, toastUntil: 0 },
  now: Date.now(),
};

let panelsDirty = true;
export function markPanelsDirty(): void {
  panelsDirty = true;
}
export function consumePanelsDirty(): boolean {
  if (panelsDirty) {
    panelsDirty = false;
    return true;
  }
  return false;
}

// Toasts are LATEST-WINS (no queue): a new line replaces whatever's showing immediately. These are
// transient status blips (수확·침입 등) — losing the previous one instantly is fine, and queuing just
// delayed the message the user actually cares about right now. The band render pulls the active line
// every frame via currentToast().
export function toast(msg: string, ms = 2600): void {
  store.ui.toast = msg;
  store.ui.toastUntil = Date.now() + ms;
  markPanelsDirty();
}

/** The toast to render right now (null once it has expired). */
export function currentToast(now = Date.now()): string | null {
  return store.ui.toast && now < store.ui.toastUntil ? store.ui.toast : null;
}

export function coins(): number {
  return store.user?.coins ?? 0;
}

/** Toggle the new-message corner popup, persisting the choice across restarts. */
export function setChatNotify(on: boolean): void {
  store.chatNotify = on;
  localStorage.setItem(CHAT_NOTIFY_KEY, on ? "1" : "0");
}

/** Master mute for all sound effects, persisting the choice across restarts. */
export function setSoundEnabled(on: boolean): void {
  store.soundEnabled = on;
  localStorage.setItem(SOUND_KEY, on ? "1" : "0");
}

export function bandHeightCss(): number {
  return BALANCE.strip.bandHeightLogical;
}

export function bandDock(): "top" | "bottom" {
  return store.geometry?.band_dock ?? "bottom";
}
