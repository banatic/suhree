import { runTransaction } from "firebase/database";
import { r, paths } from "../firebase/db";
import { BALANCE } from "../config/balance";
import { store } from "../state";

/** Atomically add coins (delta may be negative). Clamped to [0, maxCoins]. Returns new balance. */
export async function addCoins(uid: string, delta: number): Promise<number> {
  const res = await runTransaction(r(paths.userCoins(uid)), (cur) => {
    const have = typeof cur === "number" ? cur : 0;
    const next = have + delta;
    if (next < 0) return; // abort
    return Math.min(next, BALANCE.economy.maxCoins);
  });
  if (res.committed && typeof res.snapshot.val() === "number") {
    if (store.user) store.user.coins = res.snapshot.val();
    return res.snapshot.val();
  }
  return store.user?.coins ?? 0;
}

/** Atomic spend; false if not enough coins. */
export async function trySpend(uid: string, cost: number): Promise<boolean> {
  if (cost <= 0) return true;
  const res = await runTransaction(r(paths.userCoins(uid)), (cur) => {
    const have = typeof cur === "number" ? cur : 0;
    if (have < cost) return; // abort
    return have - cost;
  });
  if (res.committed) {
    if (store.user && typeof res.snapshot.val() === "number") {
      store.user.coins = res.snapshot.val();
    }
    return true;
  }
  return false;
}
