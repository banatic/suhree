// Global "village" chat — one shared room for every player. Spark-friendly: readers only pull the
// most recent N messages (limitToLast), and there is no server-side pruning (no Cloud Functions).

import { push, set, serverTimestamp, query, limitToLast, onValue } from "firebase/database";
import { r, paths } from "./db";
import { store, type ChatMessage } from "../state";
import { BALANCE } from "../config/balance";
import { showChatPopup } from "../render/chatPopup";

let primed = false; // the first snapshot is backlog, not "new" — don't pop for it

// 서리 announcements are auto-posted to this same room, so a busy server buries real chat under raid
// spam. Detect them heuristically (their fixed emoji-led format) so every surface reading this room
// (chat panel and notifications) can treat them consistently.
const RAID_PREFIXES = ["🌾", "🚨", "⏱️", "🌿"];
export function isRaidMsg(text: string): boolean {
  return RAID_PREFIXES.some((p) => text.startsWith(p)) && text.includes("님 밭");
}

// 접속 알림. A player announces their OWN arrival once per launch (announceJoin below) instead of
// every reader deriving it from presence — one writer means one line, and readers can't disagree when
// the online threshold flaps. Encoded as a sentinel TEXT (not a new field): the chat security rule
// has `"$other": { ".validate": false }`, so any extra field would need a rules deploy to even write.
export const JOIN_TEXT = "👋 접속했어요";
export function isJoinMsg(text: string): boolean {
  return text === JOIN_TEXT;
}

/** The room is global, so a join line is only shown when I actually know the person — a friend, or
 *  me. Otherwise every stranger's launch would spam the village chat. */
export function joinIsRelevant(uid: string): boolean {
  return uid === store.uid || store.friends.some((f) => f.uid === uid);
}

/** Join lines from strangers exist in the room but are invisible here — no render, no popup, no
 *  unread dot. One predicate so all three stay in agreement. */
export function isHiddenChatMsg(m: ChatMessage): boolean {
  return isJoinMsg(m.text) && !joinIsRelevant(m.uid);
}

/** Parse + order-sort a raw `chat` RTDB snapshot. The one normalization path for every reader
 *  (chat panel and notifications) so they can never drift on field mapping again. */
export function parseChatSnapshot(v: Record<string, any> | null | undefined): ChatMessage[] {
  return Object.entries(v || {})
    .map(([id, m]: [string, any]) => ({ id, uid: m.uid, nick: m.nick, text: m.text || "", at: m.at || 0, img: m.img }) as ChatMessage)
    .sort((a, b) => a.at - b.at);
}

// Fired every time subscribeChat() lands a fresh snapshot — straight off the websocket callback, so
// (unlike a setInterval-driven UI refresh) it isn't subject to Chromium's background-tab timer
// throttling (see firebase/presence.ts). Panels register here to repaint the instant new chat data
// arrives even while their window is unfocused.
const chatListeners = new Set<() => void>();
export function onChatChanged(fn: () => void): void {
  chatListeners.add(fn);
}

/** Outgoing queue so a burst of sends lands seamlessly, spaced `cooldownMs` apart, instead of
 *  rejecting anything typed too soon after the last send. */
const MAX_QUEUE = 20;
const MAX_RETRIES = 3;
type QueuedMsg = { text: string; img?: string; retries: number };
const sendQueue: QueuedMsg[] = [];
let draining = false;
let lastSendAt = 0;

function scheduleDrain(): void {
  if (draining) return;
  draining = true;
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  while (sendQueue.length) {
    const wait = BALANCE.chat.cooldownMs - (Date.now() - lastSendAt);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const next = sendQueue[0];
    lastSendAt = Date.now();
    const nick = (store.user?.nickname || "농부").slice(0, 16);
    try {
      const msg: Record<string, unknown> = { uid: store.uid, nick, text: next.text, at: serverTimestamp() };
      if (next.img) msg.img = next.img;
      await set(push(r(paths.chat())), msg);
      sendQueue.shift();
    } catch {
      // Transient write error — retry a few times, spaced by the same cooldown, then give up on
      // this one line so a single stuck message can't stall everything behind it forever.
      next.retries++;
      if (next.retries >= MAX_RETRIES) sendQueue.shift();
    }
  }
  draining = false;
}

