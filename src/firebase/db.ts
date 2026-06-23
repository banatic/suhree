import { ref, type DatabaseReference } from "firebase/database";
import { db } from "./app";

export const paths = {
  user: (uid: string) => `users/${uid}`,
  userCoins: (uid: string) => `users/${uid}/coins`,
  friendCode: (code: string) => `friendCodes/${code}`,
  presence: (uid: string) => `presence/${uid}`,
  presenceOnline: (uid: string) => `presence/${uid}/online`,
  friends: (uid: string) => `friends/${uid}`,
  plot: (uid: string) => `plots/${uid}`,
  crops: (uid: string) => `plots/${uid}/crops`,
  crop: (uid: string, slot: string | number) => `plots/${uid}/crops/${slot}`,
  raid: (targetUid: string) => `raids/${targetUid}`,
  raidCursor: (targetUid: string) => `raids/${targetUid}/ownerCursor`,
  raidEvicted: (targetUid: string) => `raids/${targetUid}/evicted`,
  cooldown: (targetUid: string, raiderUid: string) => `cooldowns/${targetUid}/${raiderUid}`,
  messages: (uid: string) => `messages/${uid}`,
};

export function r(path: string): DatabaseReference {
  return ref(db, path);
}
