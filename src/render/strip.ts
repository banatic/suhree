import { store, toast, currentToast, bandHeightCss, bandDock, coins, type PanelKind } from "../state";
import { BALANCE } from "../config/balance";
import { stageOf, tierOf, plant, harvest, msToRipe, type Stage } from "../game/crops";
import {
  drawSprite,
  drawCropSprite,
  SEED,
  SPROUT,
  GROWING,
  RIPE_RADISH,
  RIPE_WHEAT,
  RIPE_PUMPKIN,
  COIN,
  SCARECROW,
  SPRITE_W,
  type Sprite,
} from "./sprites";
import { drawGhostCursor } from "./cursorGhost";
import { cursorSkin } from "./cursorArt";
import { createTrail, type Trail } from "./cursorTrail";
import { drawTheme } from "./theme";
import { drawDecorById } from "./decorArt";
import { drawWeedSkin } from "./weedArt";
import type { CosmeticScene } from "./cosmeticScene";
import { cancelRaid, registerStealClick, registerEvictClick, registerEvictGraze } from "../raid/controller";
import { plantWeed, removeWeed } from "../game/weeds";
import { togglePanel, getPanelRect } from "./panels";
import { getChatPopupRect } from "./chatPopup";
import { getLootNoteRect } from "./lootNote";
import { updateHitRegions, onStripHover, type NormRect } from "../platform/tauri";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Slot {
  cx: number;
  i: number;
}
interface BandLayout {
  W: number;
  H: number;
  dock: "top" | "bottom";
  dir: -1 | 1;
  bandY: number;
  bandH: number;
  soilY: number;
  scale: number;
  slotW: number;
  maxCropPx: number;
  slots: Slot[];
  slotSpan: { x0: number; x1: number };
}
interface Btn {
  id: string;
  label: string;
  rect: Rect;
}
interface Effect {
  kind: "pop" | "coin" | "poof";
  x: number;
  y: number;
  start: number;
  value?: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let lastDpr = 1;

let hovered = false;
let hudT = 0; // 0..1 roll-up progress
let winkStart = 0; // first-run "wink" timestamp
let lastRaidRole = "none";
let lastPointer: { x: number; y: number } | null = null; // last in-canvas mouse pos (CSS px)

// Farm collapse: tuck the whole band away so clicks fall through to what's behind it (e.g. the
// taskbar). The little brown tab at the band's inner edge stays visible + clickable to bring it
// back. Persisted so the choice survives a restart; a raid always overrides it (see isCollapsed).
const COLLAPSE_KEY = "suhree_farm_collapsed";
let farmCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
const effects: Effect[] = [];
// Trail wakes: the owner ghost's while I raid, and your own cursor's while you hover the band.
const ghostTrail = createTrail();
const selfTrail = createTrail();
// Defending against N intruders: one trail + one graze-throttle per raider (keyed by raiderUid).
const raiderTrails = new Map<string, Trail>();
const grazeAt = new Map<string, number>();

function raiderTrail(uid: string): Trail {
  let t = raiderTrails.get(uid);
  if (!t) {
    t = createTrail();
    raiderTrails.set(uid, t);
  }
  return t;
}

const HUD_H = 34;
const EVICT_GRAZE_MS = 140; // min ms between hover-graze eviction hits (defender)
const TALLEST_ROWS = 22; // wheat
const FONT = "'MulmaruMono', ui-monospace, monospace";
const HUD_LABELS: { id: string; label: string }[] = [
  { id: "seed", label: "씨앗" },
  { id: "shop", label: "상점" },
  { id: "friends", label: "친구" },
  { id: "chat", label: "채팅" },
  { id: "ranking", label: "랭킹" },
  { id: "messages", label: "쪽지" },
  { id: "cosmetics", label: "꾸미기" },
  { id: "dex", label: "도감" },
  { id: "raidlog", label: "서리기록" },
  { id: "stats", label: "통계" },
  { id: "spy", label: "🔮점지" },
  { id: "settings", label: "설정" },
];

// The 점지 chip is a hidden easter egg: it exists only for one nickname, and that owner can further
// toggle it on/off with a secret key sequence (see setupStripInteractions). Default = shown.
const SPY_HIDDEN_KEY = "suhree_spy_off";
function spyButtonVisible(): boolean {
  return store.user?.nickname === "정충봉" && localStorage.getItem(SPY_HIDDEN_KEY) !== "1";
}
function visibleHudLabels(): { id: string; label: string }[] {
  return HUD_LABELS.filter((b) => b.id !== "spy" || spyButtonVisible());
}

// ── Canvas ─────────────────────────────────────────────────────────────────

function ensureCanvas(): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "strip-canvas";
    document.getElementById("app")!.appendChild(canvas);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", (e) => {
      lastPointer = cssCoords(e);
    });
    canvas.addEventListener("mouseleave", () => {
      lastPointer = null;
    });
  }
  const needW = Math.floor(window.innerWidth * dpr);
  const needH = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== needW || canvas.height !== needH || dpr !== lastDpr) {
    canvas.width = needW;
    canvas.height = needH;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    lastDpr = dpr;
    ctx = canvas.getContext("2d");
    publishHitRegions();
  }
  if (!ctx) ctx = canvas.getContext("2d");
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx!.imageSmoothingEnabled = false;
  return ctx!;
}

// ── Layout ───────────────────────────────────────────────────────────────────

function layout(): BandLayout {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const bandH = bandHeightCss();
  const dock = bandDock();
  const soil = BALANCE.strip.soilLogical;
  const bandY = dock === "bottom" ? H - bandH : 0;
  const dir: -1 | 1 = dock === "bottom" ? -1 : 1;
  const soilY = dock === "bottom" ? bandY + bandH - soil : bandY + soil;

  // While raiding, render the VICTIM's plot (their slot count); otherwise my own.
  const raidingSize = store.raid.role === "raiding" ? store.raid.targetPlotSize : undefined;
  const slotCount = Math.max(
    1,
    raidingSize ?? store.user?.plotSize ?? BALANCE.shop.plotExpansion.startSlots,
  );
  const maxRowW = W * 0.92;
  let scale = 2;
  let slotW = 16 * scale + 6;
  if (slotCount * slotW > maxRowW) {
    scale = 1;
    slotW = 16 * scale + 6;
  }
  if (slotCount * slotW > maxRowW) slotW = Math.max(13, maxRowW / slotCount);

  const rowW = slotCount * slotW;
  const startX = (W - rowW) / 2;
  const slots: Slot[] = [];
  for (let i = 0; i < slotCount; i++) slots.push({ cx: startX + i * slotW + slotW / 2, i });

  const maxCropPx = TALLEST_ROWS * scale;
  return {
    W,
    H,
    dock,
    dir,
    bandY,
    bandH,
    soilY,
    scale,
    slotW,
    maxCropPx,
    slots,
    slotSpan: { x0: startX, x1: startX + rowW },
  };
}

function chipW(label: string, extra = 0): number {
  return label.length * 14 + 18 + extra;
}

