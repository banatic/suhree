// 3D 여행 창 부트스트랩 — payload 로드 → 익명 인증(본체와 같은 uid) → 엔진 초기화
// → 멀티플레이 동기화 시작 → UI(캐릭터 선택·감정표현·채팅·이름표) 배선.

import { ensureSignedIn } from "../firebase/auth";
import { get } from "firebase/database";
import { r, paths } from "../firebase/db";
import {
  initEngine,
  frame,
  entities,
  me,
  createEnt,
  startEmote,
  pressKey,
  zoom,
  charCount,
  charLabel,
  charFile,
  emoteDefs,
  hudText,
  type Ent,
} from "./engine";
import { startNet, stopNet, tickNet, announceEmote, sendTravelChat, type TravelChatMsg } from "./net";

const CHAR_KEY = "suhree_travel_char";
const NICK_KEY = "suhree_nick";
const SB_KEY = "suhree_travel_sb"; // "0" = 사이드바 접힘

const $ = (id: string): HTMLElement => document.getElementById(id)!;

interface Bubble {
  text: string;
  until: number;
}
const bubbles = new Map<string, Bubble>(); // uid → 말풍선

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function loadPayload(): Promise<any> {
  const res = await fetch("./travel-payload.json");
  if (!res.ok) throw new Error("payload " + res.status);
  return res.json();
}

async function loadNick(uid: string): Promise<string> {
  // 본체가 저장해 둔 닉네임(localStorage) 우선, 없으면 DB 의 유저 레코드에서.
  const local = localStorage.getItem(NICK_KEY);
  if (local) return local;
  try {
    const snap = await get(r(paths.user(uid)));
    const v = snap.val() as { nickname?: string } | null;
    if (v?.nickname) return v.nickname;
  } catch {
    /* fall through */
  }
  return "여행자" + Math.floor(100 + Math.random() * 900);
}

/* ── 캐릭터 선택 사이드바 ── */
function buildRoster(onPick: (i: number) => void): void {
  const roster = $("roster");
  const find = $("find") as HTMLInputElement;
  const rebuild = (filter: string): void => {
    roster.innerHTML = "";
    for (let i = 0; i < charCount(); i++) {
      const label = charLabel(i);
      if (filter && !(label + charFile(i)).toLowerCase().includes(filter)) continue;
      const b = document.createElement("button");
      b.textContent = label;
      b.title = charFile(i);
      b.dataset.i = String(i);
      if (me && i === me.char) b.classList.add("on");
      b.onclick = () => {
        onPick(i);
        roster.querySelectorAll("button").forEach((x) => x.classList.toggle("on", +(x as HTMLElement).dataset.i! === i));
      };
      roster.appendChild(b);
    }
  };
  find.oninput = () => rebuild(find.value.toLowerCase());
  rebuild("");
}

/* ── 접속자 목록 ── */
function refreshOnline(): void {
  const el = $("online");
  const names: string[] = [];
  for (const ent of entities.values()) names.push(ent.me ? ent.nick + " (나)" : ent.nick);
  el.innerHTML =
    `<div class="online-head">접속 ${names.length}명</div>` +
    names.map((n) => `<div class="online-row">🧍 ${esc(n)}</div>`).join("");
}

/* ── 채팅 로그 + 말풍선 ── */
function onChat(m: TravelChatMsg): void {
  const log = $("chatlog");
  const row = document.createElement("div");
  row.className = "chat-row";
  row.innerHTML = `<b>${esc(m.nick)}</b> ${esc(m.text)}`;
  log.appendChild(row);
  while (log.children.length > 40) log.removeChild(log.firstChild!);
  log.scrollTop = log.scrollHeight;
  // at=0 은 입장 전 백로그 — 말풍선은 실시간 메시지만
  if (m.at > 0 && (entities.has(m.uid) || m.uid === me?.uid)) {
    bubbles.set(m.uid, { text: m.text.slice(0, 60), until: Date.now() + 5000 });
  }
}

