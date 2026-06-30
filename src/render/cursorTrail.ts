// Cursor trail — a tiny pixel-particle wake that follows a cursor. Each Trail instance owns its own
// particle buffer, so the raid ghost, your own hover cursor, and the shop preview never mix. Pixel
// squares (not blurred sprites) keep it consistent with the rest of the band art.
//
// Usage per frame: emit(x, y, style, now, dir) to spawn at the cursor, then step(ctx, now) to age +
// draw. Emitting is throttled internally; step always runs so particles keep fading after you stop.

import type { TrailStyle } from "./cursorArt";

interface Particle {
  x: number;
  y: number;
  vx: number; // px per ms
  vy: number;
  born: number;
  life: number;
  sz: number;
  col: string;
  kind: string;
}

export interface Trail {
  emit(x: number, y: number, style: TrailStyle, now: number, dir: number): void;
  step(ctx: CanvasRenderingContext2D, now: number): void;
  reset(): void;
}

const EMIT_INTERVAL_MS = 22;

function pick(cols: string[]): string {
  return cols.length ? cols[Math.floor(Math.random() * cols.length)] : "#ffffff";
}

function spawn(x: number, y: number, style: TrailStyle, now: number, dir: number): Particle {
  const up = dir; // band "up" (away from soil): bottom-dock dir=-1 → screen-up is negative y
  const jitter = (m: number): number => (Math.random() - 0.5) * m;
  let vx = jitter(0.05);
  let vy = up * 0.02;
  let sz = style.size;
  let col: string;

  switch (style.kind) {
    case "fire":
      vx = jitter(0.04);
      vy = up * 0.045;
      sz = style.size + Math.random();
      col = pick(style.colors);
      break;
    case "smoke":
      vx = jitter(0.05);
      vy = up * 0.03;
      col = pick(style.colors);
      break;
    case "petal":
      vx = jitter(0.03);
      vy = -up * 0.012; // drifts back down toward the soil
      col = pick(style.colors);
      break;
    case "dust":
      vx = jitter(0.06);
      vy = up * 0.012;
      col = pick(style.colors);
      break;
    case "rainbow":
      vy = up * 0.02;
      col = `hsl(${Math.floor((now / 4) % 360)} 90% 60%)`;
      break;
    case "sparkle":
    default:
      col = pick(style.colors);
      break;
  }
  return {
    x: x + jitter(3),
    y: y + jitter(3),
    vx,
    vy,
    born: now,
    life: style.life,
    sz,
    col,
    kind: style.kind,
  };
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, now: number): void {
  const age = now - p.born;
  const t = age / p.life;
  let a = 1 - t;
  let sz = p.sz;
  let px = p.x + p.vx * age;
  const py = p.y + p.vy * age;

  if (p.kind === "sparkle") a *= 0.5 + 0.5 * Math.abs(Math.sin(now / 90 + p.born));
  else if (p.kind === "petal") px += Math.sin(age / 120 + p.born) * 4;
  else if (p.kind === "fire") sz = p.sz * (1 - t) + 0.5; // shrinks as it cools
  else if (p.kind === "smoke") {
    sz = p.sz * (1 + t * 1.5); // puffs outward
    a *= 0.5;
  } else if (p.kind === "dust") a *= 0.7;

  ctx.globalAlpha = Math.max(0, a);
  ctx.fillStyle = p.col;
  const s = Math.max(1, Math.round(sz));
  ctx.fillRect(Math.round(px), Math.round(py), s, s);
  ctx.globalAlpha = 1;
}

/** Make a fresh, independent trail emitter. */
export function createTrail(max = 60): Trail {
  const parts: Particle[] = [];
  let lastEmit = 0;
  return {
    emit(x, y, style, now, dir) {
      if (style.kind === "none") return;
      if (now - lastEmit < EMIT_INTERVAL_MS) return;
      lastEmit = now;
      const n = Math.max(1, Math.round(style.rate));
      for (let i = 0; i < n; i++) parts.push(spawn(x, y, style, now, dir));
      if (parts.length > max) parts.splice(0, parts.length - max);
    },
    step(ctx, now) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (now - p.born >= p.life) {
          parts.splice(i, 1);
          continue;
        }
        drawParticle(ctx, p, now);
      }
    },
    reset() {
      parts.length = 0;
      lastEmit = 0;
    },
  };
}