function hudLayout(L: BandLayout): { coin: Rect; buttons: Btn[]; barYOpen: number; bg: Rect } {
  const barYOpen = L.dock === "bottom" ? L.bandY - HUD_H : L.bandY + L.bandH;
  const chipH = HUD_H - 8;
  const chipY = barYOpen + (HUD_H - chipH) / 2;
  const gap = 6;
  const coinW = 28 + String(coins()).length * 9;
  const parts = visibleHudLabels().map((b) => ({ ...b, w: chipW(b.label, b.id === "seed" ? 12 : 0) }));
  const totalW = coinW + gap + parts.reduce((a, p) => a + p.w + gap, 0) - gap;
  const startX = clamp(L.W / 2 - totalW / 2, 8, Math.max(8, L.W - totalW - 8));
  let x = startX;
  const coin: Rect = { x, y: chipY, w: coinW, h: chipH };
  x += coinW + gap;
  const buttons: Btn[] = parts.map((p) => {
    const r: Rect = { x, y: chipY, w: p.w, h: chipH };
    x += p.w + gap;
    return { id: p.id, label: p.label, rect: r };
  });
  const bg: Rect = { x: startX - 8, y: barYOpen, w: totalW + 16, h: HUD_H };
  return { coin, buttons, barYOpen, bg };
}

// ── Render ───────────────────────────────────────────────────────────────────

export function renderStrip(): void {
  const c = ensureCanvas();
  c.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (store.hiddenFullscreen || !store.ready) return;

  const L = layout();

  if (store.raid.role !== lastRaidRole) {
    lastRaidRole = store.raid.role;
    ghostTrail.reset(); // the ghost we're trailing just changed (or vanished)
    raiderTrails.clear(); // drop any per-intruder trails from a previous defence
    grazeAt.clear();
    publishHitRegions();
  }

  // Collapsed: the farm is tucked away and everything but the little brown tab passes clicks
  // through. Draw only the tab (click it to bring the farm back) and keep the HUD idle.
  if (isCollapsed()) {
    hudT = 0;
    drawCollapseTab(c, L);
    drawToast(c, L);
    maybeRepublishHitRegions(L);
    return;
  }

  // hover roll-up easing (+ first-run wink). Poising over the collapse tab does NOT summon the HUD
  // (hudEngaged excludes it), so the tab stays cleanly clickable.
  let target = hudEngaged(L) ? 1 : 0;
  if (winkStart) {
    const p = (store.now - winkStart) / 700;
    if (p < 1) target = Math.max(target, Math.sin(p * Math.PI) * 0.5);
    else winkStart = 0;
  }
  hudT += (target - hudT) * BALANCE.strip.hoverEase;
  if (hudT < 0.001) hudT = 0;

  if (store.raid.role === "raiding") drawRaidingView(c, L);
  else if (store.raid.role === "defending") drawDefendingView(c, L);
  else drawFarmView(c, L);

  drawToast(c, L);

  // Keep the at-rest crop hit boxes in sync as crops grow / get harvested (no hover event fires
  // then). Cheap signature check — only re-publishes to Rust on an actual change.
  maybeRepublishHitRegions(L);
}

function drawFarmView(c: CanvasRenderingContext2D, L: BandLayout): void {
  drawThemeBg(c, L, store.user?.equippedTheme);
  drawSoil(c, L);
  drawDecor(c, L, store.user?.equippedDecor);
  for (const s of L.slots) {
    const key = String(s.i);
    if (store.weeds[key]) {
      drawShadow(c, s.cx, L.soilY, L.slotW);
      drawWeed(c, L, s, store.weeds[key].skin);
      drawWeedTag(c, L, s, store.weeds[key].nick);
      const pulled = weedPullClicks[key] ?? 0;
      if (pulled > 0) drawStealPips(c, L, s, pulled, BALANCE.weed.removeClicks);
      continue;
    }
    const crop = store.crops[key];
    if (!crop) {
      if (hudT > 0.3) drawEmptyMarker(c, L, s);
      continue;
    }
    const st = stageOf(crop.plantedAt, crop.tier, store.now);
    drawShadow(c, s.cx, L.soilY, L.slotW);
    drawCropAt(c, L, s, crop.tier, st);
  }
  if (hudT > 0.4 && (store.user?.scarecrowLv ?? 0) > 0 && L.slots.length) {
    const sc = Math.max(1, L.scale - 1);
    drawSprite(c, SCARECROW, L.slotSpan.x0 - 18 * sc, L.soilY - 14 * sc, sc);
  }
  drawEffects(c, L);
  drawSelfTrail(c, L);
  drawHUD(c, L);
  drawCollapseTab(c, L);
}

/** Your own cursor's trail while you hover your strip — personal flair (the OS arrow stays as-is). */
function drawSelfTrail(c: CanvasRenderingContext2D, L: BandLayout): void {
  const style = cursorSkin(store.user?.equippedCursor).trail;
  if (lastPointer && hovered && style.kind !== "none") {
    selfTrail.emit(lastPointer.x, lastPointer.y, style, store.now, L.dir);
  }
  selfTrail.step(c, store.now); // step every frame so it keeps fading after the mouse leaves
}

function drawSoil(c: CanvasRenderingContext2D, L: BandLayout): void {
  const x0 = Math.max(0, L.slotSpan.x0 - 8);
  const x1 = Math.min(L.W, L.slotSpan.x1 + 8);
  const w = x1 - x0;
  const y = L.soilY;
  c.fillStyle = "rgba(255,236,200,0.22)";
  c.fillRect(x0, y - 2, w, 1);
  c.fillStyle = "#7a5230";
  c.fillRect(x0, y - 1, w, 1);
  c.fillStyle = "#5b3a21";
  c.fillRect(x0, y, w, 2);
}

function drawShadow(c: CanvasRenderingContext2D, cx: number, soilY: number, slotW: number): void {
  c.fillStyle = "rgba(40,26,14,0.28)";
  c.beginPath();
  c.ellipse(cx, soilY + 1, slotW * 0.26, 2, 0, 0, Math.PI * 2);
  c.fill();
}

function ripeSpriteFor(tier: number): Sprite {
  const shape = tierOf(tier)?.sprite;
  if (shape === "wheat") return RIPE_WHEAT;
  if (shape === "pumpkin") return RIPE_PUMPKIN;
  return RIPE_RADISH;
}
function spriteFor(stage: Stage, tier: number): Sprite | null {
  switch (stage) {
    case "seed":
      return SEED;
    case "sprout":
      return SPROUT;
    case "growing":
      return GROWING;
    case "ripe":
      return ripeSpriteFor(tier);
    default:
      return null;
  }
}

