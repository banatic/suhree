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
  // The defender publishes ONE shared cursor; every raider on this field dodges it.
  raidOwnerCursor: (targetUid: string) => `raids/${targetUid}/ownerCursor`,
  // Each raider owns their own slot under raiders/{raiderUid} — no lock, no contention.
  raidRaiders: (targetUid: string) => `raids/${targetUid}/raiders`,
  raidRaider: (targetUid: string, raiderUid: string) => `raids/${targetUid}/raiders/${raiderUid}`,
  raidRaiderCursor: (targetUid: string, raiderUid: string) =>
    `raids/${targetUid}/raiders/${raiderUid}/cursor`,
  raidRaiderEvicted: (targetUid: string, raiderUid: string) =>
    `raids/${targetUid}/raiders/${raiderUid}/evicted`,
  raidRaiderEvictHits: (targetUid: string, raiderUid: string) =>
    `raids/${targetUid}/raiders/${raiderUid}/evictHits`,
  cooldown: (targetUid: string, raiderUid: string) => `cooldowns/${targetUid}/${raiderUid}`,
  messages: (uid: string) => `messages/${uid}`,
  chat: () => `chat`,
  raidlog: () => `raidlog`,
};

export function r(path: string): DatabaseReference {
  return ref(db, path);
}
