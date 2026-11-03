import { coins, currentToast, formatCoins, store } from "../state";
import { BALANCE } from "../config/balance";
import { HUD_SECTIONS, panelSection, type HudSection } from "./navigation";
import { COIN, drawSprite } from "./sprites";

let hud: HTMLElement | null = null;
let visible = false;
let pointerInside = false;
let contentKey = "";
let layoutKey = "";
let balance: HTMLElement;
let seedLabel: HTMLElement;
let villageBadge: HTMLElement;
let announcement: HTMLElement;
const buttons = new Map<HudSection, HTMLButtonElement>();

export function hudHeight(): number {
  return window.innerWidth <= 480 ? 90 : 54;
}

export function hudHasFocus(): boolean {
  return document.hasFocus() && !!hud?.contains(document.activeElement) && !!document.activeElement?.matches(":focus-visible");
}

export function clearHudPointer(): void { pointerInside = false; }

export function hudHasPointer(): boolean {
  return pointerInside;
}

export function focusHud(section: HudSection = "seeds"): void {
  buttons.get(section)?.focus({ preventScroll: true });
}

export function setupHud(onNavigate: (section: HudSection) => void, onInteraction: () => void): void {
  if (hud) return;
  hud = document.createElement("nav");
  hud.id = "farm-hud";
  hud.setAttribute("aria-label", "농장 메뉴");
  const wallet = document.createElement("div");
  wallet.className = "hud-wallet";
  const coin = document.createElement("canvas");
  coin.width = 21;
  coin.height = 21;
  coin.setAttribute("aria-hidden", "true");
  const context = coin.getContext("2d");
  if (context) drawSprite(context, COIN, 0, 0, 3);
  balance = document.createElement("span");
  wallet.append(coin, balance);
  hud.append(wallet);
  for (const section of HUD_SECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.section = section.id;
    button.setAttribute("aria-controls", "panel");
    const symbol = document.createElement("span");
    symbol.className = "hud-symbol";
    symbol.textContent = section.symbol;
    symbol.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "hud-label";
    label.textContent = section.label;
    if (section.id === "seeds") seedLabel = label;
    button.append(symbol, label);
    if (section.id === "village") {
      villageBadge = document.createElement("span");
      villageBadge.className = "hud-unread";
      villageBadge.setAttribute("aria-label", "새 채팅");
      villageBadge.textContent = "새 소식";
      button.append(villageBadge);
    }
    button.addEventListener("click", () => onNavigate(section.id));
    buttons.set(section.id, button);
    hud.append(button);
  }
  hud.addEventListener("mouseenter", () => { pointerInside = true; onInteraction(); });
  hud.addEventListener("mouseleave", () => { pointerInside = false; onInteraction(); });
  hud.addEventListener("focusin", onInteraction);
  hud.addEventListener("focusout", () => queueMicrotask(onInteraction));
  document.getElementById("app")!.append(hud);
  announcement = document.createElement("div");
  announcement.className = "sr-only";
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  document.getElementById("app")!.append(announcement);
}

/** Stable DOM nodes keep keyboard focus while coin / chat / crop snapshots update. */
export function syncHud(show: boolean, dock: "top" | "bottom", bandHeight: number): void {
  if (!hud) return;
  const message = currentToast() ?? "";
  if (announcement.textContent !== message) announcement.textContent = message;
  visible = show;
  hud.classList.toggle("is-open", show);
  hud.setAttribute("aria-hidden", String(!show));
  hud.inert = !show;
  const nextLayout = `${dock}|${bandHeight}|${window.innerWidth}`;
  if (layoutKey !== nextLayout) {
    layoutKey = nextLayout;
    hud.style.top = dock === "top" ? `${bandHeight + 4}px` : "auto";
    hud.style.bottom = dock === "bottom" ? `${bandHeight + 4}px` : "auto";
  }
  const nextKey = `${coins()}|${store.selectedSeedTier}|${store.ui.panel}|${store.chatUnread}`;
  if (contentKey === nextKey) return;
  contentKey = nextKey;
  balance.textContent = formatCoins(coins());
  balance.parentElement!.setAttribute("aria-label", `보유 ${formatCoins(coins())} 코인`);
  const seed = BALANCE.crops.tiers[store.selectedSeedTier]?.label ?? "무";
  seedLabel.textContent = `씨앗 · ${seed}`;
  buttons.get("seeds")!.title = `선택한 씨앗: ${seed}`;
  villageBadge.hidden = !store.chatUnread;
  for (const [section, button] of buttons) {
    const active = panelSection(store.ui.panel) === section;
    button.setAttribute("aria-expanded", String(active));
    button.classList.toggle("is-active", active);
  }
}

export function getHudRect(): DOMRect | null {
  return visible && hud ? hud.getBoundingClientRect() : null;
}