function drawCropAt(c: CanvasRenderingContext2D, L: BandLayout, s: Slot, tier: number, st: Stage): void {
  const sp = spriteFor(st, tier);
  if (!sp) return;
  const sway = Math.sin(store.now / 900 + s.i * 1.3) * 1.1 * L.scale;
  const bob = st === "ripe" ? Math.abs(Math.sin(store.now / 500 + s.i)) * 1.5 : 0;
  const liftedSoil = L.soilY + (L.dir < 0 ? -bob : bob);
  const ov = cropOverrides(tier);
  drawCropSprite(c, sp, s.cx, liftedSoil, L.scale, L.dir, ov, sway);
  if (st === "ripe" && Math.sin(store.now / 600 + s.cx) > 0.72) {
    const topY = L.dir < 0 ? liftedSoil - sp.rows.length * L.scale : liftedSoil + sp.rows.length * L.scale;
    const sz = Math.max(2, L.scale);
    c.fillStyle = "#fff7e0";
    c.fillRect(Math.round(s.cx + 2 * L.scale + sway), Math.round(topY), sz, sz);
  }
}

function drawEmptyMarker(c: CanvasRenderingContext2D, L: BandLayout, s: Slot): void {
  c.globalAlpha = Math.min(1, hudT) * 0.5;
  c.strokeStyle = "#f6eedd";
  c.lineWidth = 2;
  const cy = L.soilY - 6 * L.dir * -1 - 6;
  const r = 4;
  c.beginPath();
  c.moveTo(s.cx - r, cy);
  c.lineTo(s.cx + r, cy);
  c.moveTo(s.cx, cy - r);
  c.lineTo(s.cx, cy + r);
  c.stroke();
  c.globalAlpha = 1;
}

// ── Weeds (raider griefing: clutter an empty slot; owner clicks to pull) ──────────
// Owner-side pull progress is local (resets on reload) — it just gates the final remove.
const weedPullClicks: Record<string, number> = {};

function drawWeed(c: CanvasRenderingContext2D, L: BandLayout, s: Slot, skin?: string): void {
  drawWeedSkin(c, skin, {
    cx: s.cx,
    soilY: L.soilY,
    scale: L.scale,
    dir: L.dir,
    nowMs: store.now,
    seed: s.i,
  });
}

/** Faint "+" on an empty slot during a raid — telegraphs that you can plant a weed here. */
function drawWeedTargetHint(c: CanvasRenderingContext2D, L: BandLayout, s: Slot): void {
  c.save();
  c.globalAlpha = 0.22;
  c.strokeStyle = "#5d8a39";
  c.lineWidth = 1;
  const y = L.soilY + L.dir * 6 * L.scale;
  const r = 3 * L.scale;
  c.beginPath();
  c.moveTo(s.cx - r, y);
  c.lineTo(s.cx + r, y);
  c.moveTo(s.cx, y - r);
  c.lineTo(s.cx, y + r);
  c.stroke();
  c.restore();
}

/** Small "○○ 다녀감" nickname stamp above a planted weed — marks who griefed this slot. */
function drawWeedTag(c: CanvasRenderingContext2D, L: BandLayout, s: Slot, nick?: string): void {
  if (!nick) return;
  const text = nick.length > 8 ? nick.slice(0, 8) + "…" : nick;
  c.save();
  c.font = `bold 9px ${FONT}`;
  const w = c.measureText(text).width + 8;
  const tagH = 12;
  // Anchor just past the weed's tip, then clamp the whole tag inside the band.
  const tip = L.soilY + L.dir * (9 * L.scale + 4);
  let y = L.dir < 0 ? tip - tagH : tip;
  y = clamp(y, L.bandY + 1, L.bandY + L.bandH - tagH - 1);
  const x = clamp(s.cx - w / 2, 2, L.W - w - 2);
  c.globalAlpha = 0.92;
  c.fillStyle = "rgba(40,26,14,0.82)";
  roundRect(c, x, y, w, tagH, 3);
  c.fill();
  c.fillStyle = "#e6c98f";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, x + w / 2, y + tagH / 2 + 0.5);
  c.restore();
  c.textAlign = "left";
}

function cropOverrides(tier: number): Record<string, string> {
  const base = tierOf(tier)?.color || "#e08a3c";
  return { f: base, h: lighten(base, 0.22), d: darken(base, 0.26) };
}

// ── HUD (hover roll-up) ────────────────────────────────────────────────────────

