import { onValue, get, type Unsubscribe } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store, markPanelsDirty, type FriendData } from "../state";

const presenceUnsubs = new Map<string, Unsubscribe>();

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
        online: existing?.online ?? false,
        cooldownUntil: existing?.cooldownUntil,
      });
    }
    store.friends = list;
    markPanelsDirty();

    // (re)subscribe presence for the current set.
    presenceUnsubs.forEach((un) => un());
    presenceUnsubs.clear();
    for (const f of list) {
      const ref = r(paths.presenceOnline(f.uid));
      const un = onValue(ref, (psnap) => {
        const online = psnap.val() === true;
        const fr = store.friends.find((x) => x.uid === f.uid);
        if (fr && fr.online !== online) {
          fr.online = online;
          markPanelsDirty();
        }
      });
      presenceUnsubs.set(f.uid, un);
    }
  });
}
