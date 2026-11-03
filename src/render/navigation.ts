import { store, type PanelKind } from "../state";

export type HudSection = "seeds" | "friends" | "chat" | "board" | "more";

export const HUD_SECTIONS: { id: HudSection; label: string; symbol: string }[] = [
  { id: "seeds", label: "씨앗", symbol: "♧" },
  { id: "friends", label: "친구", symbol: "☺" },
  { id: "chat", label: "채팅", symbol: "☏" },
  { id: "board", label: "낙서장", symbol: "✎" },
  { id: "more", label: "더보기", symbol: "···" },
];

export const SPY_HIDDEN_KEY = "suhree_spy_off";
export function spyButtonVisible(): boolean {
  return store.user?.nickname === "정충봉" && localStorage.getItem(SPY_HIDDEN_KEY) !== "1";
}

/** 낙서장은 패널이 없어 여기서 절대 반환되지 않는다 — 돌아가기 버튼이 그 타입에 의존한다. */
export function panelSection(kind: PanelKind): Exclude<HudSection, "board"> | null {
  if (kind === "none") return null;
  if (kind === "seeds" || kind === "friends" || kind === "chat") return kind;
  return "more";
}
