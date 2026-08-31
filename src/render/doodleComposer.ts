// 낙서 카드 composer. After a raid in which the thief planted at least one weed, they get a small
// canvas to scribble on with the mouse; the drawing is then stamped onto every weed they left in
// that plot. Replaces the old text-note (쪽지) composer — same shape, same lifecycle: a DOM card at
// the band's edge, registered as a hit region so the Tauri click-through overlay lets the pointer
// reach it, and exactly ONE `done` call (art string, or null to skip).

import { bandHeightCss, bandDock } from "../state";
import { BALANCE } from "../config/balance";
import { GRID, encodeDoodle, type Stroke } from "../game/doodle";
import { publishHitRegions } from "./strip";

let el: HTMLDivElement | null = null;
let resolveCb: ((art: string | null) => void) | null = null;

const PAD_CSS = 168; // drawing surface, CSS px (square)
const INK = "#3a2a17";
const PEN_W = 3;

function ensureEl(): HTMLDivElement {
  if (!el) {
    el = document.createElement("div");
    el.id = "doodle-composer";
    document.getElementById("app")!.appendChild(el);
  }
  return el;
}

/**
 * Show the composer. `done` runs exactly once — with the encoded art, or null (skip / blank).
 * `weeds` is how many weeds this raid planted, i.e. how many copies of the card will be left.
 */
