// Band BACKGROUND themes — the translucent "sky" painted behind the soil, keyed by theme id
// (see BALANCE.cosmetics.themes). Called every frame BEFORE the soil is drawn, so keep it cheap:
// fixed small counts, no per-frame allocations inside loops, all motion driven by s.nowMs.
//
// This is a TRANSPARENT desktop overlay — never paint an opaque wall. Each theme lays a MODEST
// tint (peak alpha ~0.35–0.7) over the sky region only, so the user's desktop still reads through.
import type { CosmeticScene } from "./cosmeticScene";

// Aurora ribbon colours hoisted to module scope so the animated path build allocates nothing.
const AURORA_COLORS = ["rgba(70,220,150,0.18)", "rgba(90,210,220,0.16)", "rgba(150,230,170,0.14)"];

/** Direction from the soil line toward the open sky: -1 = sky is ABOVE the soil (band docked at
 *  the bottom), +1 = sky is BELOW it (docked at the top). The sky fills band-edge → soilY. */
function skyDir(s: CosmeticScene): -1 | 1 {
  return s.dock === "bottom" ? -1 : 1;
}

/** Cheap deterministic [0,1) hash — scatters stars/flakes without storing any arrays. */
function rnd(i: number): number {
  const x = Math.sin(i * 127.1 + 9.7) * 43758.5453;
  return x - Math.floor(x);
}

export function drawTheme(themeId: string, s: CosmeticScene): void {
  // theme_day is the DEFAULT / current look → draw nothing so the desktop shows through unchanged.
  if (!themeId || themeId === "theme_day") return;

  const up = skyDir(s);
  // Sky region = between the band edge AWAY from the soil (zenith) and the soil line (horizon).
  const far = up < 0 ? s.bandY : s.bandY + s.bandH; // zenith, on the screen-edge side
  const near = s.soilY; // horizon, at the soil
  if (Math.abs(near - far) <= 0) return;

  s.ctx.save(); // never leak globalAlpha / fillStyle to later draws
  switch (themeId) {
    case "theme_sunset":
      drawSunset(s, far, near);
      break;
    case "theme_night":
      drawNight(s, far, near);
      break;
    case "theme_snow":
      drawSnow(s, far, near);
      break;
    case "theme_aurora":
      drawAurora(s, far, near);
      break;
    // unknown / missing id → nothing
  }
  s.ctx.restore();
}

// ── Themes ───────────────────────────────────────────────────────────────────

// Warm dusk: peach (horizon) → orange → soft magenta (zenith), a gentle tint over the sky.
function drawSunset(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const g = ctx.createLinearGradient(0, far, 0, near);
  g.addColorStop(0, "rgba(168,86,140,0.42)"); // soft magenta (zenith)
  g.addColorStop(0.5, "rgba(232,120,70,0.46)"); // orange
  g.addColorStop(1, "rgba(255,196,140,0.5)"); // peach (horizon)
  ctx.fillStyle = g;
  ctx.fillRect(s.bandX, Math.min(far, near), s.bandW, Math.abs(near - far));
}

// Clear night: deep navy → indigo gradient + ~8 small twinkling stars in the sky region.
function drawNight(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const y0 = Math.min(far, near);
  const h = Math.abs(near - far);
  const g = ctx.createLinearGradient(0, far, 0, near);
  g.addColorStop(0, "rgba(14,18,46,0.6)"); // deep navy zenith
  g.addColorStop(1, "rgba(38,34,72,0.45)"); // indigo horizon
  ctx.fillStyle = g;
  ctx.fillRect(s.bandX, y0, s.bandW, h);

  const sz = Math.max(1, s.scale);
  ctx.fillStyle = "#fdf6d8";
  for (let i = 0; i < 8; i++) {
    const x = s.bandX + rnd(i) * s.bandW;
    const y = y0 + (0.1 + 0.7 * rnd(i + 50)) * h; // keep stars inside the sky band
    ctx.globalAlpha = 0.4 + 0.55 * (0.5 + 0.5 * Math.sin(s.nowMs / 600 + i * 1.7)); // twinkle
    ctx.fillRect(x, y, sz, sz);
  }
}

// Snowy night: dark blue gradient + ~14 white flakes drifting DOWN across the whole band, looping.
function drawSnow(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const g = ctx.createLinearGradient(0, far, 0, near);
  g.addColorStop(0, "rgba(18,28,58,0.55)"); // dark blue
  g.addColorStop(1, "rgba(40,54,92,0.4)");
  ctx.fillStyle = g;
  ctx.fillRect(s.bandX, Math.min(far, near), s.bandW, Math.abs(near - far));

  const sz = Math.max(1, 1.5 * s.scale);
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 14; i++) {
    const speed = 0.012 + 0.02 * rnd(i + 7); // px per ms
    const fall = (rnd(i) * s.bandH + s.nowMs * speed) % s.bandH; // 0..bandH, loops via modulo
    const y = s.bandY + fall; // "down" = increasing y, spanning the full band
    const sway = Math.sin(s.nowMs / 700 + i) * 3 * s.scale;
    const x = s.bandX + ((rnd(i + 30) * s.bandW + sway) % s.bandW + s.bandW) % s.bandW;
    ctx.globalAlpha = 0.5 + 0.4 * rnd(i + 99);
    ctx.fillRect(x, y, sz, sz);
  }
}

// Aurora (legendary): dark base + 3 wavy green/teal ribbons undulating horizontally, low alpha so
// overlaps read as an additive glow.
function drawAurora(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const y0 = Math.min(far, near);
  const h = Math.abs(near - far);
  ctx.fillStyle = "rgba(8,16,28,0.5)"; // dark base wash
  ctx.fillRect(s.bandX, y0, s.bandW, h);

  const step = Math.max(8, 12 * s.scale); // path resolution; coarser = cheaper
  const x1 = s.bandX + s.bandW;
  for (let b = 0; b < AURORA_COLORS.length; b++) {
    const baseY = y0 + h * (0.25 + b * 0.22); // stagger the three ribbons down the sky
    const amp = h * 0.16;
    const thick = Math.max(3, 4 * s.scale);
    const ph = s.nowMs / (900 + b * 350) + b * 2; // each drifts at its own pace
    ctx.fillStyle = AURORA_COLORS[b];
    ctx.beginPath();
    ctx.moveTo(s.bandX, baseY + Math.sin(s.bandX / 40 + ph) * amp);
    for (let x = s.bandX + step; x <= x1; x += step) {
      ctx.lineTo(x, baseY + Math.sin(x / 40 + ph) * amp); // top sine edge
    }
    for (let x = x1; x >= s.bandX; x -= step) {
      ctx.lineTo(x, baseY + Math.sin(x / 40 + ph) * amp + thick); // bottom edge → thin ribbon
    }
    ctx.closePath();
    ctx.fill();
  }
}