function drawHUD(c: CanvasRenderingContext2D, L: BandLayout): void {
  if (hudT <= 0.02) return;
  const hud = hudLayout(L);
  const slide = (1 - hudT) * (HUD_H + 10) * (L.dock === "bottom" ? 1 : -1);
  const a = Math.min(1, hudT * 1.3);
  c.save();

  // cohesive wood-framed backdrop
  c.globalAlpha = a;
  const bg = { ...hud.bg, y: hud.bg.y + slide };
  c.fillStyle = "rgba(58,42,26,0.94)";
  roundRect(c, bg.x, bg.y, bg.w, bg.h, 11);
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = "#caa15e";
  roundRect(c, bg.x, bg.y, bg.w, bg.h, 11);
  c.stroke();

  // coin pill
  const pop = 1 + 0.08 * Math.sin(Math.min(1, hudT) * Math.PI);
  const coinY = hud.coin.y + slide;
  drawSprite(c, COIN, hud.coin.x + 4, coinY + hud.coin.h / 2 - 7 * pop, 2 * pop);
  c.fillStyle = "#ffe9a8";
  c.font = `bold 14px ${FONT}`;
  c.textBaseline = "middle";
  c.textAlign = "left";
  c.fillText(String(coins()), hud.coin.x + 22, coinY + hud.coin.h / 2 + 1);

  // labeled chips, staggered left→right
  for (let i = 0; i < hud.buttons.length; i++) {
    const b = hud.buttons[i];
    const t = clamp((hudT - i * 0.05) / 0.75, 0, 1);
    c.globalAlpha = a * t;
    const r: Rect = { ...b.rect, y: b.rect.y + slide + (1 - t) * 8 };
    drawWoodButton(c, r, store.ui.panel === b.id);
    let textX = r.x + r.w / 2;
    if (b.id === "seed") {
      const tier = tierOf(store.selectedSeedTier);
      c.fillStyle = tier?.color || "#fff";
      c.beginPath();
      c.arc(r.x + 11, r.y + r.h / 2, 4.5, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = "#2e2117";
      c.stroke();
      textX = r.x + 11 + (r.w - 11) / 2;
    }
    c.fillStyle = "#2e2117";
    c.font = `bold 13px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(b.label, textX, r.y + r.h / 2 + 1);
    const badge =
      (b.id === "messages" && store.messages.length > 0) || (b.id === "chat" && store.chatUnread);
    if (badge) {
      c.fillStyle = "#e2573c";
      c.beginPath();
      c.arc(r.x + r.w - 5, r.y + 5, 4, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
  c.textAlign = "left";
}

// ── Collapse tab (the little brown handle at the band's inner edge) ───────────────
// Repurposed from the old hover hint: it now toggles the whole farm away/back. The chevron points
// toward the screen edge to COLLAPSE (farm showing) and toward the interior to EXPAND (collapsed).

function isCollapsed(): boolean {
  // A raid always wins — you must be able to see & defend your plot even if you'd tucked it away.
  return farmCollapsed && store.raid.role === "none";
}

function setCollapsed(v: boolean): void {
  if (farmCollapsed === v) return;
  farmCollapsed = v;
  localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  hovered = false; // drop any stale hover so the HUD doesn't linger after collapsing
  publishHitRegions();
}

/** The clickable box around the collapse tab (generous — bigger than the drawn art). */
function collapseTabRect(L: BandLayout): Rect {
  const w = 40;
  const h = 22;
  const x = L.W / 2 - w / 2;
  const y = L.dock === "bottom" ? L.bandY - h + 6 : L.bandY + L.bandH - 6;
  return { x, y, w, h };
}

/**
 * True when the HUD should be up: hovering the band, but NOT merely poised over the collapse tab.
 * (Being over the tab captures clicks — via its hit region — without summoning the menu, so the tab
 * stays reachable instead of vanishing behind a rolled-up HUD.)
 */
function hudEngaged(L: BandLayout): boolean {
  if (!hovered) return false;
  if (lastPointer && inRect(lastPointer.x, lastPointer.y, collapseTabRect(L))) return false;
  return true;
}

function drawCollapseTab(c: CanvasRenderingContext2D, L: BandLayout): void {
  const cx = L.W / 2;
  const collapsed = isCollapsed();
  const edgeDir = L.dock === "bottom" ? 1 : -1; // toward the screen edge the band tucks into
  const cd = collapsed ? -edgeDir : edgeDir; // chevron direction: edge = collapse, interior = expand
  const barCY = L.dock === "bottom" ? L.bandY - 6 : L.bandY + L.bandH + 6;

  c.save();
  // subtle pill so it reads as a control (and is findable when it's the only thing on screen)
  const bw = 34;
  const bh = 15;
  c.globalAlpha = collapsed ? 0.92 : 0.7;
  c.fillStyle = "rgba(58,42,26,0.82)";
  roundRect(c, cx - bw / 2, barCY - bh / 2, bw, bh, 6);
  c.fill();
  c.lineWidth = 1;
  c.strokeStyle = "#caa15e";
  roundRect(c, cx - bw / 2, barCY - bh / 2, bw, bh, 6);
  c.stroke();

  // brown grip bar (the "little brown bar" this was born from)
  c.globalAlpha = 1;
  c.fillStyle = "#9c6b38";
  roundRect(c, cx - 9, barCY - 4, 18, 3, 1.5);
  c.fill();

  // chevron
  c.strokeStyle = "#f6eedd";
  c.lineWidth = 2;
  c.lineJoin = "round";
  c.lineCap = "round";
  const chY = barCY + 3;
  const chW = 5;
  c.beginPath();
  c.moveTo(cx - chW, chY - cd * 2);
  c.lineTo(cx, chY + cd * 2);
  c.lineTo(cx + chW, chY - cd * 2);
  c.stroke();
  c.restore();
}

// ── Raid views ──────────────────────────────────────────────────────────────

function drawRaidingView(c: CanvasRenderingContext2D, L: BandLayout): void {
  const raid = store.raid;
  drawThemeBg(c, L, raid.targetTheme);
  drawSoil(c, L);
  drawDecor(c, L, raid.targetDecor);
  const need = raid.cropClicks ?? 3;
  let ripeLeft = 0;
  for (const s of L.slots) {
    const key = String(s.i);
    const crop = raid.targetCrops?.[key];
    if (crop) {
      const st = stageOf(crop.plantedAt, crop.tier, store.now);
      if (st === "ripe") ripeLeft++;
      drawShadow(c, s.cx, L.soilY, L.slotW);
      c.save();
      if (st !== "ripe") c.globalAlpha = 0.4;
      drawCropAt(c, L, s, crop.tier, st);
      c.restore();
      if (st === "ripe") drawStealPips(c, L, s, raid.stealProgress?.[key] ?? 0, need);
    } else if (raid.targetWeeds?.[key]) {
      drawShadow(c, s.cx, L.soilY, L.slotW);
      drawWeed(c, L, s, raid.targetWeeds[key].skin);
      drawWeedTag(c, L, s, raid.targetWeeds[key].nick);
    } else {
      drawWeedTargetHint(c, L, s); // empty → click to plant a weed
    }
  }

  // The defender's cursor — DODGE it. A pulsing danger ring telegraphs its catch radius.
  if (raid.ownerCursor) {
    const gx = raid.ownerCursor.x * L.W;
    const gy = L.bandY + raid.ownerCursor.y * L.bandH;
    c.save();
    c.globalAlpha = 0.45 + 0.3 * Math.sin(store.now / 150);
    c.strokeStyle = "#e2573c";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(gx, gy, BALANCE.raidGame.evictHitRadius * 0.7, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    // The defender's own cursor cosmetic (shape + trail) — drawn behind, then the ghost on top.
    ghostTrail.emit(gx, gy, cursorSkin(raid.ownerCursorSkin).trail, store.now, L.dir);
    ghostTrail.step(c, store.now);
    drawGhostCursor(c, gx - 1, gy - 8, Math.max(2, L.scale), raid.ownerCursorSkin);
  } else {
    ghostTrail.step(c, store.now); // keep fading even if the ghost briefly drops out
  }

  // Fellow thieves robbing the SAME field — show their ghosts + names (no danger ring; not a threat).
  const co = raid.coRaiders;
  if (co) {
    for (const u of [...raiderTrails.keys()]) if (!co[u]) raiderTrails.delete(u);
    for (const uid of Object.keys(co)) {
      const rv = co[uid];
      const trail = raiderTrail(uid);
      if (!rv.cursor) {
        trail.step(c, store.now);
        continue;
      }
      const gx = rv.cursor.x * L.W;
      const gy = L.bandY + rv.cursor.y * L.bandH;
      trail.emit(gx, gy, cursorSkin(rv.cursorSkin).trail, store.now, L.dir);
      trail.step(c, store.now);
      drawGhostCursor(c, gx - 1, gy - 8, Math.max(2, L.scale), rv.cursorSkin);
      drawCursorNameTag(c, gx, gy, rv.nick || "도둑", L);
    }
  }

  drawEffects(c, L);

  // header: looted total + ripe remaining (+ weed hint)
  c.fillStyle = "#ffe9a8";
  c.font = `bold 12px ${FONT}`;
  c.textBaseline = "top";
  c.textAlign = "left";
  c.fillText(`💰 +${raid.stolenCoins ?? 0} · 익은작물 ${ripeLeft} (작물당 ${need}클릭) · 빈칸 클릭=잡초 심기`, 10, L.bandY + 3);

  drawRaiderHP(c, L);
  drawRaidProgress(c, L, "#e8b94a");
  drawActionButton(c, actionButtonRect(L, "left"), "도망치기", "#caa86a", "#2e2117");
}

/** Raider's health: how many defender hits remain before I'm evicted. Synced via raid.evictHits. */
function drawRaiderHP(c: CanvasRenderingContext2D, L: BandLayout): void {
  const raid = store.raid;
  const need = raid.evictHitsNeeded ?? 3;
  const hp = Math.max(0, need - (raid.evictHits ?? 0));
  const frac = need > 0 ? hp / need : 1;
  const bw = 78;
  const bh = 7;
  const bx = L.W - bw - 10;
  const by = L.bandY + 3;
  c.font = `bold 11px ${FONT}`;
  c.textBaseline = "top";
  c.textAlign = "right";
  c.fillStyle = "#ffd8cf";
  c.fillText(`❤️${hp}/${need}`, bx - 6, by - 1);
  c.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(c, bx, by, bw, bh, 3);
  c.fill();
  c.fillStyle = frac > 0.5 ? "#5fd07a" : frac > 0.25 ? "#e8b94a" : "#e2573c";
  roundRect(c, bx, by, Math.max(0, bw * frac), bh, 3);
  c.fill();
  c.textAlign = "left";
}

function drawDefendingView(c: CanvasRenderingContext2D, L: BandLayout): void {
  // pulsing red rim + brief shake (keeps crops readable, screams "raid")
  const raid = store.raid;
  const raiders = raid.raiders || {};
  const uids = Object.keys(raiders);
  // brief shake right after the newest intruder arrives
  let minStart = Infinity;
  for (const u of uids) minStart = Math.min(minStart, raiders[u].startedAt || store.now);
  const elapsed = isFinite(minStart) ? store.now - minStart : 0;
  const shake = elapsed < 800 ? Math.sin(store.now / 40) * 1 : 0;
  c.save();
  c.translate(shake, 0);
  drawThemeBg(c, L, store.user?.equippedTheme);
  drawSoil(c, L);
  drawDecor(c, L, store.user?.equippedDecor);
  const rim = 0.5 + 0.4 * Math.sin(store.now / 140);
  c.globalAlpha = rim;
  c.strokeStyle = "#e2573c";
  c.lineWidth = 2;
  c.strokeRect(1, L.bandY + 1, L.W - 2, L.bandH - 2);
  c.globalAlpha = 1;
  for (const s of L.slots) {
    const key = String(s.i);
    if (store.weeds[key]) {
      drawShadow(c, s.cx, L.soilY, L.slotW);
      drawWeed(c, L, s, store.weeds[key].skin);
      drawWeedTag(c, L, s, store.weeds[key].nick);
      continue;
    }
    const crop = store.crops[key];
    if (!crop) continue;
    const st = stageOf(crop.plantedAt, crop.tier, store.now);
    drawShadow(c, s.cx, L.soilY, L.slotW);
    drawCropAt(c, L, s, crop.tier, st);
  }
  c.restore();

  c.fillStyle = "#ffd8cf";
  c.font = `bold 12px ${FONT}`;
  c.textBaseline = "top";
  c.textAlign = "left";
  const header =
    uids.length > 1
      ? `⚠ 침입자 ${uids.length}명! 커서에 마우스를 갖다 대 각각 쫓아내세요`
      : `⚠ 침입자! 커서에 마우스를 갖다 대 쫓아내세요`;
  c.fillText(header, 10, L.bandY + 3);

  // Drop trails/throttles for intruders that have left.
  for (const u of [...raiderTrails.keys()]) if (!raiders[u]) raiderTrails.delete(u);
  for (const u of [...grazeAt.keys()]) if (!raiders[u]) grazeAt.delete(u);

  // Each intruder: graze it with your mouse. Target ring + the intruder's NAME + their HP.
  for (const uid of uids) {
    const rv = raiders[uid];
    const trail = raiderTrail(uid);
    if (!rv.cursor) {
      trail.step(c, store.now); // keep fading even if this ghost briefly drops out
      continue;
    }
    const gx = rv.cursor.x * L.W;
    const gy = L.bandY + rv.cursor.y * L.bandH;
    // Hover-to-evict: grazing the ghost lands hits (throttled per raider) — no click needed.
    if (
      lastPointer &&
      !rv.resolved &&
      Math.hypot(lastPointer.x - gx, lastPointer.y - gy) <= BALANCE.raidGame.evictHitRadius &&
      store.now - (grazeAt.get(uid) ?? 0) >= EVICT_GRAZE_MS
    ) {
      grazeAt.set(uid, store.now);
      addEffect("pop", gx, gy);
      registerEvictGraze(uid);
    }
    c.save();
    c.globalAlpha = 0.6 + 0.3 * Math.sin(store.now / 120);
    c.strokeStyle = "#9bf6a0";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(gx, gy, BALANCE.raidGame.evictHitRadius * 0.7, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    // The intruder's cursor cosmetic (shape + trail) — trail behind, ghost + name tag + HP on top.
    trail.emit(gx, gy, cursorSkin(rv.cursorSkin).trail, store.now, L.dir);
    trail.step(c, store.now);
    drawGhostCursor(c, gx - 1, gy - 8, Math.max(2, L.scale), rv.cursorSkin);
    drawCursorNameTag(c, gx, gy, rv.nick || "침입자", L);
    drawIntruderHp(c, gx, gy, rv.evictHits, rv.evictHitsNeeded, L);
  }

  drawEffects(c, L);
}

/** Tiny per-intruder HP plate under their ghost cursor (how many hits left to evict THIS one). */
function drawIntruderHp(
  c: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  hits: number,
  need: number,
  L: BandLayout,
): void {
  const hp = Math.max(0, need - hits);
  const text = `❤${hp}/${need}`;
  c.save();
  c.font = `bold 10px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "top";
  const w = c.measureText(text).width + 6;
  const y = clamp(gy + 9, L.bandY + 1, L.bandY + L.bandH - 13);
  c.fillStyle = "rgba(40,26,14,0.85)";
  roundRect(c, gx - w / 2, y, w, 12, 3);
  c.fill();
  c.fillStyle = hp > need * 0.5 ? "#9bf6a0" : hp > need * 0.25 ? "#e8b94a" : "#e2573c";
  c.fillText(text, gx, y + 1);
  c.restore();
  c.textAlign = "left";
}

/** Pips above a ripe crop showing how many of the required steal-clicks have landed. */
function drawStealPips(c: CanvasRenderingContext2D, L: BandLayout, s: Slot, prog: number, need: number): void {
  const y = clamp(L.dock === "bottom" ? L.bandY + 3 : L.bandY + L.bandH - 3, L.bandY + 2, L.bandY + L.bandH - 2);
  const gap = Math.min(4, (L.slotW - 2) / Math.max(1, need));
  const totalW = (need - 1) * gap;
  let x = s.cx - totalW / 2;
  for (let i = 0; i < need; i++) {
    c.fillStyle = i < prog ? "#ffe9a8" : "rgba(0,0,0,0.4)";
    c.beginPath();
    c.arc(x, y, 1.6, 0, Math.PI * 2);
    c.fill();
    x += gap;
  }
}

/** A small name tag drawn beside a ghost cursor (flips to the left near the right edge). */
function drawCursorNameTag(
  c: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  name: string,
  L: BandLayout,
): void {
  const text = name.length > 10 ? name.slice(0, 10) + "…" : name;
  c.save();
  c.font = `bold 11px ${FONT}`;
  const w = c.measureText(text).width + 10;
  const h = 14;
  let x = gx + 12;
  if (x + w > L.W - 2) x = gx - 12 - w;
  let y = clamp(gy - 7, L.bandY + 1, L.bandY + L.bandH - h - 1);
  c.fillStyle = "rgba(40,26,14,0.92)";
  roundRect(c, x, y, w, h, 4);
  c.fill();
  c.fillStyle = "#ffd8cf";
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.fillText(text, x + 5, y + h / 2 + 1);
  c.restore();
  c.textAlign = "left";
}

function drawRaidProgress(c: CanvasRenderingContext2D, L: BandLayout, color: string): void {
  const raid = store.raid;
  if (!raid.startedAt || !raid.durationMs) return;
  const elapsed = store.now - raid.startedAt;
  const frac = clamp(elapsed / raid.durationMs, 0, 1);
  const remain = Math.max(0, (raid.durationMs - elapsed) / 1000);
  const bx = 10;
  const by = L.bandY + L.bandH - 5;
  const bw = L.W - 20;
  c.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(c, bx, by, bw, 4, 2);
  c.fill();
  c.fillStyle = color;
  roundRect(c, bx, by, Math.max(0, bw * frac), 4, 2);
  c.fill();
  c.fillStyle = "#fff";
  c.font = "bold 11px 'MulmaruMono', ui-monospace, monospace";
  c.textBaseline = "bottom";
  c.textAlign = "right";
  c.fillText(`${remain.toFixed(1)}s`, bx + bw, by - 1);
  c.textAlign = "left";
}

function actionButtonRect(L: BandLayout, pos: "center" | "left"): Rect {
  const w = Math.min(150, L.W * 0.28);
  const h = Math.min(26, L.bandH - 6);
  let x = L.W / 2 - w / 2;
  if (pos === "left") x = 10;
  return { x, y: L.bandY + (L.bandH - h) / 2, w, h };
}

function drawActionButton(c: CanvasRenderingContext2D, r: Rect, label: string, bg: string, fg: string): void {
  c.fillStyle = bg;
  roundRect(c, r.x, r.y, r.w, r.h, 7);
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = "rgba(0,0,0,0.4)";
  roundRect(c, r.x, r.y, r.w, r.h, 7);
  c.stroke();
  c.fillStyle = fg;
  c.font = "bold 13px 'MulmaruMono', ui-monospace, monospace";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  c.textAlign = "left";
}

// ── Effects (microanimations) ─────────────────────────────────────────────────

function addEffect(kind: Effect["kind"], x: number, y: number, value?: number): void {
  effects.push({ kind, x, y, start: store.now, value });
}

function drawEffects(c: CanvasRenderingContext2D, _L: BandLayout): void {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const dur = e.kind === "coin" ? 700 : e.kind === "pop" ? 320 : 240;
    const t = (store.now - e.start) / dur;
    if (t >= 1) {
      effects.splice(i, 1);
      continue;
    }
    if (e.kind === "coin") {
      c.globalAlpha = 1 - t;
      c.fillStyle = "#f4c94e";
      c.font = "bold 13px 'MulmaruMono', ui-monospace, monospace";
      c.textAlign = "center";
      c.strokeStyle = "#2e2117";
      c.lineWidth = 3;
      const ty = e.y - 16 * t;
      c.strokeText(`+${e.value}`, e.x, ty);
      c.fillText(`+${e.value}`, e.x, ty);
      c.globalAlpha = 1;
      c.textAlign = "left";
    } else if (e.kind === "pop") {
      c.globalAlpha = 1 - t;
      c.fillStyle = "#a8db66";
      const r = 6 + t * 12;
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + t;
        c.fillRect(e.x + Math.cos(ang) * r, e.y + Math.sin(ang) * r, 3, 3);
      }
      c.globalAlpha = 1;
    } else {
      c.globalAlpha = (1 - t) * 0.7;
      c.fillStyle = "#7a5230";
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        c.fillRect(e.x + Math.cos(ang) * (4 + t * 6), e.y - t * 6, 2, 2);
      }
      c.globalAlpha = 1;
    }
  }
}

