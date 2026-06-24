import { remove } from "firebase/database";
import {
  store,
  toast,
  markPanelsDirty,
  bandHeightCss,
  bandDock,
  coins,
  type PanelKind,
  type FriendData,
} from "../state";
import { BALANCE } from "../config/balance";
import { r, paths } from "../firebase/db";
import { serverNow } from "../firebase/time";
import { buyPlotExpansion, buyLevel, buyCosmetic, equipCosmetic } from "../game/shop";
import { levelCost, plotCost, raidSeconds } from "../game/levels";
import { addFriendByCode } from "../friends/add";
import { setNickname } from "../firebase/auth";
import { startRaid } from "../raid/controller";
import { setPreferredMonitor } from "../platform/tauri";
import { publishHitRegions } from "./strip";

let panelEl: HTMLDivElement | null = null;

function ensurePanel(): HTMLDivElement {
  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "panel";
    panelEl.style.display = "none";
    document.getElementById("app")!.appendChild(panelEl);
    // Tick cooldown labels in place (without rebuilding the panel → keeps input focus/text).
    window.setInterval(refreshFriendCooldowns, 500);
  }
  return panelEl;
}

function el(
  tag: string,
  attrs: Record<string, any> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "onclick") e.addEventListener("click", v);
    else if (k === "oninput") e.addEventListener("input", v);
    else if (k === "style") e.setAttribute("style", v);
    else if (k.startsWith("data-")) e.setAttribute(k, v);
    else (e as any)[k] = v;
  }
  for (const ch of children) {
    if (ch == null) continue;
    e.append(typeof ch === "string" ? document.createTextNode(ch) : ch);
  }
  return e;
}

export function togglePanel(kind: PanelKind): void {
  store.ui.panel = store.ui.panel === kind ? "none" : kind;
  renderPanels();
  publishHitRegions();
}

function header(title: string): HTMLElement {
  return el(
    "div",
    { class: "panel-head" },
    el("span", {}, title),
    el("button", { class: "x", onclick: () => togglePanel(store.ui.panel) }, "✕"),
  );
}

function row(...kids: (Node | string)[]): HTMLElement {
  return el("div", { class: "row" }, ...kids);
}

function btn(label: string, onclick: () => void, cls = "btn"): HTMLElement {
  return el("button", { class: cls, onclick }, label);
}

// ── Panels ───────────────────────────────────────────────────────────────────

function shopPanel(): HTMLElement {
  const uid = store.uid;
  const u = store.user;
  const wrap = el("div", { class: "panel-body" });
  wrap.append(el("div", { class: "muted" }, "씨앗은 밭의 빈 칸을 눌러 심어요. 아래로 강화/확장하세요."));

  // seeds info
  const seeds = el("div", { class: "card" }, el("div", { class: "card-title" }, "씨앗"));
  for (const t of BALANCE.crops.tiers) {
    seeds.append(
      row(
        el("span", { class: "dot", style: `background:${t.color}` }),
        el("span", { class: "grow" }, `${t.label}`),
        el("span", { class: "muted" }, `씨 ${t.price} · 수확 ${t.harvestValue}`),
        btn("선택", () => {
          store.selectedSeedTier = t.id;
          toast(`씨앗 선택: ${t.label}`);
          renderPanels();
        }),
      ),
    );
  }
  wrap.append(seeds);

  // plot expansion
  if (u) {
    const pcost = plotCost(u.plotSize);
    wrap.append(
      el(
        "div",
        { class: "card" },
        el("div", { class: "card-title" }, "밭 확장"),
        row(
          el("span", { class: "grow" }, `현재 ${u.plotSize}칸 / 최대 ${BALANCE.shop.plotExpansion.maxSlots}`),
          u.plotSize >= BALANCE.shop.plotExpansion.maxSlots
            ? el("span", { class: "muted" }, "최대")
            : btn(`+1칸 (${pcost})`, () => void buyPlotExpansion(uid)),
        ),
      ),
    );

    // scarecrow (defense)
    const scCost = levelCost("scarecrow", u.scarecrowLv);
    const defT = raidSeconds(u.scarecrowLv, 0);
    wrap.append(
      el(
        "div",
        { class: "card" },
        el("div", { class: "card-title" }, "허수아비 (방어)"),
        row(
          el("span", { class: "grow" }, `Lv ${u.scarecrowLv} · 내 밭 기본 T≈${defT.toFixed(1)}s`),
          btn(`강화 (${scCost})`, () => void buyLevel(uid, "scarecrow")),
        ),
      ),
    );

    // scythe (attack)
    const syCost = levelCost("scythe", u.scytheLv);
    const atkT = raidSeconds(0, u.scytheLv);
    wrap.append(
      el(
        "div",
        { class: "card" },
        el("div", { class: "card-title" }, "낫 (공격)"),
        row(
          el("span", { class: "grow" }, `Lv ${u.scytheLv} · 무방비 상대 T≈${atkT.toFixed(1)}s`),
          btn(`강화 (${syCost})`, () => void buyLevel(uid, "scythe")),
        ),
      ),
    );
  }
  return wrap;
}

