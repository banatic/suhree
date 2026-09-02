// 낙서장 — every farm's own wall. The chest in the raid view opens the VICTIM's board, so a raid is
// how you leave someone a drawing; the HUD chip opens your own, to see what visitors left you. Each
// scribble is stored on its own so several raiders can add to the same wall at once without
// overwriting each other, and every author gets a stable ink colour so a wall reads as many hands.
//
// A standalone DOM overlay rather than a PanelKind: panels are rebuilt wholesale on markPanelsDirty
// (which fires constantly during a raid), and a rebuild would wipe strokes mid-drawing.

import { bandHeightCss, bandDock, store, toast } from "../state";
import { BALANCE } from "../config/balance";
import {
  BOARD,
  drawStrokes,
  decodeStrokes,
  encodeStrokes,
  encodedLength,
  pointCost,
  inkColor,
  type Stroke,
} from "../game/doodle";
import { subscribeBoard, postToBoard, eraseFromBoard, type BoardEntry } from "../firebase/board";
import { publishHitRegions } from "./strip";
import { playClick } from "../sfx";

let el: HTMLDivElement | null = null;
let unsub: (() => void) | null = null;
let entries: BoardEntry[] = [];
let mine: Stroke[] = [];
let repaint: (() => void) | null = null;
let refreshMeta: (() => void) | null = null;
let owner = ""; // whose wall is on screen

const PEN_W = 2;

export function isBoardOpen(): boolean {
  return !!el && el.style.display !== "none";
}

/** The uid whose wall is open, or "" when none is. */
export function openBoardOwner(): string {
  return isBoardOpen() ? owner : "";
}

/** Bounding rect (CSS px) while open, or null. Consumed by strip.publishHitRegions. */
export function getBoardRect(): DOMRect | null {
  return isBoardOpen() ? el!.getBoundingClientRect() : null;
}

export function closeBoard(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  entries = [];
  mine = [];
  owner = "";
  repaint = null;
  refreshMeta = null;
  if (el) {
    el.style.display = "none";
    el.replaceChildren();
  }
  publishHitRegions();
}

/** Open `ownerUid`'s wall, or close it if that same wall is already the one on screen. */
export function toggleBoard(ownerUid: string, ownerNick: string): void {
  if (openBoardOwner() === ownerUid) closeBoard();
  else openBoard(ownerUid, ownerNick);
}

