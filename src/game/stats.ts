// 서리 통계. Every successful 서리 (stole ≥1 crop) bumps the raider's OWN stats node — lifetime
// totals + a today (KST) bucket, each split into an aggregate and a per-victim breakdown. Nobody
// writes anyone else's node, yet the head-to-head reads out symmetric: what I did to a friend lives
// in MY vs[friend]; what they did to me lives in THEIR vs[me]. And since you can only raid friends,
// summing every friend's vs[me] gives my complete "당한 서리" totals — no cross-writes, no feed
// scraping, no Cloud Functions. Stored at stats/{uid}; read is open (auth), write is owner-only.

import { get, runTransaction } from "firebase/database";
import { r, paths } from "../firebase/db";
import { store } from "../state";
import { serverNow } from "../firebase/time";

export interface StatBucket {
  raids: number; // successful 서리 runs (stole ≥1 crop)
  crops: number; // crops stolen
  coins: number; // coins looted
}

export interface StatsData {
  out: StatBucket; // lifetime aggregate (me as raider)
  vs: Record<string, StatBucket>; // lifetime per victim
  day: { date: string; out: StatBucket; vs: Record<string, StatBucket> }; // today (KST) buckets
}

export const EMPTY_BUCKET: StatBucket = Object.freeze({ raids: 0, crops: 0, coins: 0 });

function emptyBucket(): StatBucket {
  return { raids: 0, crops: 0, coins: 0 };
}

/** Coerce any stored value into a clean StatBucket (defends the UI against junk/partial writes). */
export function bucketOf(b: any): StatBucket {
  return {
    raids: Math.max(0, Number(b?.raids) || 0),
    crops: Math.max(0, Number(b?.crops) || 0),
    coins: Math.max(0, Number(b?.coins) || 0),
  };
}

function bucketMap(m: any): Record<string, StatBucket> {
  const out: Record<string, StatBucket> = {};
  if (m && typeof m === "object") {
    for (const [k, v] of Object.entries(m)) out[k] = bucketOf(v);
  }
  return out;
}

/** Normalize a raw stats snapshot into a fully-shaped StatsData (every field present). */
export function normalizeStats(v: any): StatsData {
  return {
    out: bucketOf(v?.out),
    vs: bucketMap(v?.vs),
    day: {
      date: typeof v?.day?.date === "string" ? v.day.date : "",
      out: bucketOf(v?.day?.out),
      vs: bucketMap(v?.day?.vs),
    },
  };
}

/** KST (UTC+9) calendar day key "YYYY-MM-DD" for an epoch-ms instant (matches the 점지 panel's day). */
export function kstDayKey(ms: number): string {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's KST day key on the server clock. */
export function todayKey(): string {
  return kstDayKey(serverNow());
}

/**
 * Record one successful 서리 against `victimUid` (count crops for `coins`). Owner-only write to my
 * own stats node; fire-and-forget (the loot was already credited). No-op for count ≤ 0.
 */
export async function recordRaidStat(victimUid: string, coins: number, count: number): Promise<void> {
  const uid = store.uid;
  if (!uid || !victimUid || count <= 0) return;
  const c = Math.max(0, Math.floor(count));
  const g = Math.max(0, Math.floor(coins));
  const today = todayKey();
  const bump = (b: any): StatBucket => {
    const cur = bucketOf(b);
    return { raids: cur.raids + 1, crops: cur.crops + c, coins: cur.coins + g };
  };
  try {
    await runTransaction(r(paths.stats(uid)), (cur: any) => {
      const s = cur && typeof cur === "object" ? cur : {};
      // lifetime
      s.out = bump(s.out);
      s.vs = s.vs && typeof s.vs === "object" ? s.vs : {};
      s.vs[victimUid] = bump(s.vs[victimUid]);
      // today — reset the whole bucket when the KST day has rolled over
      if (!s.day || typeof s.day !== "object" || s.day.date !== today) {
        s.day = { date: today, out: emptyBucket(), vs: {} };
      }
      s.day.out = bump(s.day.out);
      s.day.vs = s.day.vs && typeof s.day.vs === "object" ? s.day.vs : {};
      s.day.vs[victimUid] = bump(s.day.vs[victimUid]);
      return s;
    });
  } catch {
    /* ignore transient write errors — the loot was already paid out */
  }
}

/** Read + normalize one user's stats (null if unreadable/absent). */
export async function fetchStats(uid: string): Promise<StatsData | null> {
  try {
    const v = (await get(r(paths.stats(uid)))).val();
    return v ? normalizeStats(v) : null;
  } catch {
    return null;
  }
}