function friendsPanel(): HTMLElement {
  const uid = store.uid;
  const wrap = el("div", { class: "panel-body" });
  wrap.append(
    el("div", { class: "muted" }, `내 친구코드: `, el("b", {}, store.user?.friendCode || "...")),
  );

  let codeVal = "";
  const input = el("input", {
    class: "input",
    placeholder: "친구코드 입력 (예: ABC123)",
    maxLength: 8,
    oninput: (e: any) => (codeVal = e.target.value),
  });
  wrap.append(row(input, btn("추가", () => void addFriendByCode(uid, codeVal))));

  const list = el("div", { class: "card" }, el("div", { class: "card-title" }, "친구"));
  if (store.friends.length === 0) {
    list.append(el("div", { class: "muted" }, "아직 친구가 없어요."));
  }
  for (const f of store.friends) {
    const st = friendRaidState(f);
    list.append(
      row(
        el("span", { class: "dot", style: `background:${f.online ? "#5fd07a" : "#777"}` }),
        el("span", { class: "grow" }, f.nickname),
        el(
          "button",
          { class: st.cls, "data-fuid": f.uid, onclick: () => void startRaid(f.uid, f.nickname) },
          st.label,
        ),
      ),
    );
  }
  wrap.append(list);
  return wrap;
}

// ── Cooldown display (single source of truth: f.cooldownUntil in server-clock ms) ──────

function cooldownLeftMs(f: FriendData): number {
  return Math.max(0, (f.cooldownUntil ?? 0) - serverNow());
}

