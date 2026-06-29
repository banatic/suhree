// Original hand-authored pixel sprites (palette-indexed grids → canvas). 100% original art.
// Crops are VERTICAL: authored to grow upward, the last row is the base (anchored to soil).
// Tiers differ by SILHOUETTE (radish=short/round, wheat=tall/thin, pumpkin=wide/squat),
// not just colour. Fruit chars f/h/d are recoloured per tier at draw time.

export interface Sprite {
  rows: string[];
}

// Warm, cohesive palette (original). One universal outline so tiny sprites stay crisp.
export const PALETTE: Record<string, string> = {
  o: "#2e2117", // universal outline
  k: "#1c140d", // detail near-black (eyes)
  m: "#7a5230", // soil light
  M: "#5b3a21", // soil dark
  n: "#3f7a30", // stem / leaf dark
  e: "#6cb43f", // leaf mid
  l: "#a8db66", // leaf light
  b: "#9c6b38", // wood
  B: "#6e4622", // wood shade
  w: "#f6eedd", // parchment / cursor white
  y: "#f4c94e", // coin
  Y: "#c2912b", // coin shade
  r: "#e2573c", // alert
  R: "#a8311d", // alert dark
  s: "#dcc079", // straw
  S: "#b2924a", // straw shade
  // fruit (overridden per tier)
  f: "#e08a3c",
  h: "#f3b063",
  d: "#a65f24",
};

export const SPRITE_W = 16;

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sp: Sprite,
  dx: number,
  dy: number,
  scale: number,
  overrides?: Record<string, string>,
): void {
  const rows = sp.rows;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      const col = (overrides && overrides[ch]) || PALETTE[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(dx + x * scale, dy + y * scale, scale, scale);
    }
  }
}

/**
 * Draw a crop centred horizontally at `cx`, base anchored to `soilY`.
 * dir = -1 grows up (bottom-docked strip), +1 hangs down (top-docked).
 */
export function drawCropSprite(
  ctx: CanvasRenderingContext2D,
  sp: Sprite,
  cx: number,
  soilY: number,
  scale: number,
  dir: -1 | 1,
  overrides?: Record<string, string>,
  shearTop = 0,
): void {
  const rows = sp.rows;
  const n = rows.length;
  const left = cx - (SPRITE_W / 2) * scale;
  for (let y = 0; y < n; y++) {
    const row = rows[y];
    // sway: top of the plant moves most, base stays planted
    const fromBase = (n - 1 - y) / Math.max(1, n - 1); // 0 at base, 1 at top
    const sx = shearTop * fromBase;
    // up: base (row n-1) just above soil; top row highest
    const py = dir < 0 ? soilY - (n - y) * scale : soilY + (n - 1 - y) * scale;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      const col = (overrides && overrides[ch]) || PALETTE[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(left + x * scale + sx), py, scale, scale);
    }
  }
}

// ── Crop stages (16 wide; base = last row) ─────────────────────────────────────

export const SEED: Sprite = {
  rows: [
    "................",
    "................",
    "......oo........",
    ".....oMMo.......",
    "....oMmmMo......",
    ".....oooo.......",
  ],
};

export const SPROUT: Sprite = {
  rows: [
    "................",
    "......o.o.......",
    ".....olelo......",
    "....oleeelo.....",
    ".....oeneo......",
    "......ono.......",
    "......ono.......",
    "......ono.......",
    ".....ooooo......",
  ],
};

export const GROWING: Sprite = {
  rows: [
    "......o.o.......",
    ".....olelo......",
    "....oleeelo.....",
    "...oleeeeelo....",
    "....oleeelo.....",
    ".....oeneo......",
    "......ono.......",
    "...o..ono..o....",
    "..oleooonooelo..",
    "...oleononelo...",
    "....oeononeo....",
    ".....oono.......",
    "......ono.......",
    "......ono.......",
    "......ono.......",
    ".....ooooo......",
  ],
};

// T0 무/radish — short, round, low to the soil, leafy top.
export const RIPE_RADISH: Sprite = {
  rows: [
    "......o.o.......",
    ".....olelo......",
    "....oleeelo.....",
    ".....oeneo......",
    "......ono.......",
    "......ono.......",
    ".....offfo......",
    "....ofhffo......",
    "...offhfffo.....",
    "...offffffo.....",
    "...ofdfffdo.....",
    "....offddo......",
    ".....oddo.......",
    "......oo........",
  ],
};

// T1 밀/wheat — tall, thin stalk + grain head. The tallest, skinniest silhouette.
export const RIPE_WHEAT: Sprite = {
  rows: [
    "......o.........",
    ".....ofo........",
    "....ofhfo.......",
    "....offfo.......",
    "....ofhfo.......",
    "....offfo.......",
    "....ofhfo.......",
    "....offfo.......",
    "....ofdfo.......",
    ".....ono........",
    "....olono.......",
    ".....ono........",
    ".....ono........",
    ".....ono........",
    ".....ono........",
    "....onol........",
    ".....ono........",
    ".....ono........",
    ".....ono........",
    ".....ono........",
    ".....ono........",
    "....ooooo.......",
  ],
};

// T2 호박/pumpkin — wide, squat ribbed gourd, fat at the base.
export const RIPE_PUMPKIN: Sprite = {
  rows: [
    "......ono.......",
    "......ono.......",
    ".....olelo......",
    "....ooooooo.....",
    "...offhfhfo.....",
    "..offhffhffo....",
    "..offffffffo....",
    ".ofdffffffdfo...",
    ".offhffffhffo...",
    ".offffffffffo...",
    ".ofdffffffdfo...",
    "..offffffffo....",
    "..offdffdffo....",
    "...offffffo.....",
    "....oooooo......",
  ],
};

// ── Props ──────────────────────────────────────────────────────────────────

/** Thief "rummaging" paw — drawn over a crop while raiding. ('h' = tinted skin) */
export const PAW: Sprite = {
  rows: [
    "....k.k.k...",
    "...khkhkhk..",
    "...khhhhhk..",
    "..kkhhhhhk..",
    "..khhhhhhk..",
    "..khhhhhhk..",
    "...khhhhk...",
    "....kkkk....",
  ],
};

/** Owner's ghost cursor (classic arrow). */
export const GHOST_CURSOR: Sprite = {
  rows: [
    "o...........",
    "oo..........",
    "owo.........",
    "owwo........",
    "owwwo.......",
    "owwwwo......",
    "owwwwwo.....",
    "owwwwwwo....",
    "owwwwwwwo...",
    "owwwwoooo...",
    "owwowwo.....",
    "owo.owwo....",
    "oo..owwo....",
    "o....owwo...",
    ".....owwo...",
    "......oo....",
  ],
};

export const COIN: Sprite = {
  rows: [
    "..yyy..",
    ".yYYYy.",
    "yYyyyYy",
    "yYyyyYy",
    "yYyyyYy",
    ".yYYYy.",
    "..yyy..",
  ],
};

/** Little scarecrow guardian (shown on hover when scarecrowLv > 0). */
export const SCARECROW: Sprite = {
  rows: [
    "................",
    "......ooo.......",
    ".....ooooo......",
    "....ooooooo.....",
    ".....seses......",
    ".....sssss......",
    "..ooosssssooo...",
    ".....s.s.s......",
    ".....SsssS......",
    ".....s.s.s......",
    ".....s...s......",
    ".....s...s......",
    "....SS...SS.....",
    "................",
    "................",
    "................",
  ],
};
