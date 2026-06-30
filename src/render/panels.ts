import { remove, get } from "firebase/database";
import {
  store,
  toast,
  markPanelsDirty,
  bandHeightCss,
  bandDock,
  coins,
  setChatNotify,
  type PanelKind,
  type FriendData,
  type ChatMessage,
} from "../state";
import { BALANCE } from "../config/balance";
import { r, paths } from "../firebase/db";
import { serverNow } from "../firebase/time";
import { buyPlotExpansion, buyLevel, buyCosmetic, equipCosmetic, type CosmeticType } from "../game/shop";
import { cosmeticOwned, lockReason } from "../game/unlocks";
import { renderFarmPreview } from "./farmPreview";
import { drawGhostCursor } from "./cursorGhost";
import { cursorSkin } from "./cursorArt";
import { createTrail } from "./cursorTrail";
import type { CosmeticItem } from "../config/balance";
import { levelCost, plotCost, cropClicksToSteal, evictHitsNeeded } from "../game/levels";
import { addFriendByCode } from "../friends/add";
import { setNickname } from "../firebase/auth";
import { startRaid } from "../raid/controller";
import { sendChat } from "../firebase/chat";
import { setPreferredMonitor, hideStrip, isTauri } from "../platform/tauri";
import { publishHitRegions } from "./strip";
import { dismissChatPopup } from "./chatPopup";
import { APP_VERSION } from "../version";
import { CHANGELOG } from "../changelog";
import { checkForUpdates } from "../update";
import { sellValue, priceFactor, topCropTier } from "../game/market";
import {
  isDiscovered,
  discoveredCount,
  allDiscovered,
  harvestedCount,
  stolenTotal,
  stolenBreakdown,
  claimDexReward,
} from "../game/dex";

let panelEl: HTMLDivElement | null = null;

// Chat keeps its own draft + a signature so the live refresher can update the message list in place
// (rebuilding the whole panel would clobber whatever the user is typing).
let chatListEl: HTMLDivElement | null = null;
let chatDraft = "";
let lastChatSig = "";
// Chat auto-dismiss: once the mouse has entered the open chat panel, leaving it closes the panel.
let chatHoverArmed = false;
// Which folded 서리 groups the user has expanded (keyed by the run's first message id).
const expandedRaidGroups = new Set<string>();

function ensurePanel(): HTMLDivElement {
  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "panel";
    panelEl.style.display = "none";
    document.getElementById("app")!.appendChild(panelEl);
    // Chat panel auto-closes once the mouse enters it and then leaves (only the chat kind).
    panelEl.addEventListener("mouseenter", () => {
      if (store.ui.panel === "chat") chatHoverArmed = true;
    });
    panelEl.addEventListener("mouseleave", () => {
      if (store.ui.panel === "chat" && chatHoverArmed) togglePanel("chat");
    });
    // Esc closes the open panel (the only reliable "dismiss" gesture — clicks outside the band pass
    // straight through the click-through overlay to the desktop, so they never reach the app).
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && store.ui.panel !== "none") {
        e.preventDefault();
        togglePanel(store.ui.panel);
      }
    });
    // Tick live bits in place (without rebuilding the panel → keeps input focus/text).
    window.setInterval(() => {
      refreshFriendCooldowns();
      refreshChat();
    }, 500);
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
  if (store.ui.panel === "chat") {
    store.chatUnread = false;
    lastChatSig = ""; // force the message list to (re)render on open
    dismissChatPopup(); // user is now reading — no need for the corner popup
    chatHoverArmed = false; // re-arm only after the mouse enters the panel
  }
  if (store.ui.panel === "ranking") void refreshRankingCoins();
  if (store.ui.panel === "spy") void refreshSpy();
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

// ── Cosmetic helpers (decor / theme / title sections + farm preview thumbnails) ──────

// Canvas previews must be measured AFTER they're in the DOM (clientWidth is 0 before insert), so
// we queue them while building the panel and flush right after renderPanels appends + shows it.
let previewQueue: { canvas: HTMLCanvasElement; opts: { decor: string; theme: string; topTier?: number } }[] = [];

