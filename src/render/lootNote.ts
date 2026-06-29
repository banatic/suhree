// Parting-note composer. After a raid that looted at least one crop, the raider may hand-write a
// short note that lands in the victim's 쪽지함 — or skip it. It's a DOM card at the bottom-right
// (the band itself is a thin canvas strip), registered as a hit region so its textarea is
// clickable/typable through the Tauri click-through overlay.

import { bandHeightCss, bandDock } from "../state";
import { BALANCE } from "../config/balance";
import { publishHitRegions } from "./strip";

let el: HTMLDivElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let resolveCb: ((text: string | null) => void) | null = null;
let autoTimer = 0;

// An abandoned composer auto-sends whatever's typed, then lets the raid finalize. Kept well under
// lockStaleMs (130s) so the raid lock can't hang while the note is being written.
const AUTO_MS = 20000;

function ensureEl(): HTMLDivElement {
  if (!el) {
    el = document.createElement("div");
    el.id = "loot-note";
    document.getElementById("app")!.appendChild(el);
  }
  return el;
}

/**
 * Show the composer. `done` is invoked exactly once with the note text (to send) or null (skip).
 * `suggestion` pre-fills + selects the field so a quick Enter sends it, or the raider types over it.
 */
export function promptLootNote(
  targetNick: string,
  looted: number,
  suggestion: string,
  done: (text: string | null) => void,
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
  head.className = "ln-head";
  head.textContent = "쪽지 남기기";

  const sub = document.createElement("div");
  sub.className = "ln-sub";
  sub.textContent = `${targetNick}님의 밭에서 +${looted} 코인! 한마디 남겨볼까요?`;

  inputEl = document.createElement("textarea");
  inputEl.className = "ln-input";
  inputEl.rows = 2;
  inputEl.maxLength = BALANCE.raid.messageMaxLen;
  inputEl.value = suggestion;
  inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish(inputEl ? inputEl.value : null);
    }
  });

  const skip = document.createElement("button");
  skip.className = "btn ln-skip";
  skip.textContent = "건너뛰기";
  skip.addEventListener("click", () => finish(null));

  const send = document.createElement("button");
  send.className = "btn";
  send.textContent = "보내기";
  send.addEventListener("click", () => finish(inputEl ? inputEl.value : null));

  const actions = document.createElement("div");
  actions.className = "ln-actions";
  actions.append(skip, send);

  box.replaceChildren(head, sub, inputEl, actions);
  box.style.display = "block";
  publishHitRegions();

  setTimeout(() => {
    inputEl?.focus();
    inputEl?.select();
  }, 0);

  window.clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => finish(inputEl ? inputEl.value : null), AUTO_MS);
}

function finish(text: string | null): void {
  window.clearTimeout(autoTimer);
  const cb = resolveCb;
  resolveCb = null;
  inputEl = null;
  if (el) {
    el.style.display = "none";
    el.replaceChildren();
  }
  publishHitRegions();
  cb?.(text);
}

/** Bounding rect (CSS px) while visible, or null. Consumed by strip.publishHitRegions. */
export function getLootNoteRect(): DOMRect | null {
  if (el && resolveCb && el.style.display !== "none") {
    return el.getBoundingClientRect();
  }
  return null;
}