/* ── 이름표/말풍선 오버레이 — 매 프레임 엔진이 계산한 화면 좌표에 붙인다 ── */
const tagEls = new Map<string, HTMLElement>();
function syncTags(): void {
  const layer = $("tags");
  const now = Date.now();
  const live = new Set<string>();
  for (const ent of entities.values()) {
    live.add(ent.uid);
    let el = tagEls.get(ent.uid);
    if (!el) {
      el = document.createElement("div");
      el.className = "tag";
      el.innerHTML = `<div class="bubble"></div><div class="name"></div>`;
      layer.appendChild(el);
      tagEls.set(ent.uid, el);
    }
    const scr = (ent as Ent).screen;
    if (!scr.visible) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    el.style.transform = `translate(-50%, -100%) translate(${scr.x.toFixed(1)}px, ${scr.y.toFixed(1)}px)`;
    const nameEl = el.querySelector(".name") as HTMLElement;
    nameEl.textContent = ent.nick;
    nameEl.classList.toggle("mine", ent.me);
    const bub = bubbles.get(ent.uid);
    const bubEl = el.querySelector(".bubble") as HTMLElement;
    if (bub && now < bub.until) {
      bubEl.style.display = "";
      bubEl.textContent = bub.text;
    } else {
      bubEl.style.display = "none";
      if (bub) bubbles.delete(ent.uid);
    }
  }
  for (const [uid, el] of tagEls) {
    if (!live.has(uid)) {
      el.remove();
      tagEls.delete(uid);
    }
  }
}

/* ── 부트 ── */
async function boot(): Promise<void> {
  const status = $("status");
  try {
    status.textContent = "에셋 불러오는 중…";
    const [data, uid] = await Promise.all([loadPayload(), ensureSignedIn()]);
    const nick = await loadNick(uid);

    initEngine($("cv") as HTMLCanvasElement, data);

    const savedChar = parseInt(localStorage.getItem(CHAR_KEY) || "", 10);
    const charIdx = Number.isFinite(savedChar) ? savedChar : Math.random() < 0.5 ? 0 : 1; // 기본: 소년/소녀
    const my = createEnt(uid, nick, true, charIdx);

    /* 사이드바 */
    buildRoster((i) => {
      my.char = i;
      localStorage.setItem(CHAR_KEY, String(i));
    });

    /* 사이드바 접기/펴기 (상태 유지) */
    const sbtoggle = $("sbtoggle");
    const applySb = (open: boolean): void => {
      document.body.classList.toggle("nosb", !open);
      sbtoggle.textContent = open ? "◀ 메뉴" : "▶ 메뉴";
      localStorage.setItem(SB_KEY, open ? "1" : "0");
    };
    applySb(localStorage.getItem(SB_KEY) !== "0");
    sbtoggle.onclick = () => applySb(document.body.classList.contains("nosb"));

    /* 감정표현 버튼 */
    const emo = $("emo");
    emoteDefs().forEach((E, k) => {
      const b = document.createElement("button");
      b.textContent = `${k + 1} ${E.label}`;
      b.onclick = () => {
        if (startEmote(my, k)) announceEmote(k);
      };
      emo.appendChild(b);
    });

    /* 키 입력 — 채팅 입력 중에는 이동 무시 */
    const chatin = $("chatin") as HTMLInputElement;
    addEventListener("keydown", (e) => {
      if (document.activeElement === chatin) {
        if (e.key === "Enter") {
          const t = chatin.value;
          chatin.value = "";
          if (t.trim()) sendTravelChat(t);
          else chatin.blur();
        } else if (e.key === "Escape") chatin.blur();
        return;
      }
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return; // 검색창
      if (e.key === "Enter") {
        chatin.focus();
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k >= "1" && k <= "8") {
        if (startEmote(my, +k - 1)) announceEmote(+k - 1);
        return;
      }
      pressKey(k, true);
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    });
    addEventListener("keyup", (e) => pressKey(e.key.toLowerCase(), false));
    ($("cv") as HTMLCanvasElement).addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom(e.deltaY);
    }, { passive: false });

    /* 네트워크 */
    startNet(uid, nick, onChat, refreshOnline);
    window.addEventListener("beforeunload", stopNet);
    refreshOnline();

    status.textContent = "";
    $("loading").style.display = "none";

    /* 메인 루프 */
    let last = 0;
    const loop = (t: number): void => {
      const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      frame(t, dt);
      tickNet();
      syncTags();
      $("pos").textContent = hudText();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (e) {
    console.error("travel boot failed", e);
    status.textContent = "불러오기 실패 — 네트워크/WebGL2 를 확인하세요";
  }
}

void boot();