/** Mirror the most-recent slice of the room into the store; flag unread when the panel is closed. */
export function subscribeChat(): void {
  const q = query(r(paths.chat()), limitToLast(BALANCE.chat.keep));
  onValue(q, (snap) => {
    const next = parseChatSnapshot(snap.val());

    const prevNewest = store.chat.length ? store.chat[store.chat.length - 1].at : 0;
    const newest = next.length ? next[next.length - 1].at : 0;
    const grew = newest > prevNewest && next.some((m) => m.uid !== store.uid && !isHiddenChatMsg(m));
    if (grew && store.ui.panel !== "chat") store.chatUnread = true;

    // Pop a KakaoTalk-style toast for each freshly-arrived message from someone else (skip the
    // first snapshot = backlog, and the last few only so a reconnect burst can't spam the corner).
    if (primed) {
      const incoming = next
        .filter((m) => m.at > prevNewest && m.uid !== store.uid && !isHiddenChatMsg(m))
        .slice(-3);
      for (const m of incoming) {
        const preview = m.img ? (m.text ? "📷 " + m.text : "📷 사진") : m.text;
        showChatPopup(m.nick || "농부", preview);
      }
    }
    primed = true;

    // No markPanelsDirty: the unread dot is canvas-drawn every frame, and an open chat panel repaints
    // itself in place via onChatChanged (below) — a full rebuild here would clobber the input.
    store.chat = next;
    for (const fn of chatListeners) fn();
  });
}

/** Post a one-off announcement to the room (e.g. a 서리 result). Fire-and-forget; bypasses the
 *  local send cooldown so a raid summary always lands, and never blocks the caller. */
export async function announceToChat(text: string): Promise<void> {
  const t = (text || "").trim().slice(0, BALANCE.chat.maxLen);
  if (!t) return;
  const nick = (store.user?.nickname || "농부").slice(0, 16);
  try {
    await set(push(r(paths.chat())), { uid: store.uid, nick, text: t, at: serverTimestamp() });
  } catch {
    /* ignore transient write errors — the raid loot is already settled */
  }
}

// Last launch that announced itself, so a relaunch inside `joinQuietMs` stays quiet. Persisted:
// the whole point is to survive the process restart that an app relaunch (or auto-update) is.
const JOIN_AT_KEY = "suhree_join_announced_at";
let joinAnnounced = false; // once per process, so a websocket reconnect can't re-fire it

/** Post my own "접속했어요" line to the room — at most once per launch, and not at all if this
 *  client already announced within `joinQuietMs`. Fire-and-forget; failure is silent (the notice is
 *  a nicety, and the next launch will announce anyway). */
export async function announceJoin(): Promise<void> {
  if (joinAnnounced) return;
  joinAnnounced = true;
  const prev = Number(localStorage.getItem(JOIN_AT_KEY) || 0);
  if (Number.isFinite(prev) && Date.now() - prev < BALANCE.chat.joinQuietMs) return;
  localStorage.setItem(JOIN_AT_KEY, String(Date.now()));
  await announceToChat(JOIN_TEXT);
}

/** Queue one line for the room, optionally with a pasted image (inline JPEG data URL). Sends
 *  immediately if the local anti-spam cooldown has elapsed, otherwise queues it to go out
 *  automatically — spaced `cooldownMs` apart — so a fast burst of messages all land in order
 *  instead of being dropped. Returns false only when there's nothing to send or the queue is full. */
export async function sendChat(text: string, img?: string): Promise<boolean> {
  const t = (text || "").trim().slice(0, BALANCE.chat.maxLen);
  if (!t && !img) return false;
  if (sendQueue.length >= MAX_QUEUE) return false;
  sendQueue.push({ text: t, img, retries: 0 });
  scheduleDrain();
  return true;
}
