// A small STATIC farm thumbnail (friends list + gold ranking) so players can see each other's
// decorated plots. It composes the same geometry-agnostic art as the live strip — drawTheme (sky)
// + drawDecorById (decor) — onto a tiny "bottom-docked" band that fills the whole <canvas>.
// No animation: nowMs=0, hoverT=1 (so hover-gated decor still shows). See render/cosmeticScene.ts.
import { drawTheme } from "./theme";
import { drawDecorById } from "./decorArt";
import type { CosmeticScene } from "./cosmeticScene";
import { BALANCE } from "../config/balance";

export function renderFarmPreview(
  canvas: HTMLCanvasElement,
  opts: { decor: string; theme: string; topTier?: number },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // headless / lost context — nothing to draw

  // CSS box size → backing store at DPR, then draw in CSS px.
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width || 120;
  const cssH = canvas.clientHeight || canvas.height || 40;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cssW, cssH);

  // Band = the whole canvas; soil sits near the bottom.
  const soilY = cssH * 0.72;
  const rowX0 = cssW * 0.12;
  const rowX1 = cssW * 0.88;
  const scene: CosmeticScene = {
    ctx,
    bandX: 0,
    bandY: 0,
    bandW: cssW,
    bandH: cssH,
    soilY,
    rowX0,
    rowX1,
    scale: clamp(cssH / 40, 0.6, 1.4), // proportionate to the real ~40px band
    nowMs: 0, // static thumbnail
    hoverT: 1, // show decor fully (some is gated on hoverT>0.2)
    dock: "bottom",
  };

  // (1) sky/background theme behind everything.
  drawTheme(opts.theme, scene);

  // (2) soil strip — simplified strip.ts drawSoil: a filled body + a thin darker top edge.
  const sx0 = rowX0 - 4;
  const sw = rowX1 + 4 - sx0;
  const soilH = Math.max(3, cssH - soilY);
  ctx.fillStyle = "#7a5a36";
  roundRect(ctx, sx0, soilY, sw, soilH, 3);
  ctx.fill();
  ctx.fillStyle = "#5b3a21";
  ctx.fillRect(sx0, soilY, sw, 1);

  // (3) a few crop blobs standing on the soil (top-tier crop colour).
  const tier = opts.topTier;
  if (tier != null && Number.isInteger(tier) && tier >= 0 && tier < BALANCE.crops.tiers.length) {
    const ct = BALANCE.crops.tiers[tier];
    const color = ct.color;
    const glow = ct.glow; // special crops flex a halo even in the friend preview
    const n = 4;
    const r = 3 * scene.scale;
    const stemH = 7 * scene.scale;
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 5 * scene.scale;
    }
    for (let i = 0; i < n; i++) {
      const cx = rowX0 + (rowX1 - rowX0) * ((i + 0.5) / n);
      ctx.strokeStyle = "#4f7a3a"; // stem
      ctx.lineWidth = Math.max(1, 1.2 * scene.scale);
      ctx.beginPath();
      ctx.moveTo(cx, soilY);
      ctx.lineTo(cx, soilY - stemH);
      ctx.stroke();
      ctx.fillStyle = color; // ripe blob
      ctx.beginPath();
      ctx.arc(cx, soilY - stemH - r * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0; // don't let the halo bleed into decor drawn next
  }

  // (4) decor on top.
  drawDecorById(opts.decor, scene);
}

// ── helpers ──────────────────────────────────────────────────────────────────

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
