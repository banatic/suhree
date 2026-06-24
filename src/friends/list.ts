import { onValue, get, type Unsubscribe } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, markPanelsDirty, type FriendData } from "../state";
import { BALANCE } from "../config/balance";

const presenceUnsubs = new Map<string, Unsubscribe>();
const cooldownUnsubs = new Map<string, Unsubscribe>();
const offlineTimers = new Map<string, number>();
// Smooth transient reconnects: only show a friend offline after they stay offline this long.
const OFFLINE_GRACE_MS = 4000;

function applyOnline(uid: string, online: boolean): void {
  const fr = store.friends.find((x) => x.uid === uid);
  if (!fr) return;
  if (online) {
    const t = offlineTimers.get(uid);
    if (t) {
      clearTimeout(t);
      offlineTimers.delete(uid);
    }
    if (!fr.online) {
      fr.online = true;
      markPanelsDirty();
    }
  } else if (fr.online && !offlineTimers.has(uid)) {
    const t = window.setTimeout(() => {
      offlineTimers.delete(uid);
      const f2 = store.friends.find((x) => x.uid === uid);
      if (f2 && f2.online) {
        f2.online = false;
        markPanelsDirty();
      }
    }, OFFLINE_GRACE_MS);
    offlineTimers.set(uid, t);
  }
}

function subscribePresence(uid: string): void {
  if (presenceUnsubs.has(uid)) return;
  // online == any live connection marker exists
  const un = onValue(r(paths.presenceConnections(uid)), (psnap) => {
    applyOnline(uid, psnap.exists());
  });
  presenceUnsubs.set(uid, un);
}

function unsubscribePresence(uid: string): void {
  const un = presenceUnsubs.get(uid);
  if (un) {
    un();
    presenceUnsubs.delete(uid);
  }
  const t = offlineTimers.get(uid);
  if (t) {
    clearTimeout(t);
    offlineTimers.delete(uid);
  }
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
  onValue(r(paths.friends(uid)), async (snap) => {
    const map = (snap.val() as Record<string, boolean>) || {};
    const uids = Object.keys(map);

    const list: FriendData[] = [];
    for (const fuid of uids) {
      const u = ((await get(r(paths.user(fuid)))).val() as any) || {};
      const existing = store.friends.find((x) => x.uid === fuid);
      list.push({
        uid: fuid,
        nickname: u.nickname || "농부",
        friendCode: u.friendCode || "",
        online: existing?.online ?? false, // preserve, presence listeners correct it
        cooldownUntil: existing?.cooldownUntil,
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
