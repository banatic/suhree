// 3D 여행 멀티플레이 동기화 — RTDB `travel/{uid}` 에 내 상태를 ~8Hz 로 쓰고,
// `travel` 전체를 구독해 다른 플레이어를 엔티티로 미러링한다. 수신 좌표는
// 습격 커서(cursorStream)와 같은 데드레커닝(속도 외삽 + 지수 이징)으로 부드럽게.
// 채팅은 마을 전체 채팅방(chat)을 그대로 쓴다 — 여행 창에서 보낸 말이 본체
// 스트립 채팅에도 흐르고, 월드 안에서는 머리 위 말풍선으로 뜬다.

import {
  set,
  remove,
  onValue,
  onDisconnect,
  push,
  serverTimestamp,
  query,
  limitToLast,
  type Unsubscribe,
} from "firebase/database";
import { r, paths } from "../firebase/db";
import { entities, me, createEnt, removeEnt, applyNetSample, startEmote, type Ent } from "./engine";

const SEND_MS = 125; // 8Hz — 습격 커서(10Hz)보다 살짝 낮게 (Spark 쓰기 예산)
const IDLE_BEAT_MS = 3000; // 가만히 있어도 살아있음을 알리는 하트비트
const STALE_MS = 40000; // 이보다 오래된 상태는 유령(비정상 종료 잔재)으로 보고 무시

let myUid = "";
let myNick = "";
let lastSent = { x: 0, s: 0, yaw: 0, c: -1, ch: -1, e: -1, es: 0 };
let lastSendAt = 0;
let emoSeq = 0;
let curEmote = -1;
let stateSub: Unsubscribe | null = null;
let chatSub: Unsubscribe | null = null;

export interface TravelChatMsg {
  uid: string;
  nick: string;
  text: string;
  at: number;
}

let onChatCb: ((m: TravelChatMsg) => void) | null = null;
let onRosterCb: (() => void) | null = null;
let chatPrimed = false;
// 이미 표시한 메시지 id. serverTimestamp 메시지는 로컬 추정 → 서버 확정으로 at 이 바뀌며
// onValue 가 두 번 오므로, 시각이 아니라 push id 로 중복을 걸러야 한다.
const chatSeen = new Set<string>();

export function startNet(
  uid: string,
  nick: string,
  onChat: (m: TravelChatMsg) => void,
  onRoster: () => void,
): void {
  myUid = uid;
  myNick = nick;
  onChatCb = onChat;
  onRosterCb = onRoster;

  const myRef = r(paths.travelPlayer(uid));
  onDisconnect(myRef).remove().catch(() => {});
  window.addEventListener("beforeunload", () => {
    void remove(myRef).catch(() => {});
  });

  /* 다른 플레이어 구독 — travel 전체 (인원이 적은 마을 규모라 통으로 읽는다) */
  stateSub = onValue(r(paths.travel()), (snap) => {
    const v = (snap.val() as Record<string, any>) || {};
    const now = Date.now();
    const seen = new Set<string>();
    for (const [pid, p] of Object.entries(v)) {
      if (pid === myUid || !p || typeof p.x !== "number" || typeof p.s !== "number") continue;
      if (typeof p.at === "number" && now - p.at > STALE_MS) continue; // 유령
      seen.add(pid);
      let ent = entities.get(pid);
      if (!ent) {
        ent = createEnt(pid, String(p.n || "여행자").slice(0, 16), false, p.ch | 0);
        ent.lastEmoSeq = p.es | 0; // 입장 시점 이전의 감정표현은 재생하지 않는다
      }
      ent.nick = String(p.n || "여행자").slice(0, 16);
      if (typeof p.ch === "number" && p.ch !== ent.char) ent.char = p.ch;
      applyNetSample(ent, p.x, p.s, p.yaw || 0, p.c | 0, now);
      /* 감정표현: 시퀀스가 증가했을 때만 새로 재생 */
      const es = p.es | 0;
      if (es !== ent.lastEmoSeq) {
        ent.lastEmoSeq = es;
        const k = p.e;
        if (typeof k === "number" && k >= 0 && k <= 7) {
          ent.emote = null; // 진행 중이던 것은 끊고 새로 시작
          ent.clipIdx = 0;
          startEmote(ent, k);
        }
      }
    }
    /* 떠난 플레이어 정리 */
    for (const pid of [...entities.keys()]) {
      if (pid !== myUid && !seen.has(pid)) removeEnt(pid);
    }
    onRosterCb?.();
  });

  /* 마을 채팅 구독 — 말풍선 + 로그 */
  chatSub = onValue(query(r(paths.chat()), limitToLast(30)), (snap) => {
    const v = (snap.val() as Record<string, any>) || {};
    const msgs = Object.entries(v)
      .map(([id, m]: [string, any]) => ({ id, uid: m.uid, nick: m.nick, text: m.text || "", at: m.at || 0 }))
      .filter((m) => m.text)
      .sort((a, b) => a.at - b.at);
    if (!chatPrimed) {
      // 첫 스냅샷은 과거 로그 — 말풍선 없이 로그에만 채운다
      chatPrimed = true;
      for (const m of msgs) chatSeen.add(m.id);
      for (const m of msgs.slice(-8)) onChatCb?.({ ...m, at: 0 }); // at=0 → 로그 전용 표시
      return;
    }
    for (const m of msgs) {
      if (chatSeen.has(m.id)) continue;
      chatSeen.add(m.id);
      onChatCb?.(m);
    }
    if (chatSeen.size > 500) {
      // limitToLast(30) 밖으로 밀려난 옛 id 정리 (메모리만의 문제라 대충 앞에서부터)
      for (const id of chatSeen) {
        chatSeen.delete(id);
        if (chatSeen.size <= 250) break;
      }
    }
  });
}

