// 낙서(doodle) — the hand-drawn card a raider leaves behind, replacing the old text 쪽지. The art
// rides on the WEED record (plots/$uid/weeds/$slot/art), so it reaches the victim through the same
// grief the raider already committed: hover the weed, see what they drew.
//
// Storage is a compact STRING, not an image. Weed records sit inside the plot node that the strip
// and every co-raider re-read constantly, so a data-URL PNG (like chat images) would bloat every
// single plot read. Instead each point is quantised to a `grid`×`grid` cell and encoded as two
// base64url characters, strokes separated by ".". A busy doodle of ~600 points costs ~1.2 KB of
// plain text — cheap enough to ride along with the weed and to cap in a security rule.

import { BALANCE } from "../config/balance";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i]] = i;

/** Grid resolution both axes are quantised to. 64 = exactly one base64url char per coordinate. */
export const GRID = BALANCE.doodle.grid;

/** One pen-down..pen-up run, in grid coordinates (0..GRID-1). A 1-point stroke is a dot. */
export type Stroke = { x: number; y: number }[];

function clampCell(v: number): number {
  return Math.max(0, Math.min(GRID - 1, Math.round(v)));
}

/** Strokes (grid coords) → the stored string. Empty/blank input encodes to "". */
export function encodeDoodle(strokes: Stroke[]): string {
  const parts: string[] = [];
  for (const st of strokes) {
    if (!st.length) continue;
    let s = "";
    for (const p of st) s += ALPHABET[clampCell(p.x)] + ALPHABET[clampCell(p.y)];
    parts.push(s);
  }
  return parts.join(".");
}

/** The stored string → strokes. Defensive: this parses UNTRUSTED data written by another player,
 *  so anything malformed (odd length, stray characters, over-long) yields fewer/no strokes rather
 *  than throwing into the middle of a canvas frame. */
export function decodeDoodle(art: string | undefined | null): Stroke[] {
  if (!art || typeof art !== "string" || art.length > BALANCE.doodle.maxLen) return [];
  const out: Stroke[] = [];
  for (const chunk of art.split(".")) {
    const st: Stroke = [];
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const x = INDEX[chunk[i]];
      const y = INDEX[chunk[i + 1]];
      if (x === undefined || y === undefined) return out; // garbage — keep what parsed cleanly
      st.push({ x, y });
    }
    if (st.length) out.push(st);
  }
  return out;
}

/** Does this string hold anything worth drawing? */
export function hasDoodle(art: string | undefined | null): boolean {
  return decodeDoodle(art).length > 0;
}

/** Paint a doodle into the `size`×`size` box whose top-left is (x, y). */
export function drawDoodle(
  c: CanvasRenderingContext2D,
  art: string | undefined | null,
  x: number,
  y: number,
  size: number,
  color = "#3a2a17",
  lineWidth = 2,
): void {
  const strokes = decodeDoodle(art);
  if (!strokes.length) return;
  const k = size / (GRID - 1);
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
      c.arc(x + st[0].x * k, y + st[0].y * k, lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    c.beginPath();
    c.moveTo(x + st[0].x * k, y + st[0].y * k);
    for (let i = 1; i < st.length; i++) c.lineTo(x + st[i].x * k, y + st[i].y * k);
    c.stroke();
  }
  c.restore();
}
