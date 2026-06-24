import { onValue, get, type Unsubscribe } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, markPanelsDirty, type FriendData } from "../state";
import { BALANCE } from "../config/balance";
import { serverNow } from "../firebase/time";

const presenceUnsubs = new Map<string, Unsubscribe>();
const cooldownUnsubs = new Map<string, Unsubscribe>();
const lastSeenMap = new Map<string, number>(); // friendUid → last heartbeat (server ms)
let onlineTicker: number | null = null;

// online ⇔ the friend's heartbeat is fresh. Re-evaluated both when lastSeen changes (a friend's
// beat / coming online) AND on a local timer (so a friend who simply STOPS beating — closed the
// app, lost network — is detected: their lastSeen never changes, so onValue alone wouldn't fire).
function isFresh(uid: string): boolean {
  const ls = lastSeenMap.get(uid) ?? 0;
  return serverNow() - ls < BALANCE.presence.onlineThresholdMs;
}

function recomputeOnline(): void {
  let changed = false;
  for (const f of store.friends) {
    const online = isFresh(f.uid);
    if (f.online !== online) {
      f.online = online;
      changed = true;
    }
  }
  if (changed) markPanelsDirty();
}

function subscribePresence(uid: string): void {
  if (presenceUnsubs.has(uid)) return;
  const un = onValue(r(paths.presenceLastSeen(uid)), (snap) => {
    lastSeenMap.set(uid, (snap.val() as number) || 0);
    recomputeOnline();
  });
  presenceUnsubs.set(uid, un);
}

function unsubscribePresence(uid: string): void {
  const un = presenceUnsubs.get(uid);
  if (un) {
    un();
    presenceUnsubs.delete(uid);
  }
  lastSeenMap.delete(uid);
}

// My raid cooldown against this friend lives at cooldowns/{friend}/{me} (server stamp). Mirror it
// so the friends panel is correct on a fresh launch / second device, not just after I raid here.
function subscribeCooldown(fuid: string, myUid: string): void {
  if (cooldownUnsubs.has(fuid)) return;
  const un = onValue(r(paths.cooldown(fuid, myUid)), (snap) => {
    const fr = store.friends.find((x) => x.uid === fuid);
    if (!fr) return;
    const stamp = snap.exists() ? (snap.val() as number) : null;
    fr.cooldownUntil = stamp != null ? stamp + BALANCE.raid.cooldownMs : undefined;
    markPanelsDirty();
  });
  cooldownUnsubs.set(fuid, un);
}

function unsubscribeCooldown(fuid: string): void {
  const un = cooldownUnsubs.get(fuid);
  if (un) {
    un();
    cooldownUnsubs.delete(fuid);
  }
}

export function subscribeFriends(uid: string): void {
  if (onlineTicker == null) {
    onlineTicker = window.setInterval(recomputeOnline, BALANCE.presence.readerTickMs);
  }

  onValue(r(paths.friends(uid)), async (snap) => {
    const map = (snap.val() as Record<string, boolean>) || {};
    const uids = Object.keys(map);

    const list: FriendData[] = [];
    for (const fuid of uids) {
      const u = ((await get(r(paths.user(fuid)))).val() as any) || {};
      list.push({
        uid: fuid,
        nickname: u.nickname || "농부",
        friendCode: u.friendCode || "",
        online: isFresh(fuid), // derive from the last known heartbeat, not a stale cache
        cooldownUntil: store.friends.find((x) => x.uid === fuid)?.cooldownUntil,
      });
    }
    store.friends = list;
    markPanelsDirty();

    // Reconcile presence + cooldown subscriptions incrementally — never tear down a still-present
    // friend's listener (that churn was a source of flicker).
    const want = new Set(uids);
    for (const sub of [...presenceUnsubs.keys()]) if (!want.has(sub)) unsubscribePresence(sub);
    for (const sub of [...cooldownUnsubs.keys()]) if (!want.has(sub)) unsubscribeCooldown(sub);
    for (const fuid of uids) {
      subscribePresence(fuid);
      subscribeCooldown(fuid, uid);
    }
  });
}
