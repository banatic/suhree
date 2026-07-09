// Art for the plantable griefing skins (잡초 스킨). Each routine draws from a slot's soil point
// "upward" along the band's grow direction (dir = -1 up for a bottom dock, +1 down for a top dock),
// so the same code works for either dock. Dispatched by skin id from render/strip.ts's drawWeed;
// the planter's nickname stamp is drawn separately (drawWeedTag). Adding an id in balance.ts without
// a case here just falls back to the classic weed.

export interface WeedDrawCtx {
  cx: number; // slot centre x (CSS px)
  soilY: number; // soil line y
  scale: number; // band scale (1 or 2)
  dir: -1 | 1; // grow direction: -1 = up (bottom dock), +1 = down (top dock)
  nowMs: number;
  seed: number; // slot index — varies the sway per weed
}

export function drawWeedSkin(c: CanvasRenderingContext2D, skin: string | undefined, w: WeedDrawCtx): void {
  switch (skin) {
    case "weed_sign":
      return drawSign(c, w);
    case "weed_flag":
      return drawFlag(c, w);
    case "weed_mushroom":
      return drawMushroom(c, w);
    case "weed_dandelion":
      return drawDandelion(c, w);
    case "weed_foxtail":
      return drawFoxtail(c, w);
    case "weed_clover":
      return drawClover(c, w);
    case "weed_poop":
      return drawPoop(c, w, false);
    case "weed_rainbowpoop":
      return drawPoop(c, w, true);
    case "weed_sprout":
      return drawSprout(c, w);
    case "weed_sleepingcat":
      return drawSleepingCat(c, w);
    case "weed_gift":
      return drawGift(c, w);
    default:
      return drawGrass(c, w);
  }
}

function sway(w: WeedDrawCtx): number {
  return Math.sin(w.nowMs / 700 + w.seed) * 1.2 * w.scale;
}

/** y for a point `h` px up the stalk from the soil (respects dock direction). */
function up(w: WeedDrawCtx, h: number): number {
  return w.soilY + w.dir * h;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, wd: number, ht: number, r: number): void {
  const rad = Math.min(r, wd / 2, ht / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + wd, y, x + wd, y + ht, rad);
  c.arcTo(x + wd, y + ht, x, y + ht, rad);
  c.arcTo(x, y + ht, x, y, rad);
  c.arcTo(x, y, x + wd, y, rad);
  c.closePath();
}

// ── 잡초 (기본) — four arced blades + a central shoot ─────────────────────────────
function drawGrass(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s, dir: d } = w;
  const h = 9 * s;
  const sw = sway(w);
  c.save();
  c.strokeStyle = "#5d8a39";
  c.lineWidth = Math.max(1, 1.4 * s);
  c.lineCap = "round";
  for (const a of [-0.55, -0.2, 0.2, 0.55]) {
    c.beginPath();
    c.moveTo(cx, soilY);
    c.quadraticCurveTo(cx + a * 5 * s, soilY + d * h * 0.6, cx + a * 9 * s + sw, soilY + d * h);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(cx, soilY);
  c.lineTo(cx + sw * 0.4, soilY + d * h * 1.15);
  c.stroke();
  c.restore();
}

// ── 팻말 "다녀감" — a little signpost (best friend of the nickname stamp) ──────────
function drawSign(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s } = w;
  const postH = 11 * s;
  c.save();
  c.strokeStyle = "#7a4f27";
  c.lineWidth = Math.max(1.6, 1.8 * s);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx, soilY);
  c.lineTo(cx, up(w, postH));
  c.stroke();
  const bw = 13 * s;
  const bh = 7 * s;
  const bcy = up(w, postH - 2 * s);
  rr(c, cx - bw / 2, bcy - bh / 2, bw, bh, 1.5 * s);
  c.fillStyle = "#b5793d";
  c.fill();
  c.lineWidth = Math.max(1, s);
  c.strokeStyle = "#5e3c1c";
  c.stroke();
  c.strokeStyle = "rgba(60,38,20,0.7)";
  c.lineWidth = Math.max(1, 0.8 * s);
  c.beginPath();
  c.moveTo(cx - bw / 2 + 2 * s, bcy - 1.2 * s);
  c.lineTo(cx + bw / 2 - 2 * s, bcy - 1.2 * s);
  c.moveTo(cx - bw / 2 + 2 * s, bcy + 1.4 * s);
  c.lineTo(cx + bw / 2 - 3 * s, bcy + 1.4 * s);
  c.stroke();
  c.restore();
}