export function stopNet(): void {
  stateSub?.();
  chatSub?.();
  stateSub = chatSub = null;
  if (myUid) void remove(r(paths.travelPlayer(myUid))).catch(() => {});
}

/** 감정표현 시작을 네트워크에 알린다 (다음 publish 에 실려 나간다). */
export function announceEmote(k: number): void {
  curEmote = k;
  emoSeq++;
}

/** 매 프레임 호출 — 변화가 있으면 8Hz 로, 없어도 3초마다 하트비트를 쓴다. */
export function tickNet(): void {
  const m: Ent | null = me;
  if (!m || !myUid) return;
  const now = Date.now();
  if (now - lastSendAt < SEND_MS) return;
  const c = Math.min(2, Math.max(0, m.clipIdx <= 2 ? m.clipIdx : 0)); // 감정표현 클립은 0(대기)으로 알림
  const changed =
    Math.abs(m.x - lastSent.x) > 0.01 ||
    Math.abs(m.s - lastSent.s) > 0.01 ||
    Math.abs(m.yaw - lastSent.yaw) > 0.02 ||
    c !== lastSent.c ||
    m.char !== lastSent.ch ||
    emoSeq !== lastSent.es;
  if (!changed && now - lastSendAt < IDLE_BEAT_MS) return;
  lastSendAt = now;
  lastSent = { x: m.x, s: m.s, yaw: m.yaw, c, ch: m.char, e: curEmote, es: emoSeq };
  void set(r(paths.travelPlayer(myUid)), {
    n: myNick.slice(0, 16),
    ch: m.char,
    x: Math.round(m.x * 100) / 100,
    s: Math.round(m.s * 100) / 100,
    yaw: Math.round(m.yaw * 100) / 100,
    c,
    e: curEmote,
    es: emoSeq,
    at: serverTimestamp(),
  }).catch(() => {
    /* 일시적 쓰기 실패 무시 */
  });
}

/* ── 채팅 전송 — 본체 chat.ts 의 큐를 단순화한 버전 (쿨다운 1.2초 간격 큐) ── */
const CHAT_COOLDOWN_MS = 1200;
const chatQueue: string[] = [];
let chatDraining = false;
let chatLastAt = 0;

export function sendTravelChat(text: string): boolean {
  const t = (text || "").trim().slice(0, 200);
  if (!t || chatQueue.length >= 10) return false;
  chatQueue.push(t);
  if (!chatDraining) {
    chatDraining = true;
    void drainChat();
  }
  return true;
}

async function drainChat(): Promise<void> {
  while (chatQueue.length) {
    const wait = CHAT_COOLDOWN_MS - (Date.now() - chatLastAt);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const text = chatQueue[0];
    chatLastAt = Date.now();
    try {
      await set(push(r(paths.chat())), {
        uid: myUid,
        nick: myNick.slice(0, 16),
        text,
        at: serverTimestamp(),
      });
      chatQueue.shift();
    } catch {
      chatQueue.shift(); // 여행 채팅은 한 줄 유실 허용 — 재시도로 막히지 않게
    }
  }
  chatDraining = false;
}