export function openBoard(ownerUid: string, ownerNick: string): void {
  if (!ownerUid) return;
  if (isBoardOpen()) closeBoard(); // switching walls — never blend two farms' scribbles
  if (!el) {
    el = document.createElement("div");
    el.id = "doodle-board";
    document.getElementById("app")!.appendChild(el);
  }
  const box = el;
  owner = ownerUid;
  mine = [];
  entries = [];
  const isMine = ownerUid === store.uid;

  // Provisional size; the real one is computed from the measured chrome once the box is in the DOM
  // (see fitToWindow below). Sized to the lattice's aspect so nothing is ever stretched.
  let cssW = Math.min(BOARD.w * 2, window.innerWidth - 40);
  let cssH = Math.round((cssW * BOARD.h) / BOARD.w);

  const head = document.createElement("div");
  head.className = "db-head";
  const title = document.createElement("span");
  title.textContent = isMine ? "🧰 내 낙서장" : `🧰 ${ownerNick || "농부"}님의 낙서장`;
  const close = document.createElement("button");
  close.className = "btn small db-close";
  close.textContent = "닫기";
  close.addEventListener("click", () => {
    playClick();
    closeBoard();
  });
  head.append(title, close);

  const meta = document.createElement("div");
  meta.className = "db-meta";

  const cv = document.createElement("canvas");
  cv.className = "db-pad";
  const c = cv.getContext("2d")!;

  // Apply the current cssW/cssH to the canvas, re-establishing the devicePixelRatio transform (a
  // width/height assignment resets the context state, so the scale has to be re-applied every time).
  const sizePad = (): void => {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.scale(dpr, dpr);
  };
  sizePad();

  const myInk = inkColor(store.uid || "me");

  repaint = (): void => {
    c.clearRect(0, 0, cssW, cssH);
    for (const e of entries) {
      drawStrokes(c, decodeStrokes(e.art, BOARD), BOARD, 0, 0, cssW, cssH, inkColor(e.uid), PEN_W);
    }
    // My in-progress strokes sit on top, in my own ink, so I can see what I'm adding.
    drawStrokes(c, mine, BOARD, 0, 0, cssW, cssH, myInk, PEN_W);
  };

  refreshMeta = (): void => {
    const authors = new Set(entries.map((e) => e.uid));
    const used = encodedLength(mine, BOARD);
    const room = used >= BALANCE.doodle.board.maxLen - pointCost(BOARD);
    const filled = room ? " · 내 낙서가 가득 찼어요" : "";
    meta.textContent = entries.length
      ? `${authors.size}명이 ${entries.length}개를 남겼어요` + filled
      : isMine
        ? "아직 아무도 안 남겼어요. 서리하러 온 손님이 그려줄 거예요!"
        : "아직 비어 있어요. 첫 낙서를 남겨보세요!";
    meta.classList.toggle("full", room);
  };

  // ── drawing ────────────────────────────────────────────────────────────────
  let drawing = false;
  const cell = (e: PointerEvent): { x: number; y: number } => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / cssW) * (BOARD.w - 1), y: ((e.clientY - r.top) / cssH) * (BOARD.h - 1) };
  };
  const fits = (cost: number): boolean => encodedLength(mine, BOARD) + cost <= BALANCE.doodle.board.maxLen;

  cv.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!fits(mine.length ? pointCost(BOARD) + 1 : pointCost(BOARD))) {
      drawing = false; // no room for another stroke — don't start one the moves would extend
      refreshMeta?.();
      return;
    }
    drawing = true;
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* draw without capture */
    }
    mine.push([cell(e)]);
    repaint?.();
  });
  cv.addEventListener("pointermove", (e: PointerEvent) => {
    if (!drawing) return;
    const p = cell(e);
    const st = mine[mine.length - 1];
    const last = st[st.length - 1];
    if (last && Math.round(last.x) === Math.round(p.x) && Math.round(last.y) === Math.round(p.y)) return;
    if (!fits(pointCost(BOARD))) {
      refreshMeta?.();
      return;
    }
    st.push(p);
    repaint?.();
    refreshMeta?.();
  });
  const endStroke = (): void => {
    drawing = false;
  };
  cv.addEventListener("pointerup", endStroke);
  cv.addEventListener("pointercancel", endStroke);
  cv.addEventListener("pointerleave", endStroke);

  // ── buttons ────────────────────────────────────────────────────────────────
  const undo = document.createElement("button");
  undo.className = "btn small";
  undo.textContent = "되돌리기";
  undo.addEventListener("click", () => {
    mine.pop();
    repaint?.();
    refreshMeta?.();
  });

  const clear = document.createElement("button");
  clear.className = "btn small";
  clear.textContent = "지우기";
  clear.addEventListener("click", () => {
    mine = [];
    repaint?.();
    refreshMeta?.();
  });

  // On my own wall this wipes everything (a board strangers can draw on needs an owner who can
  // clear it); on someone else's the rule only lets me take back what I drew.
  const erase = document.createElement("button");
  erase.className = "btn small db-erase";
  erase.textContent = isMine ? "낙서장 비우기" : "내 낙서 지우기";
  erase.addEventListener("click", () => {
    erase.disabled = true;
    void eraseFromBoard(ownerUid).then((n) => {
      erase.disabled = false;
      toast(n ? `낙서 ${n}개를 지웠어요` : "지울 낙서가 없어요");
    });
  });

  const post = document.createElement("button");
  post.className = "btn";
  post.textContent = "남기기";
  post.addEventListener("click", () => {
    const art = encodeStrokes(mine, BOARD);
    if (!art) {
      toast("먼저 뭔가 그려보세요");
      return;
    }
    post.disabled = true;
    void postToBoard(ownerUid, art).then((ok) => {
      post.disabled = false;
      if (!ok) {
        toast("낙서를 남기지 못했어요");
        return;
      }
      // Cleared once it's on the wall — the live subscription paints it back as a posted entry.
      mine = [];
      repaint?.();
      refreshMeta?.();
      playClick();
    });
  });

  const tools = document.createElement("div");
  tools.className = "db-tools";
  tools.append(undo, clear, erase, post);

  box.replaceChildren(head, meta, cv, tools);
  box.style.display = "block";
  refreshMeta(); // fill the caption BEFORE measuring — an empty one under-reports the chrome height

  // The overlay window is only ~480 logical px tall (the band at one edge, transparent panel space
  // for the rest), and at the lattice's natural 512×320 the board came out TALLER than the space
  // left above the band — so it opened with its title bar and 닫기 button clipped off the top edge,
  // and on a scaled display it could be pushed off screen almost entirely. Measure the chrome
  // (header + meta + tools + padding) against the real window and shrink the pad to fit.
  const GAP = 10; // clearance from the band
  const MARGIN = 8; // breathing room at the far edge
  const MIN_PAD = 120; // below this the wall stops being worth drawing on
  const limit = window.innerHeight - bandHeightCss() - GAP - MARGIN;
  // Shrink-and-remeasure rather than subtracting a measured chrome height once: narrowing the pad
  // can rewrap the caption onto a second line, which makes the chrome TALLER than it measured. Two
  // passes is the normal case; the loop is bounded and stops as soon as it stops shrinking.
  for (let i = 0; i < 4 && box.offsetHeight > limit; i++) {
    const next = Math.max(MIN_PAD, cssH - (box.offsetHeight - limit));
    if (next === cssH) break;
    cssH = next;
    cssW = Math.round((cssH * BOARD.w) / BOARD.h);
    sizePad();
  }

  // Centred horizontally, resting just clear of the band on its own side.
  box.style.left = Math.max(6, Math.round((window.innerWidth - box.offsetWidth) / 2)) + "px";
  if (bandDock() === "bottom") {
    box.style.bottom = bandHeightCss() + GAP + "px";
    box.style.top = "auto";
  } else {
    box.style.top = bandHeightCss() + GAP + "px";
    box.style.bottom = "auto";
  }

  repaint();
  publishHitRegions();

  unsub = subscribeBoard(ownerUid, (list) => {
    entries = list;
    repaint?.();
    refreshMeta?.();
  });
}