function fmtCooldown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${s}s`;
}

function friendRaidState(f: FriendData): { label: string; cls: string } {
  const left = cooldownLeftMs(f);
  const onCooldown = left > 0;
  const canRaid = f.online && !onCooldown && store.raid.role === "none";
  let label = "털기";
  if (!f.online) label = "오프라인";
  else if (onCooldown) label = `쿨다운 ${fmtCooldown(left)}`;
  else if (store.raid.role !== "none") label = "진행중";
  return { label, cls: canRaid ? "btn danger" : "btn off" };
}

/** Update only the raid buttons in place (every 0.5s) so countdowns tick and re-enable live. */
function refreshFriendCooldowns(): void {
  if (!panelEl || store.ui.panel !== "friends" || panelEl.style.display === "none") return;
  const btns = panelEl.querySelectorAll<HTMLButtonElement>("button[data-fuid]");
  btns.forEach((b) => {
    const fuid = b.getAttribute("data-fuid");
    const f = store.friends.find((x) => x.uid === fuid);
    if (!f) return;
    const st = friendRaidState(f);
    if (b.textContent !== st.label) b.textContent = st.label;
    if (b.className !== st.cls) b.className = st.cls;
  });
}

function messagesPanel(): HTMLElement {
  const wrap = el("div", { class: "panel-body" });
  if (store.messages.length === 0) {
    wrap.append(el("div", { class: "muted" }, "도둑이 남긴 쪽지가 없어요. (평화롭네요!)"));
  } else {
    wrap.append(btn("모두 지우기", () => void remove(r(paths.messages(store.uid))), "btn small"));
    for (const m of store.messages) {
      wrap.append(
        el(
          "div",
          { class: `card msg ${m.skin || "skin_plain"}` },
          el("div", { class: "msg-text" }, `“${m.text}”`),
          el("div", { class: "muted small" }, new Date(m.at).toLocaleString()),
        ),
      );
    }
  }
  return wrap;
}

function cosmeticsPanel(): HTMLElement {
  const uid = store.uid;
  const u = store.user;
  const wrap = el("div", { class: "panel-body" });

  const decor = el("div", { class: "card" }, el("div", { class: "card-title" }, "밭 꾸미기"));
  for (const d of BALANCE.cosmetics.decor) {
    const owned = d.price === 0 || u?.cosmetics?.[d.id];
    const equipped = u?.equippedDecor === d.id;
    decor.append(
      row(
        el("span", { class: "grow" }, d.label),
        equipped
          ? el("span", { class: "muted" }, "착용중")
          : owned
            ? btn("착용", () => void equipCosmetic(uid, "decor", d.id))
            : btn(`구매 (${d.price})`, () => void buyCosmetic(uid, "decor", d.id, d.price)),
      ),
    );
  }
  wrap.append(decor);

  const skin = el("div", { class: "card" }, el("div", { class: "card-title" }, "쪽지 스킨 (서리 시)"));
  for (const s of BALANCE.cosmetics.msgSkin) {
    const owned = s.price === 0 || u?.cosmetics?.[s.id];
    const equipped = u?.equippedMsgSkin === s.id;
    skin.append(
      row(
        el("span", { class: "grow" }, s.label),
        equipped
          ? el("span", { class: "muted" }, "사용중")
          : owned
            ? btn("사용", () => void equipCosmetic(uid, "msgSkin", s.id))
            : btn(`구매 (${s.price})`, () => void buyCosmetic(uid, "msgSkin", s.id, s.price)),
      ),
    );
  }
  wrap.append(skin);
  return wrap;
}

function settingsPanel(): HTMLElement {
  const uid = store.uid;
  const wrap = el("div", { class: "panel-body" });

  let nickDraft = store.user?.nickname ?? "";
  const nickInput = el("input", {
    class: "input",
    placeholder: "닉네임",
    maxLength: 16,
    value: nickDraft,
    oninput: (e: any) => (nickDraft = e.target.value),
  });
  wrap.append(
    el("div", { class: "card" },
      el("div", { class: "card-title" }, "닉네임 변경"),
      row(
        nickInput,
        btn("저장", () => {
          void setNickname(uid, nickDraft);
          localStorage.setItem("suhree_nick", nickDraft.trim().slice(0, 16));
          toast("닉네임을 바꿨어요");
        }),
      ),
    ),
  );

  wrap.append(
    el("div", { class: "card" },
      el("div", { class: "card-title" }, "스트립 위치"),
      row(
        btn("주 모니터", () => void setPreferredMonitor("primary"), "btn"),
        btn("커서 모니터", () => void setPreferredMonitor("cursor"), "btn"),
      ),
    ),
  );
  wrap.append(
    el("div", { class: "card" },
      el("div", { class: "card-title" }, "내 정보"),
      el("div", {}, `닉네임: ${store.user?.nickname ?? ""}`),
      el("div", {}, `친구코드: ${store.user?.friendCode ?? ""}`),
      el("div", { class: "muted small" }, `코인: ${coins()}`),
    ),
  );
  return wrap;
}

const TITLES: Record<PanelKind, string> = {
  none: "",
  shop: "상점",
  friends: "친구",
  messages: "쪽지함",
  cosmetics: "꾸미기",
  settings: "설정",
};

export function renderPanels(): void {
  const p = ensurePanel();
  const kind = store.ui.panel;
  if (kind === "none") {
    p.style.display = "none";
    p.replaceChildren();
    return;
  }
  p.replaceChildren(header(TITLES[kind]));
  let body: HTMLElement;
  switch (kind) {
    case "shop":
      body = shopPanel();
      break;
    case "friends":
      body = friendsPanel();
      break;
    case "messages":
      body = messagesPanel();
      break;
    case "cosmetics":
      body = cosmeticsPanel();
      break;
    case "settings":
      body = settingsPanel();
      break;
    default:
      body = el("div");
  }
  p.append(body);
  positionPanel(p);
  p.style.display = "block";
}

function positionPanel(p: HTMLDivElement): void {
  const dock = bandDock();
  const bandH = bandHeightCss();
  p.style.position = "fixed";
  p.style.right = "10px";
  if (dock === "bottom") {
    p.style.bottom = bandH + 8 + "px";
    p.style.top = "auto";
  } else {
    p.style.top = bandH + 8 + "px";
    p.style.bottom = "auto";
  }
  p.style.maxHeight = Math.max(120, window.innerHeight - bandH - 20) + "px";
}

/** Bounding rect (CSS px) of the open panel, or null. Consumed by strip.publishHitRegions. */
export function getPanelRect(): DOMRect | null {
  if (panelEl && store.ui.panel !== "none" && panelEl.style.display !== "none") {
    return panelEl.getBoundingClientRect();
  }
  return null;
}
