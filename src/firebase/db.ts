import { ref, type DatabaseReference } from "firebase/database";
import { db } from "./app";

export const paths = {
  user: (uid: string) => `users/${uid}`,
  userCoins: (uid: string) => `users/${uid}/coins`,
  dexTier: (uid: string, tier: number) => `users/${uid}/dex/${tier}`,
  dexClaimed: (uid: string) => `users/${uid}/dexClaimed`,
  friendCode: (code: string) => `friendCodes/${code}`,
  presence: (uid: string) => `presence/${uid}`,
  presenceConnections: (uid: string) => `presence/${uid}/connections`,
  presenceLastSeen: (uid: string) => `presence/${uid}/lastSeen`,
  friends: (uid: string) => `friends/${uid}`,
  plot: (uid: string) => `plots/${uid}`,
  crops: (uid: string) => `plots/${uid}/crops`,
  crop: (uid: string, slot: string | number) => `plots/${uid}/crops/${slot}`,
  weeds: (uid: string) => `plots/${uid}/weeds`,
  weed: (uid: string, slot: string | number) => `plots/${uid}/weeds/${slot}`,
  raid: (targetUid: string) => `raids/${targetUid}`,
  raidCursor: (targetUid: string) => `raids/${targetUid}/ownerCursor`,
  raidRaiderCursor: (targetUid: string) => `raids/${targetUid}/raiderCursor`,
  raidEvicted: (targetUid: string) => `raids/${targetUid}/evicted`,
  raidEvictHits: (targetUid: string) => `raids/${targetUid}/evictHits`,
  cooldown: (targetUid: string, raiderUid: string) => `cooldowns/${targetUid}/${raiderUid}`,
  messages: (uid: string) => `messages/${uid}`,
  chat: () => `chat`,
  raidlog: () => `raidlog`,
};

export function r(path: string): DatabaseReference {
  return ref(db, path);
}
