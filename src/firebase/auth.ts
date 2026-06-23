import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { get, set, update } from "firebase/database";
import { auth } from "./app";
import { r, paths } from "./db";
import { BALANCE } from "../config/balance";
import type { UserRecord } from "../state";

/** Resolve once we have an anonymous uid (no password). */
export function ensureSignedIn(): Promise<string> {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
    signInAnonymously(auth).catch(reject);
  });
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L
function genFriendCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/** Load the user record, creating it (with a unique friend code) on first run. */
export async function ensureUserRecord(uid: string, nickname: string): Promise<UserRecord> {
  const snap = await get(r(paths.user(uid)));
  if (snap.exists()) {
    const val = snap.val() as UserRecord;
    if (nickname && nickname !== val.nickname) {
      await update(r(paths.user(uid)), { nickname });
      val.nickname = nickname;
    }
    return val;
  }

  // Claim a unique friend code (claim-once index enforced by the rules).
  let code = genFriendCode();
  for (let tries = 0; tries < 10; tries++) {
    const cref = r(paths.friendCode(code));
    const csnap = await get(cref);
    if (!csnap.exists()) {
      try {
        await set(cref, uid);
        break;
      } catch {
        /* lost the race, regenerate */
      }
    }
    code = genFriendCode();
  }

  const record: UserRecord = {
    nickname: nickname || "농부",
    friendCode: code,
    coins: BALANCE.economy.startingCoins,
    scarecrowLv: 0,
    scytheLv: 0,
    plotSize: BALANCE.shop.plotExpansion.startSlots,
    equippedDecor: "decor_none",
    equippedMsgSkin: "skin_plain",
  };
  await set(r(paths.user(uid)), record);
  return record;
}

/** Rename (1–16 chars). The self-subscription propagates the change into the store. */
export async function setNickname(uid: string, nickname: string): Promise<void> {
  const n = (nickname || "").trim().slice(0, 16);
  if (!n) return;
  await update(r(paths.user(uid)), { nickname: n });
}