function makeFarmPreview(
  opts: { decor: string; theme: string; topTier?: number },
  w = 120,
  h = 40,
): HTMLCanvasElement {
  const cv = el("canvas", { class: "farm-preview", style: `width:${w}px;height:${h}px` }) as HTMLCanvasElement;
  previewQueue.push({ canvas: cv, opts });
  return cv;
}

function flushPreviews(): void {
  const q = previewQueue;
  previewQueue = [];
  for (const { canvas, opts } of q) renderFarmPreview(canvas, opts);
}

// Animated cursor preview — the equipped cursor drifts along a path leaving its trail, so the buyer
// actually sees what they bought (the cosmetic is otherwise only visible to opponents mid-raid). The
// loop reads the equipped id live and self-stops when the cosmetics panel closes or is rebuilt.
let cursorPreviewRaf = 0;
function startCursorPreview(canvas: HTMLCanvasElement): void {
  if (!canvas.isConnected) return; // stale canvas from a superseded panel build
  cancelAnimationFrame(cursorPreviewRaf);
  const dpr = window.devicePixelRatio || 1;
  const W = 224;
  const H = 64;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const trail = createTrail();
  const loop = (): void => {
    if (store.ui.panel !== "cosmetics" || !canvas.isConnected) return; // panel closed/rebuilt → stop
    const now = Date.now();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#4a4660"; // dusk backdrop so light AND dark trails read
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2 + W * 0.34 * Math.sin(now / 900);
    const cy = H / 2 + H * 0.26 * Math.sin(now / 640 + 1);
    const id = store.user?.equippedCursor;
    trail.emit(cx, cy, cursorSkin(id).trail, now, -1);
    trail.step(ctx, now);
    drawGhostCursor(ctx, cx - 1, cy - 8, 2, id);
    cursorPreviewRaf = requestAnimationFrame(loop);
  };
  cursorPreviewRaf = requestAnimationFrame(loop);
}

function rarityColor(r?: string): string {
  switch (r) {
    case "희귀":
      return "#3b82c4";
    case "영웅":
      return "#9b59b6";
    case "전설":
      return "#e0a52e";
    default:
      return "#8a7a5c"; // 일반
  }
}

function titleLabelOf(id: string | undefined): string {
  const t = BALANCE.cosmetics.titles.find((x) => x.id === id);
  return t ? t.label : "";
}

/** Decorate a nick with its owner's title chip: "[칭호] 닉" (no chip when the title is empty). */
function nickWithTitle(nick: string, titleId: string | undefined): HTMLElement {
  const label = titleLabelOf(titleId);
  const span = el("span", { class: "grow" });
  if (label) span.append(el("span", { class: "title-chip" }, label));
  span.append(document.createTextNode(nick));
  return span;
}

/** One buy/equip card for a family of cosmetics (decor, theme, title, msgSkin). */
function cosmeticSection(
  uid: string,
  type: CosmeticType,
  title: string,
  items: readonly CosmeticItem[],
  equippedId: string | undefined,
): HTMLElement {
  const card = el("div", { class: "card" }, el("div", { class: "card-title" }, title));
  for (const it of items) {
    const owned = cosmeticOwned(it);
    const equipped = equippedId === it.id;
    const lock = lockReason(it);
    const kids: (Node | string)[] = [el("span", { class: "grow" }, it.label || "없음")];
    if (it.rarity) {
      kids.push(
        el("span", { class: "small", style: `color:${rarityColor(it.rarity)};font-weight:bold` }, it.rarity),
      );
    }
    if (equipped) kids.push(el("span", { class: "muted" }, "사용중"));
    else if (owned) kids.push(btn("사용", () => void equipCosmetic(uid, type, it.id)));
    else if (lock) kids.push(el("span", { class: "muted small" }, "🔒 " + lock));
    else kids.push(btn(`구매 (${it.price})`, () => void buyCosmetic(uid, type, it.id, it.price)));
    card.append(row(...kids));
  }
  return card;
}

// ── Panels ───────────────────────────────────────────────────────────────────

