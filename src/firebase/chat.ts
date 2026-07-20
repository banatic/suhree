// Global "village" chat — one shared room for every player. Spark-friendly: readers only pull the
// most recent N messages (limitToLast), and there is no server-side pruning (no Cloud Functions).

import { push, set, serverTimestamp, query, limitToLast, onValue } from "firebase/database";
import { r, paths } from "./db";
import { store, type ChatMessage } from "../state";
import { BALANCE } from "../config/balance";
import { showChatPopup } from "../render/chatPopup";

let primed = false; // the first snapshot is backlog, not "new" — don't pop for it

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
    const v = (snap.val() as Record<string, any>) || {};
    const next: ChatMessage[] = Object.entries(v)
      .map(([id, m]) => ({ id, uid: m.uid, nick: m.nick, text: m.text, at: m.at, img: m.img }) as ChatMessage)
      .sort((a, b) => a.at - b.at);

    const prevNewest = store.chat.length ? store.chat[store.chat.length - 1].at : 0;
    const newest = next.length ? next[next.length - 1].at : 0;
    const grew = newest > prevNewest && next.some((m) => m.uid !== store.uid);
    if (grew && store.ui.panel !== "chat") store.chatUnread = true;

    // Pop a KakaoTalk-style toast for each freshly-arrived message from someone else (skip the
    // first snapshot = backlog, and the last few only so a reconnect burst can't spam the corner).
    if (primed) {
      const incoming = next.filter((m) => m.at > prevNewest && m.uid !== store.uid).slice(-3);
      for (const m of incoming) {
        const preview = m.img ? (m.text ? "📷 " + m.text : "📷 사진") : m.text;
        showChatPopup(m.nick || "농부", preview);
      }
    }
    primed = true;

    // No markPanelsDirty: the unread dot is canvas-drawn every frame, and an open chat panel is
    // refreshed in place by the 0.5s ticker — a full rebuild here would clobber the input.
    store.chat = next;
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
