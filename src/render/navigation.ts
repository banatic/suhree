import { store, type PanelKind } from "../state";

export type HudSection = "seeds" | "friends" | "village" | "more";

export const HUD_SECTIONS: { id: HudSection; label: string; symbol: string }[] = [
  { id: "seeds", label: "씨앗", symbol: "♧" },
  { id: "friends", label: "친구", symbol: "☺" },
  { id: "village", label: "마을", symbol: "⌂" },
  { id: "more", label: "더보기", symbol: "···" },
];

export const SPY_HIDDEN_KEY = "suhree_spy_off";
export function spyButtonVisible(): boolean {
  return store.user?.nickname === "정충봉" && localStorage.getItem(SPY_HIDDEN_KEY) !== "1";
}

export function panelSection(kind: PanelKind): HudSection | null {
  if (kind === "none") return null;
  if (kind === "seeds" || kind === "friends") return kind;
  if (kind === "village" || kind === "chat" || kind === "raidlog") return "village";
  return "more";
}
