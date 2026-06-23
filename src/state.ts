// Central mutable store. The render loop reads it every frame; event handlers mutate it
// and (for DOM panels) flag them dirty.

import type { StripGeometry } from "./platform/tauri";
import { BALANCE } from "./config/balance";

export interface CropData {
  tier: number;
  plantedAt: number;
}

export interface FriendData {
  uid: string;
  nickname: string;
  friendCode: string;
  online: boolean;
  cooldownUntil?: number; // local estimate of when I can raid them again
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
  cosmetics?: Record<string, boolean | string>;
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
  // raiding (I am the thief):
  targetUid?: string;
  targetNick?: string;
  targetCrops?: Record<string, CropData>;
  ownerCursor?: { x: number; y: number }; // smoothed ghost (band-normalised 0..1)
  // defending (my plot is being robbed):
  raiderUid?: string;
  raiderNick?: string;
  // shared timing:
  startedAt?: number;
  durationMs?: number;
  resolved?: boolean;
}

export type PanelKind = "none" | "shop" | "friends" | "messages" | "cosmetics" | "settings";

export interface Store {
  ready: boolean;
  uid: string;
  user: UserRecord | null;
  crops: Record<string, CropData>;
  friends: FriendData[];
  messages: LeftMessage[];
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
  friends: [],
  messages: [],
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

export function toast(msg: string, ms = 2600): void {
  store.ui.toast = msg;
  store.ui.toastUntil = Date.now() + ms;
  markPanelsDirty();
}

export function coins(): number {
  return store.user?.coins ?? 0;
}

export function bandHeightCss(): number {
  return BALANCE.strip.bandHeightLogical;
}

export function bandDock(): "top" | "bottom" {
  return store.geometry?.band_dock ?? "bottom";
}