export function promptDoodle(
  targetNick: string,
  weeds: number,
  done: (art: string | null) => void,
): void {
  if (resolveCb) finish(null); // only one composer at a time
  resolveCb = done;

  const box = ensureEl();
  box.style.right = "10px";
  if (bandDock() === "bottom") {
    box.style.bottom = bandHeightCss() + 8 + "px";
    box.style.top = "auto";
  } else {
    box.style.top = bandHeightCss() + 8 + "px";
    box.style.bottom = "auto";
  }

  const head = document.createElement("div");
  head.className = "dc-head";
  head.textContent = "낙서 남기기";

  const sub = document.createElement("div");
  sub.className = "dc-sub";
  sub.textContent = `${targetNick}님 밭에 심은 잡초 ${weeds}개에 그림이 붙어요. 마우스로 그려보세요!`;

  // The drawing surface. Backed at devicePixelRatio so the preview isn't soft, but every stroke is
  // recorded in GRID space — what's stored is resolution-independent.
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.className = "dc-pad";
  cv.width = Math.round(PAD_CSS * dpr);
  cv.height = Math.round(PAD_CSS * dpr);
  cv.style.width = PAD_CSS + "px";
  cv.style.height = PAD_CSS + "px";
  const c = cv.getContext("2d")!;
  c.scale(dpr, dpr);

  // Shown once the pad can hold no more — a pen that silently stops reads as a bug.
  const full = document.createElement("div");
  full.className = "dc-full";
  full.textContent = "지면이 가득 찼어요 — 지우고 다시 그려보세요.";
  full.style.display = "none";

  const strokes: Stroke[] = [];
  let drawing = false;

  const repaint = (): void => {
    c.clearRect(0, 0, PAD_CSS, PAD_CSS);
    c.strokeStyle = INK;
    c.fillStyle = INK;
    c.lineWidth = PEN_W;
    c.lineCap = "round";
    c.lineJoin = "round";
    const k = PAD_CSS / (GRID - 1);
    for (const st of strokes) {
      if (st.length === 1) {
        c.beginPath();
        c.arc(st[0].x * k, st[0].y * k, PEN_W / 2, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      c.beginPath();
      c.moveTo(st[0].x * k, st[0].y * k);
      for (let i = 1; i < st.length; i++) c.lineTo(st[i].x * k, st[i].y * k);
      c.stroke();
    }
  };

  // Pointer position → GRID cell. Fractional on purpose: the encoder rounds, so quantisation
  // happens in exactly one place.
  const cell = (e: PointerEvent): { x: number; y: number } => {
    const r = cv.getBoundingClientRect();
    const g = (GRID - 1) / PAD_CSS;
    return { x: (e.clientX - r.left) * g, y: (e.clientY - r.top) * g };
  };

  // Encoded size, tracked without re-encoding: two chars per point plus one "." between strokes.
  // Matches encodeDoodle exactly (no empty stroke is ever created), and stays O(strokes) rather
  // than O(points) — encodeDoodle() on every pointermove would be quadratic over a long scribble.
  const encodedLen = (): number => {
    let n = 0;
    for (const st of strokes) n += st.length * 2;
    return n + Math.max(0, strokes.length - 1);
  };

  // Room for `cost` more characters? Enforced on BOTH growth paths — a new stroke costs its
  // separator too, and checking only the point path let a flurry of short strokes overshoot.
  const fits = (cost: number): boolean => encodedLen() + cost <= BALANCE.doodle.maxLen;

  const markFull = (): void => {
    full.style.display = fits(3) ? "none" : "block";
  };

  // Skip points that land in the cell we're already on — they'd encode to identical characters and
  // just eat into maxLen.
  const pushPoint = (p: { x: number; y: number }): void => {
    const st = strokes[strokes.length - 1];
    const last = st[st.length - 1];
    if (last && Math.round(last.x) === Math.round(p.x) && Math.round(last.y) === Math.round(p.y)) return;
    if (!fits(2)) return; // full — the pen goes inert rather than the art being truncated later
    st.push(p);
  };

  cv.addEventListener("pointerdown", (e: PointerEvent) => {
    drawing = true;
    // Capture keeps a fast drag that leaves the pad still drawing. Non-fatal if the browser
    // refuses (it throws for a pointer it doesn't consider active) — the stroke still starts.
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* draw without capture */
    }
    if (!fits(strokes.length ? 3 : 2)) {
      drawing = false; // no room for another stroke — don't start one the moves would extend
      markFull();
      return;
    }
    strokes.push([cell(e)]);
    repaint();
  });
  cv.addEventListener("pointermove", (e: PointerEvent) => {
    if (!drawing) return;
    pushPoint(cell(e));
    repaint();
    markFull();
  });
  const endStroke = (): void => {
    drawing = false;
  };
  cv.addEventListener("pointerup", endStroke);
  cv.addEventListener("pointercancel", endStroke);
  cv.addEventListener("pointerleave", endStroke);

  const undo = document.createElement("button");
  undo.className = "btn small dc-undo";
  undo.textContent = "되돌리기";
  undo.addEventListener("click", () => {
    strokes.pop();
    repaint();
    markFull();
  });

  const clear = document.createElement("button");
  clear.className = "btn small dc-clear";
  clear.textContent = "지우기";
  clear.addEventListener("click", () => {
    strokes.length = 0;
    repaint();
    markFull();
  });

  const skip = document.createElement("button");
  skip.className = "btn dc-skip";
  skip.textContent = "건너뛰기";
  skip.addEventListener("click", () => finish(null));

  const send = document.createElement("button");
  send.className = "btn";
  send.textContent = "남기기";
  send.addEventListener("click", () => finish(encodeDoodle(strokes) || null));

  const tools = document.createElement("div");
  tools.className = "dc-tools";
  tools.append(undo, clear);

  const actions = document.createElement("div");
  actions.className = "dc-actions";
  actions.append(skip, send);

  box.replaceChildren(head, sub, cv, full, tools, actions);
  box.style.display = "block";
  publishHitRegions();
}

// No timer closes this. The raid is already finalized when the composer opens (cooldown set, lock
// released, victim out of the defence view), so nothing is waiting on the drawing — take all day.
// It closes only when the raider presses 남기기 or 건너뛰기.
function finish(art: string | null): void {
  const cb = resolveCb;
  resolveCb = null;
  if (el) {
    el.style.display = "none";
    el.replaceChildren();
  }
  publishHitRegions();
  cb?.(art);
}

/** Bounding rect (CSS px) while visible, or null. Consumed by strip.publishHitRegions. */
export function getDoodleComposerRect(): DOMRect | null {
  if (el && resolveCb && el.style.display !== "none") return el.getBoundingClientRect();
  return null;
}
