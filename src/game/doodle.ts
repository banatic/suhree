// 낙서(doodle) — the hand-drawn art players leave for each other: the small card a raider stamps
// onto the weeds they planted, and the big shared 낙서장 everyone scribbles on together.
//
// Storage is a compact STRING, not an image. Weed records sit inside the plot node that the strip
// and every co-raider re-read constantly, so a data-URL PNG (like chat images) would bloat every
// single plot read. Instead each point is quantised to a lattice and encoded as base64url
// characters, strokes separated by ".". A busy doodle costs about a kilobyte of plain text — cheap
// enough to ride along with the record and to cap in a security rule.

import { BALANCE } from "../config/balance";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i]] = i;

/**
 * The grid a drawing's points are snapped to before encoding. `wide` picks the character cost per
 * coordinate: one char covers 0..63, two cover 0..4095. The card is small enough for one; the 낙서장
 * is several times wider, and at 64 steps across it a straight line would visibly staircase.
 *
 * A lattice is NOT stored with the art — every reader already knows which surface it is reading.
 */
export interface Lattice {
  w: number;
  h: number;
  wide: boolean;
}

/** The weed card: square, one char per coordinate. */
export const CARD: Lattice = { w: 64, h: 64, wide: false };

/** A farm's 낙서장: wide, two chars per coordinate. */
export const BOARD: Lattice = { w: BALANCE.doodle.board.w, h: BALANCE.doodle.board.h, wide: true };

/** One pen-down..pen-up run, in lattice coordinates. A 1-point stroke is a dot. */
export type Stroke = { x: number; y: number }[];

function enc(v: number, max: number, wide: boolean): string {
  const n = Math.max(0, Math.min(max - 1, Math.round(v)));
  return wide ? ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63] : ALPHABET[n];
}

/** Strokes (lattice coords) → the stored string. Empty/blank input encodes to "". */
export function encodeStrokes(strokes: Stroke[], lat: Lattice): string {
  const parts: string[] = [];
  for (const st of strokes) {
    if (!st.length) continue;
    let s = "";
    for (const p of st) s += enc(p.x, lat.w, lat.wide) + enc(p.y, lat.h, lat.wide);
    parts.push(s);
  }
  return parts.join(".");
}

/** The stored string → strokes. Defensive: this parses UNTRUSTED data written by another player,
 *  so anything malformed (odd length, stray characters, over-long) yields fewer/no strokes rather
 *  than throwing into the middle of a canvas frame. */
export function decodeStrokes(art: string | undefined | null, lat: Lattice): Stroke[] {
  const cap = Math.max(BALANCE.doodle.maxLen, BALANCE.doodle.board.maxLen);
  if (!art || typeof art !== "string" || art.length > cap) return [];
  const step = lat.wide ? 2 : 1;
  const pt = step * 2;
  const val = (chunk: string, i: number): number | undefined => {
    const a = INDEX[chunk[i]];
    if (a === undefined) return undefined;
    if (!lat.wide) return a;
    const b = INDEX[chunk[i + 1]];
    return b === undefined ? undefined : (a << 6) | b;
  };
  const out: Stroke[] = [];
  for (const chunk of art.split(".")) {
    const st: Stroke = [];
    for (let i = 0; i + pt <= chunk.length; i += pt) {
      const x = val(chunk, i);
      const y = val(chunk, i + step);
      if (x === undefined || y === undefined) return out; // garbage — keep what parsed cleanly
      st.push({ x, y });
    }
    if (st.length) out.push(st);
  }
  return out;
}

/** Exact encoded length of `strokes` without building the string — two chars per coordinate at
 *  most, plus one "." between strokes. Callers check this per point while drawing, so re-encoding
 *  on every pointermove (quadratic over a long scribble) is not an option. */
export function encodedLength(strokes: Stroke[], lat: Lattice): number {
  const per = lat.wide ? 4 : 2;
  let n = 0;
  for (const st of strokes) n += st.length * per;
  return n + Math.max(0, strokes.length - 1);
}

/** Characters one more point costs, and one more stroke (its separator included). */
export function pointCost(lat: Lattice): number {
  return lat.wide ? 4 : 2;
}

/** Paint strokes into the w×h box whose top-left is (x, y). */
export function drawStrokes(
  c: CanvasRenderingContext2D,
  strokes: Stroke[],
  lat: Lattice,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  lineWidth: number,
): void {
  if (!strokes.length) return;
  const kx = w / (lat.w - 1);
  const ky = h / (lat.h - 1);
  c.save();
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = lineWidth;
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const st of strokes) {
    if (st.length === 1) {
      // A tap with no drag — draw the dot the user clearly meant, not an empty path.
      c.beginPath();
      c.arc(x + st[0].x * kx, y + st[0].y * ky, lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    c.beginPath();
    c.moveTo(x + st[0].x * kx, y + st[0].y * ky);
    for (let i = 1; i < st.length; i++) c.lineTo(x + st[i].x * kx, y + st[i].y * ky);
    c.stroke();
  }
  c.restore();
}

// ── Weed card helpers (square lattice, the common case) ───────────────────────

export const GRID = CARD.w;

export function encodeDoodle(strokes: Stroke[]): string {
  return encodeStrokes(strokes, CARD);
}

export function decodeDoodle(art: string | undefined | null): Stroke[] {
  return decodeStrokes(art, CARD);
}

/** Does this string hold anything worth drawing? */
export function hasDoodle(art: string | undefined | null): boolean {
  return decodeDoodle(art).length > 0;
}

/** Paint a weed card's doodle into the `size`×`size` box whose top-left is (x, y). */
export function drawDoodle(
  c: CanvasRenderingContext2D,
  art: string | undefined | null,
  x: number,
  y: number,
  size: number,
  color = "#3a2a17",
  lineWidth = 2,
): void {
  drawStrokes(c, decodeDoodle(art), CARD, x, y, size, size, color, lineWidth);
}

// ── Author colours ────────────────────────────────────────────────────────────

/** A stable ink colour per player, so a shared 낙서장 reads as several hands rather than one. */
export function inkColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 62%, 34%)`;
}
