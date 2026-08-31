// 공용 낙서장 — the big shared wall, opened by clicking the chest in the raid view. Everyone draws
// on the same surface; each scribble is stored on its own so several people can add to the wall at
// once without overwriting each other, and every author gets a stable ink colour so the wall reads
// as many hands rather than one.
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
import { subscribeBoard, postToBoard, eraseMyBoardEntries, type BoardEntry } from "../firebase/board";
import { publishHitRegions } from "./strip";
import { playClick } from "../sfx";

let el: HTMLDivElement | null = null;
let unsub: (() => void) | null = null;
let entries: BoardEntry[] = [];
let mine: Stroke[] = [];
let repaint: (() => void) | null = null;
let refreshMeta: (() => void) | null = null;

const PEN_W = 2;

export function isBoardOpen(): boolean {
  return !!el && el.style.display !== "none";
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
  repaint = null;
  refreshMeta = null;
  if (el) {
    el.style.display = "none";
    el.replaceChildren();
  }
  publishHitRegions();
}

export function toggleBoard(): void {
  if (isBoardOpen()) closeBoard();
  else openBoard();
}

export function openBoard(): void {
  if (isBoardOpen()) return;
  if (!el) {
    el = document.createElement("div");
    el.id = "doodle-board";
    document.getElementById("app")!.appendChild(el);
  }
  const box = el;
  mine = [];
  entries = [];

  // Sized to the lattice's aspect so nothing is stretched, and clamped to the window on small screens.
  const cssW = Math.min(BOARD.w * 2, window.innerWidth - 40);
  const cssH = Math.round((cssW * BOARD.h) / BOARD.w);

  const head = document.createElement("div");
  head.className = "db-head";
  const title = document.createElement("span");
  title.textContent = "🧰 공용 낙서장";
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

  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.className = "db-pad";
  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  cv.style.width = cssW + "px";
  cv.style.height = cssH + "px";
  const c = cv.getContext("2d")!;
  c.scale(dpr, dpr);

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
    meta.textContent = entries.length
      ? `${authors.size}명이 ${entries.length}개를 남겼어요` + (room ? " · 내 낙서가 가득 찼어요" : "")
      : "아직 아무도 안 그렸어요. 첫 낙서를 남겨보세요!";
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

  const eraseMine = document.createElement("button");
  eraseMine.className = "btn small db-erase";
  eraseMine.textContent = "내 낙서 지우기";
  eraseMine.addEventListener("click", () => {
    eraseMine.disabled = true;
    void eraseMyBoardEntries().then((n) => {
      eraseMine.disabled = false;
      toast(n ? `내 낙서 ${n}개를 지웠어요` : "지울 내 낙서가 없어요");
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
    void postToBoard(art).then((ok) => {
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
  tools.append(undo, clear, eraseMine, post);

  box.replaceChildren(head, meta, cv, tools);
  box.style.display = "block";

  // Centred horizontally, resting just clear of the band on its own side.
  box.style.left = Math.max(6, Math.round((window.innerWidth - box.offsetWidth) / 2)) + "px";
  if (bandDock() === "bottom") {
    box.style.bottom = bandHeightCss() + 10 + "px";
    box.style.top = "auto";
  } else {
    box.style.top = bandHeightCss() + 10 + "px";
    box.style.bottom = "auto";
  }

  repaint();
  refreshMeta();
  publishHitRegions();

  unsub = subscribeBoard((list) => {
    entries = list;
    repaint?.();
    refreshMeta?.();
  });
}
