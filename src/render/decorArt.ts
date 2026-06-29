// Farm DECOR — props on/around the planting ROW. Drawn every frame, AFTER the soil, by both the live
// strip band (render/strip.ts) and the farm-preview thumbnails. Geometry comes from the CosmeticScene
// (never a private layout) so the same art renders at any size. Keep it cheap; gate animated bits on
// hoverT so the resting strip stays calm. Unknown id or "decor_none" → draw nothing.
import type { CosmeticScene } from "./cosmeticScene";

export function drawDecorById(decorId: string, s: CosmeticScene): void {
  if (!decorId || decorId === "decor_none") return;

  const { ctx, rowX0, rowX1, soilY, scale, nowMs, hoverT, bandY, bandH } = s;
  const up = s.dock === "bottom" ? -1 : 1; // sign of "toward the sky" (above the soil)
  const cx = (rowX0 + rowX1) / 2;
  const span = rowX1 - rowX0;

  ctx.save();
  switch (decorId) {
    // ── fence: short posts along the row + a top rail ──────────────────────────
    case "decor_fence": {
      ctx.fillStyle = "#8a6a42";
      for (let x = rowX0; x < rowX1; x += 22 * scale) ctx.fillRect(x, soilY + up * 8 * scale, 3 * scale, 8 * scale);
      ctx.fillRect(rowX0, soilY + up * 6 * scale, rowX1 - rowX0, 2 * scale);
      break;
    }

    // ── lantern: 3 glowing orbs above the row ──────────────────────────────────
    case "decor_lantern": {
      for (let i = 0; i < 3; i++) {
        const x = rowX0 + span * (0.2 + i * 0.3);
        const cy = soilY + up * 14 * scale;
        ctx.fillStyle = "rgba(244,201,78,0.25)"; // glow
        ctx.beginPath();
        ctx.arc(x, cy, 9 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f4c94e"; // core
        ctx.beginPath();
        ctx.arc(x, cy, 4 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    // ── blossom: drifting petals (busy → only once the strip is rolled up) ──────
    case "decor_blossom": {
      if (hoverT <= 0.2) break;
      ctx.fillStyle = "#f3b6cf";
      for (let i = 0; i < 5; i++) {
        const x = rowX0 + ((i * 97.3 + nowMs / 40) % span);
        const yy = bandY + ((i * 53.7 + nowMs / 60) % bandH);
        ctx.fillRect(x, yy, 3 * scale, 3 * scale);
      }
      break;
    }

    // ── flowerbed: 6 evenly spaced stems, each topped with a small bloom (static)
    case "decor_flowerbed": {
      const colors = ["#e8557f", "#f4c94e", "#7b9be0"];
      const stemH = 7 * scale;
      for (let i = 0; i < 6; i++) {
        const x = rowX0 + span * ((i + 0.5) / 6);
        const ty = soilY + up * stemH; // bloom center
        ctx.fillStyle = "#5a8f4e"; // green stem
        ctx.fillRect(x - 0.75 * scale, Math.min(soilY, ty), 1.5 * scale, stemH);
        ctx.fillStyle = colors[i % colors.length]; // bloom
        ctx.beginPath();
        ctx.arc(x, ty, 2.5 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    // ── pond: translucent water near row center + highlight + expanding ripple ──
    case "decor_pond": {
      const rx = Math.max(6 * scale, span * 0.16);
      const ry = 4 * scale;
      const cy = soilY + up * ry; // sits on the soil
      ctx.fillStyle = "rgba(90,169,214,0.6)"; // water (#5aa9d6 @ 0.6)
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(200,233,247,0.5)"; // lighter highlight, offset toward the sky
      ctx.beginPath();
      ctx.ellipse(cx - rx * 0.3, cy + up * ry * 0.3, rx * 0.4, ry * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      const t = (nowMs % 2400) / 2400; // one ripple every 2.4s, alpha fades as it grows
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = "#cdeaf7";
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (0.25 + 0.7 * t), ry * (0.25 + 0.7 * t), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    // ── lights: a sagging wire across the row + 8 twinkling warm bulbs ──────────
    case "decor_lights": {
      const wireY = soilY + up * 16 * scale; // ends
      const sagY = soilY + up * 11 * scale; // mid droops toward the soil
      ctx.strokeStyle = "rgba(60,42,26,0.5)"; // faint wire
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(rowX0, wireY);
      ctx.quadraticCurveTo(cx, sagY, rowX1, wireY);
      ctx.stroke();
      const warm = ["#ffd76a", "#ff8a5c"];
      for (let i = 0; i < 8; i++) {
        const u = (i + 0.5) / 8;
        const bx = rowX0 + span * u;
        const by = (1 - u) * (1 - u) * wireY + 2 * (1 - u) * u * sagY + u * u * wireY; // wire y at u
        const tw = 0.5 + 0.5 * Math.sin(nowMs / 300 + i); // twinkle brightness 0..1
        ctx.globalAlpha = 0.35 + 0.55 * tw;
        ctx.fillStyle = warm[i % warm.length];
        ctx.beginPath();
        ctx.arc(bx, by - up * 1.5 * scale, 2 * scale, 0, Math.PI * 2); // hang just below the wire
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }

    // ── rainbow (legendary): translucent red→violet arc over the row, slow shimmer
    case "decor_rainbow": {
      const baseRx = span / 2;
      const baseRy = Math.min(baseRx, bandH * 1.4); // flattened so it hugs the strip
      const bands = ["#e23b3b", "#e8913c", "#f4c94e", "#5fae5f", "#4f8fe0", "#8a5fb0"];
      const startA = up < 0 ? Math.PI : 0; // upper half (bottom dock) vs lower half (top dock)
      const endA = up < 0 ? Math.PI * 2 : Math.PI;
      const bw = Math.max(2.2, 2.4 * scale);
      ctx.lineWidth = Math.max(1.6, 2 * scale);
      ctx.globalAlpha = 0.35 + 0.05 * Math.sin(nowMs / 1400); // very slow shimmer
      for (let i = 0; i < bands.length; i++) {
        const rx = baseRx - i * bw;
        const ry = baseRy - i * bw;
        if (rx <= 0 || ry <= 0) break;
        ctx.strokeStyle = bands[i];
        ctx.beginPath();
        ctx.ellipse(cx, soilY, rx, ry, 0, startA, endA);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }

    default:
      break; // unknown id → nothing
  }
  ctx.restore();
}
