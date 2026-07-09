// Cursor cosmetics — each equippable cursor is a SHAPE (pixel sprite) + a TRAIL style. The shape is
// what the opponent sees in place of the plain ghost arrow during a raid; the trail is the fading
// particle wake behind it (drawn by render/cursorTrail.ts). Keyed by the cosmetic id from
// config/balance.ts (cosmetics.cursors) — an id without an entry here just falls back to default.

import { GHOST_CURSOR, type Sprite } from "./sprites";

export type TrailKind = "none" | "sparkle" | "fire" | "rainbow" | "petal" | "dust" | "smoke";

export interface TrailStyle {
  kind: TrailKind;
  colors: string[]; // particle palette (ignored for rainbow, which cycles hue)
  rate: number; // particles spawned per emit tick
  life: number; // particle lifetime (ms)
  size: number; // base particle size (px)
}

export interface CursorSkin {
  sprite: Sprite;
  overrides?: Record<string, string>; // per-char palette overrides for the sprite
  trail: TrailStyle;
}

const NO_TRAIL: TrailStyle = { kind: "none", colors: [], rate: 0, life: 0, size: 0 };

const PAW: Sprite = {
  rows: [
    ".oo.oo.oo.oo.",
    "oAooAooAooAoo",
    "opooPooPooPoo",
    ".oo.oo.oo.oo.",
    "...oooooo...",
    "..oPPPPPPo..",
    ".oPPPPPPPPo.",
    ".oPPPPPPPPo.",
    "..oPPPPPPo..",
    "...oooooo..."
  ],
};

const HEART: Sprite = {
  rows: [
    "..ooo...ooo..",
    ".oHhho.oHhho.",
    "oHHHHHoHHHHHo",
    "oHHHHHHHHHHHo",
    "oHHHHHHHHHHHo",
    ".oHHHHHHHHHo.",
    "..oHHHHHHHo..",
    "...oHHHHHo...",
    "....oHHHo....",
    ".....oHo.....",
    "......o......"
  ],
};

const STAR: Sprite = {
  rows: [
    "....o....",
    "....y....",
    "...yYy...",
    "o.yYYYy.o",
    ".yYYwYYy.",
    "o.yYYYy.o",
    "...yYy...",
    "....y....",
    "....o...."
  ],
};

const FLAME: Sprite = {
  rows: [
    "....y....",
    "...yry...",
    "...yry...",
    "..yrRry..",
    "..yrRry..",
    ".yrRRRry.",
    ".yRRRRRy.",
    ".oRRRRRo.",
    "..oRRRo..",
    "...ooo..."
  ],
};

const GLOVE: Sprite = {
  rows: [
    ".k.k.k...",
    "kkkkkkk..",
    "kkkkkkkk.",
    "kkkkkkkk.",
    ".kkkkkkk.",
    ".kkkkkkk.",
    ".wkkkkkw.",
    ".wwwwwww.",
    "..wwwww.."
  ],
};

const GHOST: Sprite = {
  rows: [
    "...oooo...",
    "..oWWWwo..",
    ".oWWWWwWo.",
    ".oWbWWbWo.",
    "oWWWWWWWWo",
    "oWWwWWwWWo",
    "oWWWWWWWWo",
    "oWWWWWWWWo",
    "oWoWoWoWoW",
    ".o.o.o.o.o"
  ],
};

const BUNNY: Sprite = {
  rows: [
    ".oo...oo.",
    "oPPo.oPPo",
    "oPPo.oPPo",
    "oPPo.oPPo",
    ".oooooooo.",
    "oWWWWWWWWo",
    "oWbWWWWbWo",
    "oWWWpWWWWo",
    ".oWWWWWWo.",
    "..oooooo.."
  ],
};

const PINK = { A: "#ffd0e0", p: "#ff7faf", P: "#ff9ec4", H: "#ff5f95", h: "#ffd0e0" };
const GHOST_COL = { W: "#f8f9fa", w: "#e9ecef", b: "#343a40" };
const BUNNY_COL = { W: "#fff0f5", b: "#495057", p: "#ffb6c1", P: "#ffc0cb" };

export const CURSOR_SKINS: Record<string, CursorSkin> = {
  cursor_default: { sprite: GHOST_CURSOR, trail: NO_TRAIL },
  cursor_paw: {
    sprite: PAW,
    overrides: PINK,
    trail: { kind: "dust", colors: ["#cbb89a", "#a98f66", "#e0d2b4"], rate: 1, life: 420, size: 2 },
  },
  cursor_heart: {
    sprite: HEART,
    overrides: PINK,
    trail: { kind: "petal", colors: ["#ff8fb8", "#ffd0e0", "#ff5f95"], rate: 1, life: 900, size: 2 },
  },
  cursor_sparkle: {
    sprite: STAR,
    trail: { kind: "sparkle", colors: ["#fff6c8", "#ffe27a", "#fffefb"], rate: 1, life: 700, size: 2 },
  },
  cursor_flame: {
    sprite: FLAME,
    trail: { kind: "fire", colors: ["#ffe23a", "#ff9a2e", "#e2452a"], rate: 2, life: 600, size: 2 },
  },
  cursor_bandit: {
    sprite: GLOVE,
    trail: { kind: "smoke", colors: ["#5a5040", "#3a342a", "#7a7060"], rate: 1, life: 850, size: 2 },
  },
  cursor_rainbow: {
    sprite: GHOST_CURSOR,
    overrides: { w: "#ffffff" },
    trail: { kind: "rainbow", colors: [], rate: 2, life: 800, size: 2 },
  },
  cursor_ghost: {
    sprite: GHOST,
    overrides: GHOST_COL,
    trail: { kind: "sparkle", colors: ["#cba6f7", "#f5c2e7", "#b4befe"], rate: 1, life: 800, size: 2 },
  },
  cursor_bunny: {
    sprite: BUNNY,
    overrides: BUNNY_COL,
    trail: { kind: "dust", colors: ["#fd7e14", "#ffc107", "#40c057"], rate: 1, life: 600, size: 2 },
  }
};

/** Resolve a cursor id to its skin, falling back to the plain default arrow. */
export function cursorSkin(id: string | undefined): CursorSkin {
  return CURSOR_SKINS[id ?? ""] ?? CURSOR_SKINS.cursor_default;
}
