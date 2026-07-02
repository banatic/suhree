// Band BACKGROUND themes — the translucent "sky" painted behind the soil, keyed by theme id
// (see BALANCE.cosmetics.themes). Called every frame BEFORE the soil is drawn, so keep it cheap:
// fixed small counts, no per-frame allocations inside loops, all motion driven by s.nowMs.
//
// This is a TRANSPARENT desktop overlay — never paint an opaque wall. Each theme lays a MODEST
// tint (peak alpha ~0.35–0.6) over the sky region only, so the user's desktop still reads through.
// A luminous accent (sun / moon / aurora) is drawn with "lighter" compositing so it glows without
// turning the sky opaque.
import type { CosmeticScene } from "./cosmeticScene";

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

/** Linear interpolate — used to place accents at a fraction between horizon and zenith. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function drawTheme(themeId: string, s: CosmeticScene): void {
  // theme_day is the DEFAULT / current look → draw nothing so the desktop shows through unchanged.
  if (!themeId || themeId === "theme_day") return;

  const up = skyDir(s);
  // Sky region = between the band edge AWAY from the soil (zenith) and the soil line (horizon).
  const far = up < 0 ? s.bandY : s.bandY + s.bandH; // zenith, on the screen-edge side
  const near = s.soilY; // horizon, at the soil
  if (Math.abs(near - far) <= 0) return;

  s.ctx.save(); // never leak globalAlpha / composite / fillStyle to later draws
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

// Warm dusk: magenta→orange→peach tint + soft cloud bands + a low sun with a glowing halo.
function drawSunset(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const y0 = Math.min(far, near);
  const h = Math.abs(near - far);
  const g = ctx.createLinearGradient(0, far, 0, near);
  g.addColorStop(0, "rgba(150,72,128,0.44)"); // soft magenta (zenith)
  g.addColorStop(0.45, "rgba(232,120,70,0.46)"); // orange
  g.addColorStop(0.8, "rgba(255,168,96,0.5)");
  g.addColorStop(1, "rgba(255,214,150,0.52)"); // peach (horizon)
  ctx.fillStyle = g;
  ctx.fillRect(s.bandX, y0, s.bandW, h);

  // soft cloud bands
  ctx.fillStyle = "rgba(150,74,96,0.16)";
  for (const cyf of [0.3, 0.55]) {
    const cy = y0 + h * cyf;
    ctx.beginPath();
    ctx.ellipse(s.bandX + s.bandW * 0.34, cy, s.bandW * 0.26, h * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.bandX + s.bandW * 0.7, cy + h * 0.05, s.bandW * 0.2, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // low sun + glowing halo (additive)
  const sunX = s.bandX + s.bandW * 0.5;
  const sunY = lerp(near, far, 0.32); // a third of the way up from the horizon
  const sunR = h * 0.42;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.6);
  sg.addColorStop(0, "rgba(255,240,196,0.7)");
  sg.addColorStop(0.3, "rgba(255,192,112,0.38)");
  sg.addColorStop(1, "rgba(255,150,90,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,246,214,0.85)";
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Clear night: deep navy → indigo gradient + a glowing moon + ~16 twinkling stars + a rare
// shooting star.
function drawNight(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const y0 = Math.min(far, near);
  const h = Math.abs(near - far);
  const g = ctx.createLinearGradient(0, far, 0, near);
  g.addColorStop(0, "rgba(10,14,40,0.62)"); // deep navy zenith
  g.addColorStop(1, "rgba(40,34,74,0.46)"); // indigo horizon
  ctx.fillStyle = g;
  ctx.fillRect(s.bandX, y0, s.bandW, h);

  // moon (top-right) with a soft halo
  const mx = s.bandX + s.bandW * 0.82;
  const my = y0 + h * 0.32;
  const mr = h * 0.2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.2);
  mg.addColorStop(0, "rgba(226,238,255,0.45)");
  mg.addColorStop(1, "rgba(200,220,255,0)");
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(240,246,255,0.92)";
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();

  // stars, varied sizes + twinkle
  for (let i = 0; i < 16; i++) {
    const x = s.bandX + rnd(i) * s.bandW;
    const y = y0 + (0.08 + 0.68 * rnd(i + 50)) * h; // keep stars inside the sky band
    ctx.globalAlpha = (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.nowMs / 500 + i * 1.7))) * 0.9;
    ctx.fillStyle = "#fdf6d8";
    const ss = rnd(i + 3) > 0.82 ? Math.max(1, 1.6 * s.scale) : Math.max(1, s.scale);
    ctx.fillRect(x, y, ss, ss);
  }
  ctx.globalAlpha = 1;

  // rare shooting star (a short streak every ~6.5s)
  const ph = (s.nowMs % 6500) / 6500;
  if (ph < 0.1) {
    const t = ph / 0.1;
    const sx = s.bandX + s.bandW * (0.2 + 0.45 * t);
    const sy = y0 + h * (0.18 + 0.12 * t);
    ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, s.scale * 0.8);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 9 * s.scale, sy - 4 * s.scale);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Snowy night: dark blue gradient + a soft moon glow + ~18 white flakes (varied sizes) drifting
// DOWN across the whole band, looping.
function drawSnow(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const y0 = Math.min(far, near);
  const h = Math.abs(near - far);
  const g = ctx.createLinearGradient(0, far, 0, near);
  g.addColorStop(0, "rgba(20,30,64,0.56)"); // dark blue
  g.addColorStop(1, "rgba(48,64,104,0.42)");
  ctx.fillStyle = g;
  ctx.fillRect(s.bandX, y0, s.bandW, h);

  // faint moon glow, top-left
  const mx = s.bandX + s.bandW * 0.15;
  const my = y0 + h * 0.3;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, h * 0.7);
  mg.addColorStop(0, "rgba(200,220,255,0.32)");
  mg.addColorStop(1, "rgba(200,220,255,0)");
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(mx, my, h * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 18; i++) {
    const speed = 0.01 + 0.02 * rnd(i + 7); // px per ms
    const fall = (rnd(i) * s.bandH + s.nowMs * speed) % s.bandH; // 0..bandH, loops via modulo
    const y = s.bandY + fall; // "down" = increasing y, spanning the full band
    const sway = Math.sin(s.nowMs / 700 + i) * 3 * s.scale;
    const x = s.bandX + (((rnd(i + 30) * s.bandW + sway) % s.bandW) + s.bandW) % s.bandW;
    ctx.globalAlpha = 0.5 + 0.45 * rnd(i + 99);
    const sz = rnd(i + 11) > 0.72 ? Math.max(2, 1.8 * s.scale) : Math.max(1, s.scale);
    ctx.fillRect(x, y, sz, sz);
  }
  ctx.globalAlpha = 1;
}

// Aurora (legendary): dark base + faint stars + smooth glowing multi-hue ribbons (green→teal→
// violet→pink) drawn with "lighter" so overlaps read as an additive glow, plus soft vertical
// light shafts riding each ribbon for the shimmering-curtain feel.
function drawAurora(s: CosmeticScene, far: number, near: number): void {
  const ctx = s.ctx;
  const zen = far;
  const hor = near;
  const h = Math.abs(near - far);
  const y0 = Math.min(far, near);

  // deep base wash
  const bg = ctx.createLinearGradient(0, far, 0, near);
  bg.addColorStop(0, "rgba(6,12,30,0.6)");
  bg.addColorStop(1, "rgba(12,20,42,0.4)");
  ctx.fillStyle = bg;
  ctx.fillRect(s.bandX, y0, s.bandW, h);

  // faint stars behind the ribbons
  ctx.fillStyle = "#dfeaff";
  for (let i = 0; i < 12; i++) {
    const x = s.bandX + rnd(i * 3 + 1) * s.bandW;
    const y = y0 + (0.05 + 0.5 * rnd(i * 3 + 2)) * h;
    ctx.globalAlpha = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(s.nowMs / 600 + i));
    const ss = Math.max(1, s.scale * 0.8);
    ctx.fillRect(x, y, ss, ss);
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const step = Math.max(5, 6 * s.scale); // path resolution; coarser = cheaper
  const x1 = s.bandX + s.bandW;
  const ribY = (base: number, amp: number, sp: number, x: number): number =>
    lerp(hor, zen, base) +
    (Math.sin(x / 70 + s.nowMs / sp) + 0.4 * Math.sin(x / 33 - (s.nowMs / sp) * 1.3)) * (h * amp);
  const passes: [number, number][] = [[2.6, 0.09], [1.6, 0.14], [1.0, 0.22]]; // wide-faint → bright core
  for (const rb of AURORA_RIBBONS) {
    const thick = h * rb.thick;
    for (const [wm, al] of passes) {
      const half = Math.max(1, (thick * wm) / 2);
      ctx.fillStyle = `rgba(${rb.r},${rb.g},${rb.b},${al})`;
      ctx.beginPath();
      let first = true;
      for (let x = s.bandX; x <= x1; x += step) {
        const yy = ribY(rb.base, rb.amp, rb.sp, x) + half;
        if (first) {
          ctx.moveTo(x, yy);
          first = false;
        } else ctx.lineTo(x, yy);
      }
      for (let x = x1; x >= s.bandX; x -= step) ctx.lineTo(x, ribY(rb.base, rb.amp, rb.sp, x) - half);
      ctx.closePath();
      ctx.fill();
    }
    // soft vertical light shafts riding the ribbon
    for (let k = 0; k < 2; k++) {
      const drift = (((k * 0.5 + s.nowMs / (9000 + rb.sp)) % 1) + 1) % 1;
      const sx = s.bandX + drift * s.bandW;
      const sy = ribY(rb.base, rb.amp, rb.sp, sx);
      const flick = 0.5 + 0.5 * Math.sin(s.nowMs / 300 + k * 2 + rb.base * 10);
      const shaftH = h * 0.55;
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, shaftH);
      rg.addColorStop(0, `rgba(${rb.r},${rb.g},${rb.b},${(0.18 * flick).toFixed(3)})`);
      rg.addColorStop(1, `rgba(${rb.r},${rb.g},${rb.b},0)`);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(0.5, 1.7); // stretch the glow into a vertical pillar
      ctx.translate(-sx, -sy);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(sx, sy, shaftH, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Aurora ribbon palette + motion — hoisted so the animated draw allocates nothing per frame.
// base = fraction from horizon→zenith, amp = undulation, thick = band thickness, sp = drift period (ms).
const AURORA_RIBBONS = [
  { r: 80, g: 235, b: 165, base: 0.34, amp: 0.15, thick: 0.2, sp: 1500 },
  { r: 64, g: 208, b: 236, base: 0.48, amp: 0.18, thick: 0.22, sp: 1900 },
  { r: 172, g: 122, b: 242, base: 0.6, amp: 0.14, thick: 0.18, sp: 2300 },
  { r: 242, g: 122, b: 198, base: 0.72, amp: 0.11, thick: 0.15, sp: 2800 },
];
