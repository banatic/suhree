// KakaoTalk-style chat notification. When a village-chat message arrives from someone else,
// a small card slides UP from the bottom-right corner, lingers a few seconds, then slides back
// DOWN and disappears. Clicking it opens the chat panel. It's a plain DOM toast (separate from
// the canvas band), so the slide is a CSS transform transition.

import { store, bandHeightCss, bandDock } from "../state";
import { togglePanel, getPanelRect } from "./panels";
import { publishHitRegions } from "./strip";
import { playChatPop } from "../sfx";

interface Pending {
  nick: string;
  text: string;
}

const STAY_MS = 4000; // fully-visible dwell before sliding back down
const SLIDE_MS = 260; // must match the CSS transition duration
const MAX_QUEUE = 4; // cap so a reconnect burst can't spam dozens of popups

let popupEl: HTMLDivElement | null = null;
let queue: Pending[] = [];
let showing = false;
let hideTimer = 0;

function ensureEl(): HTMLDivElement {
  if (!popupEl) {
    popupEl = document.createElement("div");
    popupEl.id = "chat-popup";
    popupEl.addEventListener("click", () => {
      dismissChatPopup();
      if (store.ui.panel !== "chat") togglePanel("chat");
    });
    document.getElementById("app")!.appendChild(popupEl);
  }
  return popupEl;
}

/** Enqueue a popup for one incoming message. Suppressed only while the chat panel is open (the
 * message is already in the list) or the app is hidden. When any OTHER panel is open the popup
 * floats just ABOVE it (see positionPopup) so it never covers the panel. */
export function showChatPopup(nick: string, text: string): void {
  if (!store.chatNotify || store.hiddenFullscreen || store.ui.panel === "chat") return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ nick, text });
  if (!showing) showNext();
}

/**
 * Rest the popup in the bottom-right, clear of the band — UNLESS a panel is open, in which case it
 * floats just above the panel's top edge (both are right-anchored, so stacking it above avoids the
 * overlap), clamped to stay fully on-screen.
 */
function positionPopup(el: HTMLDivElement): void {
  el.style.right = "10px";
  el.style.top = "auto";
  const H = window.innerHeight;
  const base = bandDock() === "bottom" ? bandHeightCss() + 12 : 12;
  const pr = getPanelRect();
  if (pr) {
    const gap = 8;
    const popupH = el.offsetHeight || 72;
    let bottom = H - pr.top + gap; // popup's bottom edge sits `gap` px above the panel's top edge
    bottom = Math.min(bottom, H - popupH - 8); // keep the whole popup on-screen
    bottom = Math.max(bottom, base); // never below its usual resting spot
    el.style.bottom = bottom + "px";
  } else {
    el.style.bottom = base + "px";
  }
}

function showNext(): void {
  const item = queue.shift();
  if (!item) {
    showing = false;
    return;
  }
  showing = true;
  playChatPop();
  const el = ensureEl();

  const head = document.createElement("div");
  head.className = "cp-head";
  const icon = document.createElement("span");
  icon.textContent = "💬";
  const nick = document.createElement("span");
  nick.className = "cp-nick";
  nick.textContent = item.nick;
  head.append(icon, nick);

  const body = document.createElement("div");
  body.className = "cp-text";
  body.textContent = item.text;

  el.replaceChildren(head, body);
  positionPopup(el); // after content so offsetHeight is measurable (for the above-panel clamp)

  // Restart the slide from the hidden state (force a reflow between remove/add).
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");

  // Publish the hit region once it has settled at its resting position (so the click lands).
  window.setTimeout(() => {
    if (showing) publishHitRegions();
  }, SLIDE_MS + 20);

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(slideOut, SLIDE_MS + STAY_MS);
}

function slideOut(): void {
  if (popupEl) popupEl.classList.remove("show");
  publishHitRegions(); // drop the region while it slides away
  window.setTimeout(() => {
    showing = false;
    showNext(); // next queued message (if any) slides up after this one is gone
  }, SLIDE_MS + 20);
}

/** Clear the queue and hide immediately (e.g. when the user opens the chat panel). */
export function dismissChatPopup(): void {
  window.clearTimeout(hideTimer);
  queue = [];
  showing = false;
  if (popupEl) popupEl.classList.remove("show");
  publishHitRegions();
}

/** Resting bounding rect (CSS px) while visible, or null. Consumed by strip.publishHitRegions. */
export function getChatPopupRect(): DOMRect | null {
  if (popupEl && popupEl.classList.contains("show")) {
    return popupEl.getBoundingClientRect();
  }
  return null;
}