function shopPanel(): HTMLElement {
  const uid = store.uid;
  const u = store.user;
  const wrap = el("div", { class: "panel-body" });
  wrap.append(el("div", { class: "muted" }, "씨앗은 밭의 빈 칸을 눌러 심어요. 아래로 강화/확장하세요."));
  wrap.append(
    el(
      "div",
      { class: "muted small" },
      `📈 오늘의 시세 (자정 KST 갱신) · 인기작물: ${BALANCE.crops.tiers[topCropTier()]?.label ?? ""}`,
    ),
  );

  // seeds info — buy price is fixed; "오늘" shows today's sell price (base × market factor).
  const seeds = el("div", { class: "card" }, el("div", { class: "card-title" }, "씨앗"));
  for (const t of BALANCE.crops.tiers) {
    const up = priceFactor(t.id) >= 1;
    seeds.append(
      row(
        el("span", { class: "dot", style: `background:${t.color}` }),
        el("span", { class: "grow" }, `${t.label}`),
        el("span", { class: "muted small" }, `씨 ${t.price} · 수확 ${t.harvestValue}`),
        el(
          "span",
          { class: "small", style: `color:${up ? "#3f7a30" : "#b5402e"};font-weight:bold` },
          `→ ${sellValue(t.id)} ${up ? "📈" : "📉"}`,
        ),
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

    // scarecrow (defense): tougher crops + faster catch
    const scCost = levelCost("scarecrow", u.scarecrowLv);
    wrap.append(
      el(
        "div",
        { class: "card" },
        el("div", { class: "card-title" }, "허수아비 (방어)"),
        row(
          el(
            "span",
            { class: "grow" },
            `Lv ${u.scarecrowLv} · 내 작물 1개당 도둑 ${cropClicksToSteal(u.scarecrowLv, 0)}클릭 · 추격 ${evictHitsNeeded(0, u.scarecrowLv)}타`,
          ),
          btn(`강화 (${scCost})`, () => void buyLevel(uid, "scarecrow")),
        ),
      ),
    );

    // scythe (attack): faster stealing + slipperier when chased
    const syCost = levelCost("scythe", u.scytheLv);
    wrap.append(
      el(
        "div",
        { class: "card" },
        el("div", { class: "card-title" }, "낫 (공격)"),
        row(
          el(
            "span",
            { class: "grow" },
            `Lv ${u.scytheLv} · 무방비 작물 ${cropClicksToSteal(0, u.scytheLv)}클릭에 털기 · 쫓겨나기 ${evictHitsNeeded(u.scytheLv, 0)}타`,
          ),
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
        makeFarmPreview({ decor: f.equippedDecor || "decor_none", theme: f.equippedTheme || "theme_day" }, 72, 24),
        nickWithTitle(f.nickname, f.equippedTitle),
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

// ── Village chat (one global room) ──────────────────────────────────────────────

function chatPanel(): HTMLElement {
  const wrap = el("div", { class: "panel-body" });
  wrap.append(el("div", { class: "muted" }, "모두가 함께 쓰는 마을 채팅이에요."));

  // New-message popup on/off (persisted). Flipping it just re-renders the panel.
  const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
  cb.checked = store.chatNotify;
  cb.addEventListener("change", () => {
    setChatNotify(cb.checked);
    renderPanels();
  });
  wrap.append(
    row(
      el("span", { class: "grow" }, store.chatNotify ? "🔔 새 메시지 알림" : "🔕 새 메시지 알림"),
      el("label", { class: "switch" }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
    ),
  );

  chatListEl = el("div", { class: "chat-list" }) as HTMLDivElement;
  renderChatList();
  wrap.append(chatListEl);

  const input = el("input", {
    class: "input",
    placeholder: "메시지 입력…",
    maxLength: BALANCE.chat.maxLen,
    value: chatDraft,
    oninput: (e: any) => (chatDraft = e.target.value),
  }) as HTMLInputElement;
  const doSend = async (): Promise<void> => {
    const text = chatDraft;
    chatDraft = "";
    input.value = "";
    input.focus();
    const ok = await sendChat(text);
    if (!ok && text.trim()) {
      // Send failed (cooldown / network) — put the draft back so the user doesn't lose what they
      // typed (unless they've already started typing something new in the meantime).
      if (!input.value) {
        chatDraft = text;
        input.value = text;
      }
      toast("잠시 후 다시 보내주세요");
    }
  };
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void doSend();
    }
  });
  wrap.append(row(input, btn("보내기", () => void doSend())));
  // First open: focus + jump to newest.
  setTimeout(() => {
    input.focus();
    if (chatListEl) chatListEl.scrollTop = chatListEl.scrollHeight;
  }, 0);
  return wrap;
}

function chatSignature(): string {
  const last = store.chat[store.chat.length - 1];
  return `${store.chat.length}:${last ? last.id : ""}`;
}

/** "오전/오후 h:mm" for a chat line; empty if the server timestamp hasn't resolved yet. */
function fmtChatTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const d = new Date(at);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${m}`;
}

// 서리 announcements are auto-posted to the same room, so a busy server buries real chat under raid
// spam. Detect them heuristically (their fixed emoji-led format) and fold consecutive ones — the
// raids sandwiched between two human messages — into one collapsible summary row.
const RAID_PREFIXES = ["🌾", "🚨", "⏱️", "🌿"];
function isRaidMsg(text: string): boolean {
  return RAID_PREFIXES.some((p) => text.startsWith(p)) && text.includes("님 밭");
}

function appendChatMsg(m: ChatMessage): void {
  if (!chatListEl) return;
  const mine = m.uid === store.uid;
  // No title chip in chat — titles are long and would push the nick off-screen. Titles still
  // show in the friends/ranking panels.
  const nickEl = el("span", { class: "chat-nick" }, mine ? "나" : m.nick || "농부");
  chatListEl.append(
    el(
      "div",
      { class: `chat-msg${mine ? " me" : ""}` },
      nickEl,
      el("span", { class: "chat-text" }, m.text),
      el("span", { class: "chat-time" }, fmtChatTime(m.at)),
    ),
  );
}

function appendRaidGroup(run: ChatMessage[]): void {
  if (!chatListEl) return;
  const key = run[0].id;
  const open = expandedRaidGroups.has(key);
  chatListEl.append(
    el(
      "div",
      {
        class: "chat-raid-fold",
        onclick: () => {
          if (!expandedRaidGroups.delete(key)) expandedRaidGroups.add(key);
          renderChatList();
        },
      },
      `⚔️ 서리 ${run.length}건 · ${open ? "▴ 접기" : "▾ 펼치기"}`,
    ),
  );
  if (open) {
    for (const m of run) {
      const who = m.uid === store.uid ? "나" : m.nick || "농부";
      chatListEl.append(
        el(
          "div",
          { class: "chat-raid-item" },
          el("span", { class: "chat-raid-who" }, who),
          document.createTextNode(" " + m.text + " "),
          el("span", { class: "chat-time" }, fmtChatTime(m.at)),
        ),
      );
    }
  }
}

function renderChatList(): void {
  if (!chatListEl) return;
  const atBottom = chatListEl.scrollHeight - chatListEl.scrollTop - chatListEl.clientHeight < 24;
  chatListEl.replaceChildren();
  const msgs = store.chat;
  if (msgs.length === 0) {
    chatListEl.append(el("div", { class: "muted" }, "아직 메시지가 없어요. 먼저 인사해 보세요!"));
  } else {
    let i = 0;
    while (i < msgs.length) {
      if (isRaidMsg(msgs[i].text)) {
        let j = i + 1;
        while (j < msgs.length && isRaidMsg(msgs[j].text)) j++;
        appendRaidGroup(msgs.slice(i, j));
        i = j;
      } else {
        appendChatMsg(msgs[i]);
        i++;
      }
    }
  }
  lastChatSig = chatSignature();
  if (atBottom) chatListEl.scrollTop = chatListEl.scrollHeight;
}

/** Update the open chat panel's message list in place (driven by the 0.5s ticker). */
function refreshChat(): void {
  if (!panelEl || store.ui.panel !== "chat" || panelEl.style.display === "none") return;
  if (!chatListEl || chatSignature() === lastChatSig) return;
  renderChatList();
}

// ── Gold ranking (me + friends) ───────────────────────────────────────────────

async function refreshRankingCoins(): Promise<void> {
  await Promise.all(
    store.friends.map(async (f) => {
      try {
        const v = (await get(r(paths.userCoins(f.uid)))).val();
        if (typeof v === "number") f.coins = v;
      } catch {
        /* ignore */
      }
    }),
  );
  if (store.ui.panel === "ranking") renderPanels();
}

function rankingPanel(): HTMLElement {
  const wrap = el("div", { class: "panel-body" });
  wrap.append(el("div", { class: "muted" }, "나와 친구들의 골드 랭킹이에요."));

  type Entry = { nick: string; coins: number; me: boolean; titleId?: string };
  const rows: Entry[] = [
    { nick: store.user?.nickname || "나", coins: coins(), me: true, titleId: store.user?.equippedTitle },
    ...store.friends.map((f) => ({
      nick: f.nickname,
      coins: f.coins ?? 0,
      me: false,
      titleId: f.equippedTitle,
    })),
  ].sort((a, b) => b.coins - a.coins);

  const card = el("div", { class: "card" });
  const medals = ["🥇", "🥈", "🥉"];
  rows.forEach((e, i) => {
    card.append(
      el(
        "div",
        { class: `rank-row${e.me ? " rank-me" : ""}` },
        el("span", { class: "rank-num" }, medals[i] || `${i + 1}`),
        nickWithTitle(e.nick + (e.me ? " (나)" : ""), e.titleId),
        el("span", { class: "rank-coin" }, `${e.coins}💰`),
      ),
    );
  });
  wrap.append(card);
  wrap.append(btn("새로고침", () => void refreshRankingCoins(), "btn small"));
  return wrap;
}

// ── 작물 점지소 ──────────────────────────────────────────────────────────────────

type SpyRow = { uid: string; nick: string; crops: { tier: number; ripeAt: number }[] };
let spyData: SpyRow[] | null = null;
let spyLoading = false;

function cropTotalMs(tier: number): number {
  const t = BALANCE.crops.tiers[tier];
  return t ? t.stages.seed + t.stages.sprout + t.stages.growing : 0;
}

async function refreshSpy(): Promise<void> {
  spyLoading = true;
  if (store.ui.panel === "spy") renderPanels();

  // Everyone we know a uid + nick for, minus myself.
  const who = new Map<string, string>();
  for (const f of store.friends) who.set(f.uid, f.nickname);
  for (const m of store.chat) if (m.uid !== store.uid) who.set(m.uid, m.nick || "농부");
  for (const e of store.raidlog) {
    if (e.raider !== store.uid) who.set(e.raider, e.raiderNick || "농부");
    if (e.victim !== store.uid) who.set(e.victim, e.victimNick || "농부");
  }
  who.delete(store.uid);

  const rows: SpyRow[] = [];
  await Promise.all(
    [...who.entries()].map(async ([uid, nick]) => {
      try {
        const v = (await get(r(paths.crops(uid)))).val() as Record<string, any> | null;
        if (!v) return;
        const crops = Object.values(v)
          .filter((c) => c && typeof c.plantedAt === "number" && typeof c.tier === "number")
          .map((c: any) => ({ tier: c.tier, ripeAt: c.plantedAt + cropTotalMs(c.tier) }));
        if (crops.length) rows.push({ uid, nick, crops });
      } catch {
        /* unreadable plot — skip */
      }
    }),
  );
  // Soonest-to-be-fully-ripe first (best upcoming raid target on top).
  rows.sort((a, b) => maxRipe(a) - maxRipe(b));
  spyData = rows;
  spyLoading = false;
  if (store.ui.panel === "spy") renderPanels();
}

function maxRipe(r: SpyRow): number {
  return Math.max(...r.crops.map((c) => c.ripeAt));
}

/** Clock time for a ripe moment; adds "내일" if it lands on a later KST day than now. */
function fmtRipeClock(at: number, now: number): string {
  const base = fmtChatTime(at);
  const dayMs = 24 * 60 * 60 * 1000;
  const kst = (t: number): number => Math.floor((t + 9 * 60 * 60 * 1000) / dayMs);
  return kst(at) > kst(now) ? `내일 ${base}` : base;
}

function spyPanel(): HTMLElement {
  const wrap = el("div", { class: "panel-body" });
  if (store.user?.nickname !== "정충봉") {
    wrap.append(el("div", { class: "muted" }, "🔒 진실된 이름을 가진 자에게만 열리는 페이지예요."));
    return wrap;
  }
  wrap.append(el("div", { class: "muted" }, "🔮 마을 사람들의 작물이 언제 다 익는지 점지해 드려요."));
  wrap.append(btn("다시 점지", () => void refreshSpy(), "btn small"));

  if (spyLoading && !spyData) {
    wrap.append(el("div", { class: "muted" }, "점지하는 중…"));
    return wrap;
  }
  const rows = spyData ?? [];
  if (rows.length === 0) {
    wrap.append(el("div", { class: "muted" }, "들여다볼 밭이 없어요."));
    return wrap;
  }

  const now = serverNow();
  const card = el("div", { class: "feed-list" });
  for (const rrow of rows) {
    const allRipeAt = maxRipe(rrow);
    const ripeNow = rrow.crops.filter((c) => c.ripeAt <= now).length;
    const allRipe = allRipeAt <= now;
    const mins = Math.ceil((allRipeAt - now) / 60000);
    const head = allRipe
      ? `전부 익음 · 지금 털기 좋음! (${rrow.crops.length}개)`
      : `모두 익는 시각 ${fmtRipeClock(allRipeAt, now)} (${mins}분 후) · 익은 ${ripeNow}/${rrow.crops.length}`;
    card.append(
      el(
        "div",
        { class: "raidlog-row" + (allRipe ? " me-raider" : "") },
        el("span", { class: "grow" }, el("b", {}, rrow.nick), document.createTextNode(" — " + head)),
      ),
    );
    const detail = [...rrow.crops]
      .sort((a, b) => a.ripeAt - b.ripeAt)
      .map((c) => `${BALANCE.crops.tiers[c.tier]?.label ?? "?"} ${c.ripeAt <= now ? "✅" : fmtRipeClock(c.ripeAt, now)}`)
      .join(" · ");
    card.append(el("div", { class: "muted small" }, detail));
  }
  wrap.append(card);
  return wrap;
}

// ── Server-wide 서리 기록 (steal feed) ───────────────────────────────────────────

function raidlogPanel(): HTMLElement {
  const wrap = el("div", { class: "panel-body" });
  wrap.append(el("div", { class: "muted" }, "서버 전체의 서리 기록이에요 (최근순)."));

  const card = el("div", { class: "feed-list" });
  if (store.raidlog.length === 0) {
    card.append(el("div", { class: "muted" }, "아직 서리 기록이 없어요. 평화로운 마을이네요 🌱"));
  } else {
    // newest first
    for (const e of [...store.raidlog].reverse()) {
      const iRaided = e.raider === store.uid;
      const iWasRobbed = e.victim === store.uid;
      const raider = iRaided ? "나" : e.raiderNick || "농부";
      const victim = iWasRobbed ? "나" : e.victimNick || "농부";
      const cls = "raidlog-row" + (iRaided ? " me-raider" : iWasRobbed ? " me-victim" : "");
      const grow = el(
        "div",
        { class: "grow" },
        el("b", {}, raider),
        document.createTextNode(" 🌾 "),
        el("b", {}, victim),
        document.createTextNode(`님의 밭 · 작물 ${e.count}개`),
      );
      // Text+colour tag (not colour alone) flags the rows I'm involved in.
      if (iRaided) grow.prepend(el("span", { class: "raidlog-tag raid" }, "내 서리"));
      else if (iWasRobbed) grow.prepend(el("span", { class: "raidlog-tag robbed" }, "피해"));
      card.append(
        el(
          "div",
          { class: cls },
          grow,
          el("span", { class: "raidlog-coin" }, `+${e.coins}💰`),
          el("span", { class: "chat-time" }, fmtChatTime(e.at)),
        ),
      );
    }
  }
  wrap.append(card);
  return wrap;
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

  // Live preview of my own farm (current theme + decor + my best crop) — this is also exactly what a
  // raider sees when they break into my plot, so the cosmetics finally have an audience.
  wrap.append(
    el(
      "div",
      { class: "card" },
      el("div", { class: "card-title" }, "내 밭 미리보기"),
      el(
        "div",
        { class: "preview-wrap" },
        makeFarmPreview(
          { decor: u?.equippedDecor || "decor_none", theme: u?.equippedTheme || "theme_day", topTier: topCropTier() },
          224,
          64,
        ),
      ),
      el("div", { class: "muted small" }, "친구가 내 밭을 털 때 이 모습이 보여요."),
    ),
  );

  wrap.append(cosmeticSection(uid, "decor", "밭 꾸미기", BALANCE.cosmetics.decor, u?.equippedDecor));
  wrap.append(
    cosmeticSection(uid, "theme", "밭 배경 테마", BALANCE.cosmetics.themes, u?.equippedTheme || "theme_day"),
  );
  wrap.append(
    cosmeticSection(uid, "title", "칭호 (채팅·랭킹 표시)", BALANCE.cosmetics.titles, u?.equippedTitle || "title_none"),
  );
  wrap.append(cosmeticSection(uid, "msgSkin", "쪽지 스킨 (서리 시)", BALANCE.cosmetics.msgSkin, u?.equippedMsgSkin));

  // Raid cursor (shape + trail). Animated preview of the equipped one, then the catalog.
  const curPrev = el("canvas", { class: "farm-preview" }) as HTMLCanvasElement;
  wrap.append(
    el(
      "div",
      { class: "card" },
      el("div", { class: "card-title" }, "커서 미리보기"),
      el("div", { class: "preview-wrap" }, curPrev),
      el("div", { class: "muted small" }, "서리하러 가면 상대 화면에 이 커서와 잔상이 떠요."),
    ),
  );
  setTimeout(() => startCursorPreview(curPrev), 0); // canvas must be in the DOM before it animates
  wrap.append(
    cosmeticSection(uid, "cursor", "커서 (모양 + 잔상)", BALANCE.cosmetics.cursors, u?.equippedCursor || "cursor_default"),
  );
  return wrap;
}

// Which monitor the strip prefers. The Rust side owns the real value, so we mirror the choice in
// localStorage just to show which button is currently active (defaults to the balance setting).
const MONITOR_KEY = "suhree_monitor";
function currentMonitor(): "primary" | "cursor" {
  const v = localStorage.getItem(MONITOR_KEY);
  return v === "cursor" || v === "primary" ? v : BALANCE.strip.preferredMonitor;
}
function chooseMonitor(m: "primary" | "cursor"): void {
  localStorage.setItem(MONITOR_KEY, m);
  void setPreferredMonitor(m);
  renderPanels();
}

function settingsPanel(): HTMLElement {
  const uid = store.uid;
  const wrap = el("div", { class: "panel-body" });
  const mon = currentMonitor();

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
        btn("주 모니터", () => chooseMonitor("primary"), mon === "primary" ? "btn sel" : "btn"),
        btn("커서 모니터", () => chooseMonitor("cursor"), mon === "cursor" ? "btn sel" : "btn"),
      ),
    ),
  );

  // Hide the strip from the screen. There's no tray icon, so the way back is relaunching suhree —
  // single-instance catches that and re-shows this same window instead of opening a second copy.
  if (isTauri()) {
    wrap.append(
      el("div", { class: "card" },
        el("div", { class: "card-title" }, "앱 숨기기"),
        el("div", { class: "muted small" }, "스트립을 화면에서 숨겨요. 바탕화면·시작메뉴의 suhree 아이콘을 다시 실행하면 돌아와요."),
        btn("숨기기", () => void hideStrip()),
      ),
    );
  }
  wrap.append(
    el("div", { class: "card" },
      el("div", { class: "card-title" }, "내 정보"),
      el("div", {}, `닉네임: ${store.user?.nickname ?? ""}`),
      el("div", {}, `친구코드: ${store.user?.friendCode ?? ""}`),
      el("div", { class: "muted small" }, `코인: ${coins()}`),
    ),
  );

  // version + update history
  const verCard = el("div", { class: "card" }, el("div", { class: "card-title" }, "버전 / 업데이트"));
  const verHead = row(el("span", { class: "grow" }, `현재 버전 v${APP_VERSION}`));
  if (isTauri()) verHead.append(btn("업데이트 확인", () => void checkForUpdates(false), "btn small"));
  verCard.append(verHead);

  const log = el("div", { class: "changelog" });
  for (const e of CHANGELOG) {
    const entry = el("div", { class: "cl-entry" });
    const tag = e.version === APP_VERSION ? " (현재)" : "";
    const when = e.date ? ` · ${e.date}` : "";
    entry.append(el("div", { class: "cl-ver" }, `v${e.version}${tag}${when}`));
    const ul = el("ul", { class: "cl-items" });
    for (const it of e.items) ul.append(el("li", {}, it));
    entry.append(ul);
    log.append(entry);
  }
  verCard.append(log);
  wrap.append(verCard);
  return wrap;
}

// ── Crop 도감 (collection) ──────────────────────────────────────────────────────

function dexPanel(): HTMLElement {
  const uid = store.uid;
  const wrap = el("div", { class: "panel-body" });
  const total = BALANCE.crops.tiers.length;
  const got = discoveredCount();

  wrap.append(el("div", { class: "muted" }, "수확하거나 서리해서 모은 작물 도감이에요."));

  // progress + one-time completion reward
  const head = el("div", { class: "card" });
  head.append(el("div", { class: "card-title" }, `수집 ${got} / ${total}`));
  if (allDiscovered()) {
    if (store.user?.dexClaimed) {
      head.append(el("div", { class: "muted small" }, "🏆 완성 보상을 받았어요!"));
    } else {
      head.append(
        row(
          el("span", { class: "grow" }, "도감 완성! 보상을 받으세요"),
          btn(`보상 받기 (+${BALANCE.dex.completionReward})`, () => void claimDexReward(uid)),
        ),
      );
    }
  } else {
    head.append(el("div", { class: "muted small" }, `${total - got}종 더 모으면 완성 보상!`));
  }
  wrap.append(head);

  const nickOf = (u: string): string =>
    store.friends.find((f) => f.uid === u)?.nickname ?? "알 수 없음";

  for (const t of BALANCE.crops.tiers) {
    const found = isDiscovered(t.id);
    const card = el("div", { class: `card${found ? "" : " dex-locked"}` });
    if (!found) {
      card.append(
        row(
          el("span", { class: "dot", style: "background:#9a8a72" }),
          el("span", { class: "grow" }, "???"),
          el("span", { class: "muted small" }, "미발견"),
        ),
      );
    } else {
      const up = priceFactor(t.id) >= 1;
      card.append(
        row(
          el("span", { class: "dot", style: `background:${t.color}` }),
          el("span", { class: "grow" }, t.label),
          el(
            "span",
            { class: "small", style: `color:${up ? "#3f7a30" : "#b5402e"};font-weight:bold` },
            `오늘 ${sellValue(t.id)} ${up ? "📈" : "📉"}`,
          ),
        ),
      );
      card.append(
        el(
          "div",
          { class: "muted small" },
          `수확 ${harvestedCount(t.id)}개 · 서리 ${stolenTotal(t.id)}개 · 기본수확 ${t.harvestValue}`,
        ),
      );
      const bd = stolenBreakdown(t.id);
      if (bd.length) {
        card.append(
          el(
            "div",
            { class: "muted small" },
            "서리: " + bd.map((x) => `${nickOf(x.uid)} ${x.count}개`).join(", "),
          ),
        );
      }
    }
    wrap.append(card);
  }
  return wrap;
}

const TITLES: Record<PanelKind, string> = {
  none: "",
  shop: "상점",
  friends: "친구",
  chat: "마을 채팅",
  ranking: "골드 랭킹",
  messages: "쪽지함",
  cosmetics: "꾸미기",
  dex: "도감",
  raidlog: "서리 기록",
  spy: "🔮 작물 점지소",
  settings: "설정",
};

export function renderPanels(): void {
  const p = ensurePanel();
  previewQueue = []; // drop any thumbnails queued by a prior build; this pass re-queues its own
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
    case "chat":
      body = chatPanel();
      break;
    case "ranking":
      body = rankingPanel();
      break;
    case "messages":
      body = messagesPanel();
      break;
    case "cosmetics":
      body = cosmeticsPanel();
      break;
    case "dex":
      body = dexPanel();
      break;
    case "raidlog":
      body = raidlogPanel();
      break;
    case "spy":
      body = spyPanel();
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
  if (previewQueue.length) setTimeout(flushPreviews, 0); // canvases need to be in the DOM to size
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