// ── 깃발 — pole + waving triangular pennant ───────────────────────────────────────
function drawFlag(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s } = w;
  const poleH = 13 * s;
  const sw = sway(w);
  const fx = cx + sw * 0.2;
  c.save();
  c.strokeStyle = "#6e6357";
  c.lineWidth = Math.max(1.4, 1.6 * s);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx, soilY);
  c.lineTo(fx, up(w, poleH));
  c.stroke();
  c.fillStyle = "#d94b4b";
  c.beginPath();
  c.moveTo(fx, up(w, poleH));
  c.quadraticCurveTo(fx + 6 * s + sw, up(w, poleH - 1.5 * s), fx + 11 * s + sw * 1.5, up(w, poleH - 2.5 * s));
  c.lineTo(fx, up(w, poleH - 5 * s));
  c.closePath();
  c.fill();
  c.restore();
}

// ── 독버섯 — cream stem + red cap with white spots (+ faint glow) ──────────────────
function drawMushroom(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s, dir: d } = w;
  const stemH = 6 * s;
  const capY = up(w, stemH);
  c.save();
  c.globalAlpha = 0.22 + 0.1 * Math.sin(w.nowMs / 500 + w.seed);
  c.fillStyle = "#ff6a6a";
  c.beginPath();
  c.ellipse(cx, capY, 7 * s, 4 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = "#f0e6cf";
  rr(c, cx - 1.6 * s, Math.min(soilY, capY), 3.2 * s, stemH, 1 * s);
  c.fill();
  
  // Cute face on the stem
  c.fillStyle = "#3b3634";
  const stemCy = Math.min(soilY, capY) + stemH/2;
  c.beginPath();
  c.arc(cx - 0.8 * s, stemCy - 0.5 * s, 0.5 * s, 0, Math.PI * 2);
  c.arc(cx + 0.8 * s, stemCy - 0.5 * s, 0.5 * s, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#3b3634";
  c.lineWidth = Math.max(0.5, 0.6 * s);
  c.beginPath();
  c.moveTo(cx - 0.6 * s, stemCy + 0.6 * s);
  c.lineTo(cx, stemCy + 1.2 * s);
  c.lineTo(cx + 0.6 * s, stemCy + 0.6 * s);
  c.stroke();
  c.fillStyle = "rgba(255, 120, 150, 0.5)"; // blush
  c.beginPath();
  c.arc(cx - 1.5 * s, stemCy + 0.2 * s, 0.8 * s, 0, Math.PI * 2);
  c.arc(cx + 1.5 * s, stemCy + 0.2 * s, 0.8 * s, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = "#d23b3b";
  c.beginPath();
  c.ellipse(cx, capY, 6 * s, 4.6 * s, 0, d < 0 ? Math.PI : 0, d < 0 ? Math.PI * 2 : Math.PI);
  c.fill();
  c.fillStyle = "#fff4e8";
  for (const [dx, dh, dr] of [[-2.6, 1.8, 1.1], [1.6, 2.6, 0.9], [3, 0.7, 0.8]]) {
    c.beginPath();
    c.arc(cx + dx * s, up(w, stemH + dh * s), dr * s, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// ── 민들레꽃 — green stalk + radiating yellow flower head ──────────────────────────
function drawDandelion(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s } = w;
  const stemH = 9 * s;
  const sw = sway(w);
  const hx = cx + sw;
  const hy = up(w, stemH);
  c.save();
  c.strokeStyle = "#5a8f3c";
  c.lineWidth = Math.max(1.2, 1.4 * s);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx, soilY);
  c.quadraticCurveTo(cx + sw * 0.4, up(w, stemH * 0.6), hx, hy);
  c.stroke();
  c.strokeStyle = "#f2c233";
  c.lineWidth = Math.max(1, 1.1 * s);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    c.beginPath();
    c.moveTo(hx, hy);
    c.lineTo(hx + Math.cos(a) * 3.2 * s, hy + Math.sin(a) * 3.2 * s);
    c.stroke();
  }
  c.fillStyle = "#f7d94a";
  c.beginPath();
  c.arc(hx, hy, 2.2 * s, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#e8a83a";
  c.beginPath();
  c.arc(hx, hy, 1.1 * s, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// ── 강아지풀 — arching stalk with a fuzzy tapered seed spike ───────────────────────
function drawFoxtail(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s } = w;
  const stemH = 12 * s;
  const sw = sway(w) * 1.4;
  const tipx = cx + sw;
  c.save();
  c.strokeStyle = "#6f9a45";
  c.lineWidth = Math.max(1.2, 1.4 * s);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx, soilY);
  c.quadraticCurveTo(cx + sw * 0.3, up(w, stemH * 0.55), tipx, up(w, stemH));
  c.stroke();
  c.strokeStyle = "#8bbf5a";
  c.lineWidth = Math.max(1, s);
  c.lineCap = "round";
  const spikeH = 6 * s;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const ax = tipx + (t - 0.5) * sw * 0.2;
    const ay = up(w, stemH - t * spikeH);
    const br = (1 - Math.abs(t - 0.5) * 1.5) * 2.6 * s;
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(ax + side * br, up(w, stemH - t * spikeH + 1.2 * s));
      c.stroke();
    }
  }
  c.restore();
}

// ── 네잎클로버 — short stalk + four rounded leaves ────────────────────────────────
function drawClover(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s } = w;
  const stemH = 7 * s;
  const hx = cx;
  const hy = up(w, stemH);
  c.save();
  c.strokeStyle = "#4e8f3e";
  c.lineWidth = Math.max(1.1, 1.2 * s);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx, soilY);
  c.lineTo(hx, hy);
  c.stroke();
  const off = 2.5 * s;
  const lr = 2.7 * s;
  c.fillStyle = "#3fa04a";
  for (const [ox, oy] of [[-off, 0], [off, 0], [0, -off], [0, off]]) {
    c.beginPath();
    c.arc(hx + ox, hy + oy, lr, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "#2f7d38";
  c.beginPath();
  c.arc(hx, hy, 1 * s, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// ── 똥 / 무지개똥 — stacked tapering blobs, swirl tip, cute eyes ───────────────────
function drawPoop(c: CanvasRenderingContext2D, w: WeedDrawCtx, rainbow: boolean): void {
  const { cx, scale: s } = w;
  const rainbowCols = ["#e5484d", "#f2933c", "#f6cf4a", "#54b568", "#4aa3e0", "#7a5bd6"];
  const brown = ["#8a5a2e", "#7a4a24", "#6b3f1e"];
  const layers = [
    { h: 1.8 * s, rx: 6.5 * s, ry: 2.7 * s },
    { h: 4.7 * s, rx: 5.0 * s, ry: 2.4 * s },
    { h: 7.2 * s, rx: 3.4 * s, ry: 2.1 * s },
  ];
  c.save();
  layers.forEach((L, i) => {
    c.fillStyle = rainbow ? rainbowCols[i] : brown[i];
    c.beginPath();
    c.ellipse(cx, up(w, L.h), L.rx, L.ry, 0, 0, Math.PI * 2);
    c.fill();
  });
  c.fillStyle = rainbow ? rainbowCols[3] : "#5e3618";
  c.beginPath();
  c.arc(cx, up(w, 9 * s), 1.4 * s, 0, Math.PI * 2);
  c.fill();
  const ey = up(w, 4.7 * s);
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(cx - 2 * s, ey, 1.5 * s, 0, Math.PI * 2);
  c.arc(cx + 2 * s, ey, 1.5 * s, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#26170c";
  c.beginPath();
  c.arc(cx - 2 * s, ey, 0.7 * s, 0, Math.PI * 2);
  c.arc(cx + 2 * s, ey, 0.7 * s, 0, Math.PI * 2);
  c.fill();
  
  // Cute blush
  c.fillStyle = "rgba(255, 120, 150, 0.6)"; 
  c.beginPath();
  c.arc(cx - 3.5 * s, ey + 1 * s, 1.2 * s, 0, Math.PI * 2);
  c.arc(cx + 3.5 * s, ey + 1 * s, 1.2 * s, 0, Math.PI * 2);
  c.fill();
  
  c.restore();
}

// ── 새싹 (Sprout) — a plump green sprout peaking out ───────────────────────
function drawSprout(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s, dir: d } = w;
  const h = 7 * s;
  c.save();
  c.strokeStyle = "#80cc4b";
  c.lineWidth = Math.max(2, 2.5 * s);
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(cx, soilY);
  c.lineTo(cx, up(w, h));
  c.stroke();
  
  // Leaves
  c.fillStyle = "#80cc4b";
  for (const side of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + side * 3.5 * s, up(w, h - 1.5 * s), 4 * s, 2.5 * s, side * 0.4, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "#9eed55";
  for (const side of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + side * 3.5 * s, up(w, h - 2 * s), 3 * s, 1.5 * s, side * 0.4, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// ── 식빵 굽는 고양이 (Sleeping Cat) — a cozy loaf cat ───────────────────────
function drawSleepingCat(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s, nowMs, seed, dir } = w;
  c.save();
  const catY = soilY + dir * 3.5 * s;
  const breath = Math.sin(nowMs / 800 + seed) * 0.5 * s; 
  
  // Body (loaf)
  c.fillStyle = "#f3f0e8";
  c.beginPath();
  c.ellipse(cx, catY - breath, 8 * s, 5 * s, 0, 0, Math.PI * 2);
  c.fill();
  
  // Patches (calico)
  c.fillStyle = "#e59f42"; 
  c.beginPath();
  c.ellipse(cx - 3 * s, catY - 2 * s - breath, 3 * s, 2.5 * s, -0.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#3b3634"; 
  c.beginPath();
  c.ellipse(cx + 4 * s, catY - 1 * s - breath, 2.5 * s, 2 * s, 0.4, 0, Math.PI * 2);
  c.fill();
  
  // Ears
  c.fillStyle = "#f3f0e8";
  c.beginPath();
  c.moveTo(cx - 4 * s, catY - 4 * s - breath);
  c.lineTo(cx - 6 * s, catY - 8 * s - breath);
  c.lineTo(cx - 1 * s, catY - 4 * s - breath);
  c.fill();
  c.beginPath();
  c.moveTo(cx + 4 * s, catY - 4 * s - breath);
  c.lineTo(cx + 6 * s, catY - 8 * s - breath);
  c.lineTo(cx + 1 * s, catY - 4 * s - breath);
  c.fill();
  
  // Eyes (sleeping - U U shape)
  c.strokeStyle = "#3b3634";
  c.lineWidth = Math.max(1, 0.8 * s);
  c.beginPath();
  c.arc(cx - 2.5 * s, catY - 1.5 * s - breath, 1 * s, 0, Math.PI);
  c.stroke();
  c.beginPath();
  c.arc(cx + 2.5 * s, catY - 1.5 * s - breath, 1 * s, 0, Math.PI);
  c.stroke();

  // Floating "Zzz"
  const zY = catY - 10 * s - ((nowMs / 50 + seed * 100) % (15 * s));
  const zA = 1 - ((nowMs / 50 + seed * 100) % (15 * s)) / (15 * s);
  c.globalAlpha = Math.max(0, zA);
  c.fillStyle = "#666";
  c.font = `bold ${Math.max(8, 6 * s)}px sans-serif`;
  c.fillText("Z", cx + 3 * s, zY);
  c.font = `bold ${Math.max(6, 4 * s)}px sans-serif`;
  c.fillText("z", cx + 7 * s, zY - 3 * s);
  
  c.restore();
}

// ── 깜짝 선물상자 (Gift Box) — a pastel box with a ribbon ─────────────────────
function drawGift(c: CanvasRenderingContext2D, w: WeedDrawCtx): void {
  const { cx, soilY, scale: s, dir: d, nowMs, seed } = w;
  const h = 9 * s;
  const wBox = 11 * s;
  const wobble = Math.sin(nowMs / 200 + seed) * (Math.sin(nowMs / 1000) > 0.8 ? 1 : 0);
  
  c.save();
  c.translate(cx, soilY);
  c.rotate(wobble * 0.1);
  c.translate(-cx, -soilY);
  
  // Box base
  c.fillStyle = "#a8d8ea";
  c.fillRect(cx - wBox/2, up(w, h), wBox, -d * h);
  
  // Ribbon vertical
  c.fillStyle = "#ffb6b9";
  c.fillRect(cx - 1.5 * s, up(w, h), 3 * s, -d * h);
  
  // Lid
  c.fillStyle = "#a8d8ea";
  c.fillRect(cx - wBox/2 - 1*s, up(w, h), wBox + 2*s, -d * 2.5*s);
  c.fillStyle = "#ffb6b9";
  c.fillRect(cx - 1.5 * s, up(w, h), 3 * s, -d * 2.5*s);
  
  // Bow
  c.strokeStyle = "#ffb6b9";
  c.lineWidth = Math.max(1.5, 2 * s);
  c.beginPath();
  c.ellipse(cx - 2.5 * s, up(w, h + 1.5 * s), 3 * s, 1.5 * s, -0.3, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.ellipse(cx + 2.5 * s, up(w, h + 1.5 * s), 3 * s, 1.5 * s, 0.3, 0, Math.PI * 2);
  c.stroke();
  
  c.restore();
}