// ── Cosmetics (band theme background + farm decor) ───────────────────────────────
// The actual art lives in render/{theme,decorArt}.ts behind a geometry-agnostic CosmeticScene,
// so the same drawing also powers the friend/ranking preview thumbnails (render/farmPreview.ts).

function sceneFrom(c: CanvasRenderingContext2D, L: BandLayout): CosmeticScene {
  return {
    ctx: c,
    bandX: 0,
    bandY: L.bandY,
    bandW: L.W,
    bandH: L.bandH,
    soilY: L.soilY,
    rowX0: L.slotSpan.x0,
    rowX1: L.slotSpan.x1,
    scale: L.scale,
    nowMs: store.now,
    hoverT: hudT,
    dock: L.dock,
  };
}

/** Theme background — drawn BEHIND the soil. `themeId` is the farm owner's theme. */
function drawThemeBg(c: CanvasRenderingContext2D, L: BandLayout, themeId: string | undefined): void {
  drawTheme(themeId || "theme_day", sceneFrom(c, L));
}

/** Farm decor — drawn ON TOP of the soil. `decorId` is the farm owner's decor. */
function drawDecor(c: CanvasRenderingContext2D, L: BandLayout, decorId: string | undefined): void {
  drawDecorById(decorId || "decor_none", sceneFrom(c, L));
}

