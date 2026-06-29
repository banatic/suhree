// KakaoTalk-style chat notification. When a village-chat message arrives from someone else,
// a small card slides UP from the bottom-right corner, lingers a few seconds, then slides back
// DOWN and disappears. Clicking it opens the chat panel. It's a plain DOM toast (separate from
// the canvas band), so the slide is a CSS transform transition.

import { store, bandHeightCss, bandDock } from "../state";
import { togglePanel } from "./panels";
import { publishHitRegions } from "./strip";

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

/** Enqueue a popup for one incoming message. Suppressed while the chat is open or hidden. */
export function showChatPopup(nick: string, text: string): void {
  if (!store.chatNotify || store.hiddenFullscreen || store.ui.panel === "chat") return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ nick, text });
  if (!showing) showNext();
}

function showNext(): void {
  const item = queue.shift();
  if (!item) {
    showing = false;
    return;
  }
  showing = true;
  const el = ensureEl();

  // Anchor to the bottom-right, clear of the band (the dock can be top or bottom).
  el.style.right = "10px";
  el.style.bottom = (bandDock() === "bottom" ? bandHeightCss() + 12 : 12) + "px";
  el.style.top = "auto";

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
