// The 낙서 card a weed carries. Hovering a weed in your own plot floats the raider's drawing just
// off the band, so you finally get to see what the person who griefed you left behind.
//
// It's a DOM element rather than canvas art because the band is only ~48 logical px tall — there is
// no room inside it for a readable card. It is deliberately NOT registered as a hit region: the
// pointer stays on the weed (which already is one) and the card is pure decoration floating over the
// click-through area, so it can never steal the click that pulls the weed.

import { bandHeightCss, bandDock, type WeedData } from "../state";
import { drawDoodle } from "../game/doodle";

const CARD = 96; // drawing box, CSS px (square)

let el: HTMLDivElement | null = null;
let shownKey = ""; // slot + art currently rendered, so a hover hold doesn't repaint every frame

function ensureEl(): HTMLDivElement {
  if (!el) {
    el = document.createElement("div");
    el.id = "doodle-card";
    document.getElementById("app")!.appendChild(el);
  }
  return el;
}

/** Show the card for `weed` centred on band x-coordinate `cx` (CSS px). No-op without art. */
export function showDoodleCard(slotKey: string, weed: WeedData, cx: number): void {
  if (!weed.art) return hideDoodleCard();
  const key = slotKey + "|" + weed.art + "|" + Math.round(cx);
  if (key === shownKey) return;
  shownKey = key;

  const box = ensureEl();
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.className = "dcard-art";
  cv.width = Math.round(CARD * dpr);
  cv.height = Math.round(CARD * dpr);
  cv.style.width = CARD + "px";
  cv.style.height = CARD + "px";
  const c = cv.getContext("2d")!;
  c.scale(dpr, dpr);
  drawDoodle(c, weed.art, 0, 0, CARD, "#3a2a17", 2);

  const who = document.createElement("div");
  who.className = "dcard-who";
  who.textContent = `${weed.nick || "누군가"}님이 남김`;

  // The card wears the planter's equipped card skin (the old 쪽지 스킨, repurposed) as its paper —
  // styled off the data attribute so the existing per-skin CSS keeps working unchanged.
  box.dataset.skin = weed.cardSkin || "skin_plain";
  box.replaceChildren(cv, who);
  box.style.display = "block";

  // Measure, then place: centred on the weed, clamped on-screen, on the far side of the band.
  const w = box.offsetWidth || CARD + 16;
  box.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, cx - w / 2)) + "px";
  if (bandDock() === "bottom") {
    box.style.bottom = bandHeightCss() + 10 + "px";
    box.style.top = "auto";
  } else {
    box.style.top = bandHeightCss() + 10 + "px";
    box.style.bottom = "auto";
  }
}

export function hideDoodleCard(): void {
  if (!shownKey) return;
  shownKey = "";
  if (el) {
    el.style.display = "none";
    el.replaceChildren();
  }
}