// ── Toast ──────────────────────────────────────────────────────────────────

function drawToast(c: CanvasRenderingContext2D, L: BandLayout): void {
  const text = currentToast(store.now);
  if (!text) return;
  c.font = "bold 12px 'MulmaruMono', ui-monospace, monospace";
  const w = c.measureText(text).width + 24;
  const x = clamp(L.W / 2 - w / 2, 4, L.W - w - 4);
  let y = L.dock === "bottom" ? L.bandY - HUD_H - 26 : L.bandY + L.bandH + HUD_H + 6;
  y = clamp(y, 4, L.H - 26);
  c.fillStyle = "#f4e6c6";
  roundRect(c, x, y, w, 22, 8);
  c.fill();
  c.strokeStyle = "#6e4622";
  c.lineWidth = 2;
  roundRect(c, x, y, w, 22, 8);
  c.stroke();
  c.fillStyle = "#3a2a1a";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, x + w / 2, y + 11);
  c.textAlign = "left";
}

// ── Interaction ────────────────────────────────────────────────────────────────

function cssCoords(e: MouseEvent): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** The HUD chip id under (x,y) while the menu is rolled up, else null. */
function hudButtonAt(L: BandLayout, x: number, y: number): string | null {
  if (hudT <= 0.5) return null;
  for (const b of hudLayout(L).buttons) if (inRect(x, y, b.rect)) return b.id;
  return null;
}

