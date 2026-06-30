// Central mutable store. The render loop reads it every frame; event handlers mutate it
// and (for DOM panels) flag them dirty.

import type { StripGeometry } from "./platform/tauri";
import { BALANCE } from "./config/balance";

const CHAT_NOTIFY_KEY = "suhree_chat_notify";

export interface CropData {
  tier: number;
  plantedAt: number;
}

export interface WeedData {
  by: string; // uid of the raider who planted this weed
  at: number;
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
  // defending (my plot is being robbed): click the raider's cursor to evict.
  raiderUid?: string;
  raiderNick?: string;
  raiderCursorSkin?: string; // the raider's equipped cursor id — their ghost wears it (defending view)
  raiderCursor?: { x: number; y: number }; // smoothed raider ghost (band-normalised 0..1) — CLICK this
  evictHits?: number; // hits landed on the raider so far
  evictHitsNeeded?: number; // hits needed to evict (from levels)
  // shared timing:
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

// Toasts QUEUE so a burst of messages (rapid harvests, raid endings) plays one after another
// instead of each instantly overwriting the last. The band render pulls the active line every
// frame via currentToast(), which also advances the queue as each toast expires.
interface ToastItem {
  msg: string;
  ms: number;
}
const toastQueue: ToastItem[] = [];

export function toast(msg: string, ms = 2600): void {
  // Skip an immediate duplicate of what's already pending/showing (reconnect bursts, double taps).
  const last = toastQueue.length ? toastQueue[toastQueue.length - 1].msg : store.ui.toast;
  if (msg === last && (toastQueue.length > 0 || Date.now() < store.ui.toastUntil)) return;
  toastQueue.push({ msg, ms });
  if (toastQueue.length > 4) toastQueue.splice(0, toastQueue.length - 4); // cap a runaway backlog
  markPanelsDirty();
}

/** The toast to render right now, advancing the queue as each one expires (null = show nothing). */
export function currentToast(now = Date.now()): string | null {
  if (now >= store.ui.toastUntil) {
    const next = toastQueue.shift();
    if (next) {
      store.ui.toast = next.msg;
      store.ui.toastUntil = now + next.ms;
    } else {
      store.ui.toast = null;
    }
  }
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

export function bandHeightCss(): number {
  return BALANCE.strip.bandHeightLogical;
}

export function bandDock(): "top" | "bottom" {
  return store.geometry?.band_dock ?? "bottom";
}
