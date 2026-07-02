// Farm DECOR — props on/around the planting ROW. Drawn every frame, AFTER the soil, by both the live
// strip band (render/strip.ts) and the farm-preview thumbnails. Geometry comes from the CosmeticScene
// (never a private layout) so the same art renders at any size. Keep it cheap; gate animated bits on
// hoverT so the resting strip stays calm. Unknown id or "decor_none" → draw nothing.
//
// Art direction: NATURAL props (fence, flowerbed, pond, blossom) lean Stardew-pixel; LIGHT props
// (lantern, lights, rainbow) lean modern + luminous — layered radial glow via "lighter" compositing.
import type { CosmeticScene } from "./cosmeticScene";

/** Snap a coord to a whole device-independent px so pixel-art edges stay crisp. */
function px(v: number): number {
  return Math.round(v);
}

/** A small 5-petal blossom with a warm center — the garland flowers of decor_blossom. */
function blossomCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: string,
  now: number,
  i: number,
): void {
  const wob = Math.sin(now / 1100 + i) * 0.2; // gentle bob
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wob);
  ctx.fillStyle = col;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#fff3c0";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawDecorById(decorId: string, s: CosmeticScene): void {
  if (!decorId || decorId === "decor_none") return;

  const { ctx, rowX0, rowX1, soilY, scale, nowMs, hoverT, bandY, bandH } = s;
  const up = s.dock === "bottom" ? -1 : 1; // sign of "toward the sky" (above the soil)
  const cx = (rowX0 + rowX1) / 2;
  const span = rowX1 - rowX0;

  ctx.save();
  switch (decorId) {
    // ── fence: pixel wooden posts (lit face + shade + cap) joined by two rails ──────
    case "decor_fence": {
      const wood = "#9c6b38";
      const woodLt = "#c69457";
      const woodDk = "#6e4622";
      const rH = Math.max(1, Math.round(1.6 * scale));
      const edge = Math.max(1, Math.round(scale));
      const rx0 = px(rowX0);
      const rw = px(rowX1) - px(rowX0);
      for (const ry of [soilY + up * 9 * scale, soilY + up * 4 * scale]) {
        const y = px(ry);
        ctx.fillStyle = woodDk;
        ctx.fillRect(rx0, y + rH, rw, edge); // underside shadow
        ctx.fillStyle = wood;
        ctx.fillRect(rx0, y, rw, rH);
        ctx.fillStyle = "rgba(255,240,210,0.4)";
        ctx.fillRect(rx0, y, rw, edge); // lit top edge
      }
      const postW = Math.max(3, Math.round(3.4 * scale));
      const postH = Math.round(11 * scale);
      const gap = Math.max(20, 26 * scale);
      for (let x = rowX0 + 3 * scale; x <= rowX1 - postW; x += gap) {
        const y0 = px(Math.min(soilY, soilY + up * postH));
        const xi = px(x);
        ctx.fillStyle = wood;
        ctx.fillRect(xi, y0, postW, postH);
        ctx.fillStyle = woodLt;
        ctx.fillRect(xi, y0, edge, postH); // lit left face
        ctx.fillStyle = woodDk;
        ctx.fillRect(xi + postW - edge, y0, edge, postH); // shaded right face
        const capY = up < 0 ? y0 : y0 + postH - edge;
        ctx.fillStyle = woodDk;
        ctx.fillRect(xi, capY, postW, edge); // darker cap at the sky end
      }
      break;
    }

    // ── lantern: hanging paper lanterns with layered warm glow + gentle sway ────────
    case "decor_lantern": {
      const cy = soilY + up * 15 * scale;
      const bodyR = 4.2 * scale;
      const topEdge = up < 0 ? bandY : bandY + bandH; // where the hanger strings attach
      const warm: [string, string][] = [["#ffce5a", "#ff9838"], ["#ffd77a", "#ff8f5c"], ["#ffc94a", "#ffa63a"]];
      for (let i = 0; i < 3; i++) {
        const x = rowX0 + span * (0.22 + i * 0.28);
        const lx = x + Math.sin(nowMs / 1500 + i * 2.1) * 2 * scale; // sway
        const flick = 0.86 + 0.1 * Math.sin(nowMs / 230 + i * 1.7) + 0.04 * Math.sin(nowMs / 70 + i);
        const [c0, c1] = warm[i];
        // hanger string (fixed top → swaying lantern)
        ctx.strokeStyle = "rgba(60,42,26,0.5)";
        ctx.lineWidth = Math.max(1, scale * 0.7);
        ctx.beginPath();
        ctx.moveTo(x, topEdge);
        ctx.lineTo(lx, cy - up * (bodyR + 1.5 * scale));
        ctx.stroke();
        // soft outer glow (additive)
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const gR = 13 * scale * flick;
        const g = ctx.createRadialGradient(lx, cy, 0, lx, cy, gR);
        g.addColorStop(0, "rgba(255,224,150,0.55)");
        g.addColorStop(0.4, "rgba(255,180,90,0.22)");
        g.addColorStop(1, "rgba(255,150,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, cy, gR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // metal caps
        ctx.fillStyle = "#6e4622";
        ctx.fillRect(px(lx - bodyR * 0.55), px(cy - bodyR - scale), px(bodyR * 1.1), Math.max(1, Math.round(scale)));
        ctx.fillRect(px(lx - bodyR * 0.55), px(cy + bodyR), px(bodyR * 1.1), Math.max(1, Math.round(scale)));
        // paper body — warm vertical gradient
        const bg = ctx.createLinearGradient(0, cy - bodyR, 0, cy + bodyR);
        bg.addColorStop(0, c1);
        bg.addColorStop(0.5, c0);
        bg.addColorStop(1, c1);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.ellipse(lx, cy, bodyR * 0.82, bodyR, 0, 0, Math.PI * 2);
        ctx.fill();
        // centre rib
        ctx.strokeStyle = "rgba(180,90,30,0.35)";
        ctx.lineWidth = Math.max(1, scale * 0.5);
        ctx.beginPath();
        ctx.moveTo(lx, cy - bodyR);
        ctx.lineTo(lx, cy + bodyR);
        ctx.stroke();
        // hot core
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,250,225,0.9)";
        ctx.beginPath();
        ctx.ellipse(lx - bodyR * 0.12, cy - bodyR * 0.1, bodyR * 0.42 * flick, bodyR * 0.5 * flick, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }

    // ── blossom: slender branch + 5-petal clusters (always) + drifting petals (hover)
    case "decor_blossom": {
      const pinks = ["#ffc1dd", "#ff9ec4", "#ff85b3"];
      const branchY = soilY + up * 12 * scale;
      const yA = branchY + up * 2 * scale;
      const yPeak = branchY - up * 3 * scale;
      ctx.strokeStyle = "rgba(94,66,46,0.55)";
      ctx.lineWidth = Math.max(1, 0.9 * scale);
      ctx.beginPath();
      ctx.moveTo(rowX0, yA);
      ctx.quadraticCurveTo(cx, yPeak, rowX1, yA);
      ctx.stroke();
      const n = 6;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const bx = rowX0 + span * u;
        const by = (1 - u) * (1 - u) * yA + 2 * (1 - u) * u * yPeak + u * u * yA; // point on the branch
        blossomCluster(ctx, bx, by, 2.1 * scale, pinks[i % pinks.length], nowMs, i);
      }
      // drifting petals — fade in with hover so the resting strip stays calm
      const pa = Math.min(1, Math.max(0, (hoverT - 0.1) / 0.5));
      if (pa > 0.02) {
        for (let i = 0; i < 8; i++) {
          const seed = i * 97.3;
          const x = rowX0 + ((seed + nowMs / 45) % span);
          const y = bandY + ((seed * 0.7 + nowMs / 70) % bandH);
          const sway = Math.sin(nowMs / 500 + i) * 3 * scale;
          ctx.save();
          ctx.translate(x + sway, y);
          ctx.rotate(nowMs / 400 + i);
          ctx.globalAlpha = pa * 0.9;
          ctx.fillStyle = pinks[i % pinks.length];
          ctx.beginPath();
          ctx.ellipse(0, 0, 2.4 * scale, 1.2 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }

    // ── flowerbed: pixel flowers (5 petals + center) on swaying stems w/ a leaf ─────
    case "decor_flowerbed": {
      const petalC = ["#ff6b9d", "#ffd24a", "#7b9be0", "#f27a5c", "#c46bd0", "#ff9ec4"];
      const n = 6;
      const stemH = 8 * scale;
      for (let i = 0; i < n; i++) {
        const x = rowX0 + span * ((i + 0.5) / n);
        const sway = Math.sin(nowMs / 1200 + i * 1.4) * 1.4 * scale;
        const topY = soilY + up * stemH;
        const midY = (soilY + topY) / 2;
        ctx.strokeStyle = "#4f8a3e";
        ctx.lineWidth = Math.max(1, 1.1 * scale);
        ctx.beginPath();
        ctx.moveTo(x, soilY);
        ctx.quadraticCurveTo(x + sway * 0.5, midY, x + sway, topY);
        ctx.stroke();
        // leaf
        ctx.fillStyle = "#6cb43f";
        ctx.save();
        ctx.translate(x + sway * 0.4, midY);
        ctx.rotate(up < 0 ? -0.6 : 0.6);
        ctx.beginPath();
        ctx.ellipse(2 * scale, 0, 2.4 * scale, 1.1 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // flower head
        const fx = x + sway;
        const fy = topY;
        const pr = 2.3 * scale;
        ctx.fillStyle = petalC[i % petalC.length];
        for (let k = 0; k < 5; k++) {
          const a = i * 0.7 + (k / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * pr, fy + Math.sin(a) * pr, pr * 0.66, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#ffe9a8";
        ctx.beginPath();
        ctx.arc(fx, fy, pr * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c98a2e";
        ctx.beginPath();
        ctx.arc(fx, fy, pr * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    // ── pond: gradient water + rim highlight + lily pads + lotus + staggered ripples
    case "decor_pond": {
      const rx = Math.max(7 * scale, span * 0.18);
      const ry = 4.2 * scale;
      const cy = soilY + up * ry; // sits on the soil
      const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
      g.addColorStop(0, "rgba(58,138,198,0.62)");
      g.addColorStop(1, "rgba(112,196,230,0.6)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(214,242,252,0.5)"; // bright rim
      ctx.lineWidth = Math.max(1, scale * 0.8);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(224,246,255,0.5)"; // sky-side highlight
      ctx.beginPath();
      ctx.ellipse(cx - rx * 0.35, cy - up * ry * 0.28, rx * 0.34, ry * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 2; k++) {
        const t = ((nowMs + k * 1200) % 2400) / 2400; // two ripples, offset, alpha fades as they grow
        ctx.globalAlpha = (1 - t) * 0.45;
        ctx.strokeStyle = "#e6f6ff";
        ctx.lineWidth = Math.max(1, scale * 0.7);
        ctx.beginPath();
        ctx.ellipse(cx + rx * 0.1, cy, rx * (0.2 + 0.7 * t), ry * (0.2 + 0.7 * t), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // lily pads (notched by starting the arc past 0)
      ctx.fillStyle = "#3f8a46";
      for (const [ox, oy, pr] of [[-rx * 0.45, -ry * 0.1, 2.4], [rx * 0.42, ry * 0.18, 1.9]]) {
        ctx.beginPath();
        ctx.ellipse(cx + ox, cy + oy, pr * scale, pr * 0.62 * scale, 0, 0.5, Math.PI * 2 + 0.2);
        ctx.fill();
      }
      // lotus bud on the near pad
      ctx.fillStyle = "#ff9ec4";
      ctx.beginPath();
      ctx.arc(cx - rx * 0.45, cy - ry * 0.1, 1 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff3c0";
      ctx.fillRect(px(cx - rx * 0.45), px(cy - ry * 0.1), Math.max(1, Math.round(scale * 0.7)), Math.max(1, Math.round(scale * 0.7)));
      break;
    }

    // ── lights: festive string lights with per-bulb radial glow + twinkle ───────────
    case "decor_lights": {
      const wireY = soilY + up * 16 * scale; // ends
      const sagY = soilY + up * 11 * scale; // mid droops toward the soil
      ctx.strokeStyle = "rgba(50,36,22,0.55)";
      ctx.lineWidth = Math.max(1, scale * 0.8);
      ctx.beginPath();
      ctx.moveTo(rowX0, wireY);
      ctx.quadraticCurveTo(cx, sagY, rowX1, wireY);
      ctx.stroke();
      const cols: [string, string][] = [
        ["#ffd76a", "#fff3c8"],
        ["#ff8a5c", "#ffd6c0"],
        ["#8ad0ff", "#e2f4ff"],
        ["#a6e88a", "#ecffe0"],
      ];
      const N = 9;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;
        const bx = rowX0 + span * u;
        const by = (1 - u) * (1 - u) * wireY + 2 * (1 - u) * u * sagY + u * u * wireY; // wire y at u
        const yb = by - up * 2 * scale; // bulb hangs just below the wire
        const tw = 0.55 + 0.45 * Math.sin(nowMs / 320 + i * 1.3); // twinkle 0..1
        const [c, hot] = cols[i % cols.length];
        // glow
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const gR = 5.5 * scale * (0.7 + 0.5 * tw);
        const g = ctx.createRadialGradient(bx, yb, 0, bx, yb, gR);
        g.addColorStop(0, c);
        g.addColorStop(0.5, "rgba(255,210,140,0.22)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.5 + 0.4 * tw;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, yb, gR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // socket cap
        ctx.fillStyle = "rgba(50,36,22,0.7)";
        ctx.fillRect(px(bx - scale), px(by - up * scale), Math.max(1, Math.round(2 * scale)), Math.max(1, Math.round(scale)));
        // bulb + hotspot
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(bx, yb, 1.9 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hot;
        ctx.beginPath();
        ctx.arc(bx - 0.5 * scale, yb - 0.5 * scale, 0.8 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }

    // ── rainbow (legendary): luminous ROYGBIV arc + soft bloom + twinkling sparkles ─
    case "decor_rainbow": {
      const baseRx = span * 0.52;
      const baseRy = Math.min(baseRx, bandH * 1.5); // flattened so it hugs the strip
      const bands = ["#ff5a6a", "#ff9a3c", "#ffd54a", "#5fd66a", "#4fb0ff", "#6f7bff", "#c86bff"];
      const startA = up < 0 ? Math.PI : 0; // upper half (bottom dock) vs lower half (top dock)
      const endA = up < 0 ? Math.PI * 2 : Math.PI;
      const bw = Math.max(2.4, 2.7 * scale);
      const totalBW = bw * bands.length;
      const shimmer = 0.62 + 0.08 * Math.sin(nowMs / 1200); // slow shimmer
      // outer bloom
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.1 + 0.04 * Math.sin(nowMs / 900);
      ctx.strokeStyle = "#ffffff";
      ctx.lineCap = "round";
      ctx.lineWidth = totalBW + 6 * scale;
      ctx.beginPath();
      ctx.ellipse(cx, soilY, baseRx - totalBW / 2, baseRy - totalBW / 2, 0, startA, endA);
      ctx.stroke();
      ctx.restore();
      // bands (round caps + slight overlap → smooth blend)
      ctx.lineCap = "round";
      for (let i = 0; i < bands.length; i++) {
        const rx = baseRx - i * bw;
        const ry = baseRy - i * bw;
        if (rx <= 0 || ry <= 0) break;
        ctx.strokeStyle = bands[i];
        ctx.globalAlpha = shimmer;
        ctx.lineWidth = bw + 0.8 * scale;
        ctx.beginPath();
        ctx.ellipse(cx, soilY, rx, ry, 0, startA, endA);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // twinkling sparkles along the crown
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const midR = baseRx - totalBW * 0.5;
      const midRy = baseRy - totalBW * 0.5;
      for (let k = 0; k < 6; k++) {
        const a = startA + (endA - startA) * ((k + 0.5) / 6);
        const tw = 0.5 + 0.5 * Math.sin(nowMs / 280 + k * 2.3);
        const sxp = cx + Math.cos(a) * midR;
        const syp = soilY + Math.sin(a) * midRy;
        ctx.globalAlpha = 0.25 + 0.6 * tw;
        ctx.fillStyle = "#fffef0";
        const sz = (0.8 + 0.9 * tw) * scale;
        ctx.fillRect(sxp - sz / 2, syp - sz / 2, sz, sz);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      break;
    }

    default:
      break; // unknown id → nothing
  }
  ctx.restore();
}