function onClick(e: MouseEvent): void {
  if (store.hiddenFullscreen || !store.ready) return;
  const { x, y } = cssCoords(e);
  const L = layout();

  // Collapse tab — the little brown handle at the band's inner edge. Works whenever the farm (not a
  // raid) is on screen. When the menu is up, a click on a real chip goes to the chip, so the tab
  // sitting under the HUD's bottom edge never hijacks menu clicks.
  if (store.raid.role === "none" && inRect(x, y, collapseTabRect(L)) && !hudButtonAt(L, x, y)) {
    setCollapsed(!farmCollapsed);
    return;
  }
  if (isCollapsed()) return; // collapsed: only the tab is interactive; everything else fell through

  if (store.raid.role === "raiding") {
    if (inRect(x, y, actionButtonRect(L, "left"))) {
      void cancelRaid();
      return;
    }
    // Click a ripe crop to chip away at stealing it; click an empty slot to plant a weed.
    for (const s of L.slots) {
      if (Math.abs(x - s.cx) <= L.slotW / 2 && Math.abs(y - (L.soilY - L.maxCropPx / 2)) <= L.maxCropPx) {
        const key = String(s.i);
        const crop = store.raid.targetCrops?.[key];
        if (crop) {
          if (stageOf(crop.plantedAt, crop.tier, store.now) === "ripe") {
            addEffect("pop", s.cx, L.soilY - 12 * L.scale);
            void registerStealClick(key);
          }
        } else if (!store.raid.targetWeeds?.[key] && store.raid.targetUid) {
          addEffect("poof", s.cx, L.soilY);
          void plantWeed(store.raid.targetUid, s.i);
        }
        return;
      }
    }
    return;
  }
  if (store.raid.role === "defending") {
    // Click near an intruder's ghost cursor to land an eviction hit on the NEAREST one in range.
    const raiders = store.raid.raiders || {};
    let bestUid: string | null = null;
    let bestD: number = BALANCE.raidGame.evictHitRadius;
    let bx = 0;
    let by = 0;
    for (const uid of Object.keys(raiders)) {
      const g = raiders[uid].cursor;
      if (!g) continue;
      const gx = g.x * L.W;
      const gy = L.bandY + g.y * L.bandH;
      const d = Math.hypot(x - gx, y - gy);
      if (d <= bestD) {
        bestD = d;
        bestUid = uid;
        bx = gx;
        by = gy;
      }
    }
    if (bestUid) {
      addEffect("pop", bx, by);
      registerEvictClick(bestUid, true);
    }
    return;
  }

  // HUD buttons (only when rolled up)
  if (hudT > 0.5) {
    const hud = hudLayout(L);
    for (const b of hud.buttons) {
      if (inRect(x, y, b.rect)) {
        handleButton(b.id);
        return;
      }
    }
  }
  // crop slots — match nearest slot column
  for (const s of L.slots) {
    if (Math.abs(x - s.cx) <= L.slotW / 2 && Math.abs(y - (L.soilY - L.maxCropPx / 2)) <= L.maxCropPx) {
      void handleSlotClick(L, s);
      return;
    }
  }
}

function handleButton(id: string): void {
  // The 씨앗 chip opens the shop's seed list (pick directly) instead of cycling one-by-one through
  // all tiers — the chip's colour dot still shows which seed is currently selected.
  if (id === "seed") {
    togglePanel("shop");
    return;
  }
  togglePanel(id as PanelKind);
}

async function handleSlotClick(L: BandLayout, s: Slot): Promise<void> {
  const uid = store.uid;
  const key = String(s.i);

  // A raider-planted weed blocks the slot — click it removeClicks times to pull it.
  if (store.weeds[key]) {
    const need = BALANCE.weed.removeClicks;
    const n = (weedPullClicks[key] ?? 0) + 1;
    addEffect("pop", s.cx, L.soilY - 6 * L.scale);
    if (n >= need) {
      delete weedPullClicks[key];
      await removeWeed(s.i);
      addEffect("poof", s.cx, L.soilY);
      toast("잡초를 뽑았어요! 🌿");
    } else {
      weedPullClicks[key] = n;
      toast(`잡초 뽑는 중… ${need - n}번 더!`);
    }
    return;
  }

  const crop = store.crops[key];
  if (!crop) {
    const ok = await plant(uid, s.i, store.selectedSeedTier);
    if (ok) addEffect("poof", s.cx, L.soilY);
    return;
  }
  const st = stageOf(crop.plantedAt, crop.tier, store.now);
  if (st === "ripe") {
    const topY = L.soilY - 12 * L.scale;
    const v = await harvest(uid, s.i);
    if (v > 0) {
      addEffect("pop", s.cx, topY);
      addEffect("coin", s.cx, topY - 4, v);
    }
  } else {
    toast(`자라는 중... ${fmtTime(msToRipe(crop.plantedAt, crop.tier, store.now))} 남음`);
  }
}

export function setupStripInteractions(): void {
  window.addEventListener("resize", () => {
    ensureCanvas();
    publishHitRegions();
  });
  void onStripHover((h) => {
    hovered = h;
    publishHitRegions();
  });

  // Secret toggle for the 점지 easter-egg chip: type "jumji" (점지) while the strip window has focus.
  // Gated to the one owner nickname and ignored while a text field is focused (so chat typing is
  // safe). Silent on purpose — the chip simply appears/disappears, leaving no on-screen trace.
  const SECRET = ["KeyJ", "KeyU", "KeyM", "KeyJ", "KeyI"];
  let buf: string[] = [];
  window.addEventListener("keydown", (e) => {
    if (store.user?.nickname !== "정충봉") return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    buf.push(e.code);
    if (buf.length > SECRET.length) buf.shift();
    if (buf.length === SECRET.length && SECRET.every((k, i) => buf[i] === k)) {
      buf = [];
      const isHidden = localStorage.getItem(SPY_HIDDEN_KEY) === "1";
      localStorage.setItem(SPY_HIDDEN_KEY, isHidden ? "0" : "1");
      if (!isHidden && store.ui.panel === "spy") togglePanel("spy"); // hiding → close it if open
      publishHitRegions();
    }
  });

  // first-run "wink" + discoverability hint
  winkStart = Date.now();
  toast("마우스를 올리면 메뉴가 나와요", 4000);
}

// ── Hit regions (published to Rust) ─────────────────────────────────────────────

/**
 * Occupied-pixel bounding box (CSS px) of a crop's CURRENT sprite in its slot. The sprite is a
 * 16-wide grid; we scan for the non-empty column/row extent so a thin sprout blocks a tiny box and
 * a fat pumpkin a wide one — clicks in the air around and between crops fall straight through.
 */
function cropHitRect(L: BandLayout, s: Slot, sp: Sprite): Rect | null {
  const sc = L.scale;
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (let y = 0; y < sp.rows.length; y++) {
    const row = sp.rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      if (x < minC) minC = x;
      if (x > maxC) maxC = x;
      if (y < minR) minR = y;
      if (y > maxR) maxR = y;
    }
  }
  if (maxC < 0) return null; // blank sprite (shouldn't happen)
  const n = sp.rows.length;
  const left = s.cx - (SPRITE_W / 2) * sc;
  const padX = 2; // a hair of slack for sway so edge pixels stay grabbable
  const padY = 3; // ditto for the ripe-crop bob
  const x0 = left + minC * sc - padX;
  const x1 = left + (maxC + 1) * sc + padX;
  // Rows draw from the base upward (bottom dock) or downward (top dock) — see drawCropSprite.
  const yA = L.dir < 0 ? L.soilY - (n - minR) * sc : L.soilY + (n - 1 - maxR) * sc;
  const yB = L.dir < 0 ? L.soilY - (n - (maxR + 1)) * sc : L.soilY + (n - minR) * sc;
  const top = Math.min(yA, yB) - padY;
  return { x: x0, y: top, w: x1 - x0, h: Math.abs(yB - yA) + padY * 2 };
}

/** A snug box around a weed (owner clicks it to pull), sized to the drawn stalks. */
function weedHitRect(L: BandLayout, s: Slot): Rect {
  const sc = L.scale;
  const w = 11 * sc;
  const h = 9 * sc + 4;
  const top = L.dir < 0 ? L.soilY - h : L.soilY;
  return { x: s.cx - w / 2, y: top, w, h };
}

/** The sprite a slot is currently drawing (null when empty), for the tight hit box. */
function slotSprite(s: Slot): Sprite | null {
  const crop = store.crops[String(s.i)];
  if (!crop) return null;
  return spriteFor(stageOf(crop.plantedAt, crop.tier, store.now), crop.tier);
}

export function publishHitRegions(): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const L = layout();
  const regions: NormRect[] = [];
  const push = (x: number, y: number, w: number, h: number): void => {
    regions.push({ x: x / W, y: y / H, w: w / W, h: h / H });
  };

  const cropTop = L.dir < 0 ? L.soilY - L.maxCropPx : L.bandY;
  const cropBot = L.dir < 0 ? L.bandY + L.bandH : L.soilY + L.maxCropPx;
  const y0 = Math.min(cropTop, cropBot);
  const h = Math.abs(cropBot - cropTop);

  const tab = collapseTabRect(L);

  if (isCollapsed()) {
    // Collapsed: only the little tab blocks clicks — the whole rest of the band falls through to
    // whatever's behind it (the point of the feature). The tab is how you bring the farm back.
    push(tab.x, tab.y, tab.w, tab.h);
  } else if (store.raid.role !== "none") {
    // full-width during a raid so the action button + every crop are always reachable
    push(0, y0, W, h);
  } else if (hudEngaged(L)) {
    // engaged (HUD up): the whole plot row + HUD bar capture clicks, so you can plant on empty
    // slots, harvest, and hit menu buttons exactly as before.
    const padX = 8;
    push(Math.max(0, L.slotSpan.x0 - padX), y0, L.slotSpan.x1 - L.slotSpan.x0 + padX * 2, h);
    const hud = hudLayout(L);
    const top = Math.min(hud.barYOpen, L.bandY);
    const bot = Math.max(hud.barYOpen + HUD_H, L.bandY + L.bandH);
    push(0, top, W, bot - top);
    push(tab.x, tab.y, tab.w, tab.h);
  } else {
    // AT REST: block ONLY the crops (pixel-tight to each sprite) + a thin soil strip. Everything
    // else — the tall empty air above the row, the gaps between crops — passes clicks through to
    // whatever's behind. The soil strip is the always-there "handle": grazing it rolls the HUD up
    // (which re-opens the full row above), and clicking it plants on that slot.
    for (const s of L.slots) {
      if (store.weeds[String(s.i)]) {
        const r = weedHitRect(L, s);
        push(r.x, r.y, r.w, r.h);
        continue;
      }
      const sp = slotSprite(s);
      if (!sp) continue;
      const r = cropHitRect(L, s, sp);
      if (r) push(r.x, r.y, r.w, r.h);
    }
    const soilH = 8; // thin, right at the taskbar edge — barely blocks, keeps summon+plant working
    const soilY = L.dir < 0 ? L.soilY - soilH + 2 : L.soilY - 2;
    push(Math.max(0, L.slotSpan.x0 - 4), soilY, L.slotSpan.x1 - L.slotSpan.x0 + 8, soilH);
    push(tab.x, tab.y, tab.w, tab.h);
  }

  const pr = getPanelRect();
  if (pr) push(pr.left, pr.top, pr.width, pr.height);

  const cp = getChatPopupRect();
  if (cp) push(cp.left, cp.top, cp.width, cp.height);

  const ln = getLootNoteRect();
  if (ln) push(ln.left, ln.top, ln.width, ln.height);

  void updateHitRegions(regions);
  lastHitSig = hitRegionSig(L);
}

// The tight per-crop boxes depend on live crop stages, so they drift as crops grow/are harvested
// while the strip just sits at rest (no hover event to trigger a republish). renderStrip calls this
// every frame; it re-publishes only when the region-affecting state actually changes (cheap string
// compare, no per-frame IPC).
let lastHitSig = "";
function hitRegionSig(L: BandLayout): string {
  if (isCollapsed()) return "collapsed";
  if (store.raid.role !== "none") return "raid";
  let s = hudEngaged(L) ? "H|" : "0|";
  for (const slot of L.slots) {
    const key = String(slot.i);
    if (store.weeds[key]) {
      s += "w";
      continue;
    }
    const crop = store.crops[key];
    if (!crop) {
      s += ".";
      continue;
    }
    s += stageOf(crop.plantedAt, crop.tier, store.now) + crop.tier + ",";
  }
  return s;
}
function maybeRepublishHitRegions(L: BandLayout): void {
  if (hitRegionSig(L) !== lastHitSig) publishHitRegions();
}

// ── helpers ────────────────────────────────────────────────────────────────────

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function drawWoodButton(c: CanvasRenderingContext2D, r: Rect, active: boolean): void {
  c.fillStyle = active ? "#e8c98a" : "#caa15e";
  roundRect(c, r.x, r.y, r.w, r.h, 4);
  c.fill();
  c.fillStyle = "rgba(255,240,210,0.6)";
  c.fillRect(r.x + 2, r.y + 1, r.w - 4, 1); // top highlight
  c.fillStyle = "rgba(110,70,34,0.6)";
  c.fillRect(r.x + 2, r.y + r.h - 2, r.w - 4, 1); // bottom shade
  c.lineWidth = 1.5;
  c.strokeStyle = "#4a3115";
  roundRect(c, r.x, r.y, r.w, r.h, 4);
  c.stroke();
}

function fmtTime(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  return `${m}분 ${s % 60}초`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function lighten(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(clampByte(r + 255 * amt), clampByte(g + 255 * amt), clampByte(b + 255 * amt));
}
function darken(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(clampByte(r - 255 * amt), clampByte(g - 255 * amt), clampByte(b - 255 * amt));
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
