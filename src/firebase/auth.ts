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
    const n = (nickname || "").trim().slice(0, 16);
    if (n && n !== val.nickname) {
      if (n === "정충봉" && uid !== "U4XnjRKBRdUb2qC6qmyszyDSVY12") {
        // Skip updating to "정충봉" for non-admin
      } else {
        await update(r(paths.user(uid)), { nickname: n });
        val.nickname = n;
      }
    }
    // Force check in case database already had "정충봉" for non-admin
    if (val.nickname === "정충봉" && uid !== "U4XnjRKBRdUb2qC6qmyszyDSVY12") {
      const fallback = "농부" + Math.floor(100 + Math.random() * 900);
      await update(r(paths.user(uid)), { nickname: fallback });
      val.nickname = fallback;
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

  let finalNick = (nickname || "").trim().slice(0, 16) || "농부";
  if (finalNick === "정충봉" && uid !== "U4XnjRKBRdUb2qC6qmyszyDSVY12") {
    finalNick = "농부" + Math.floor(100 + Math.random() * 900);
  }

  const record: UserRecord = {
    nickname: finalNick,
    friendCode: code,
    coins: BALANCE.economy.startingCoins,
    scarecrowLv: 0,
    scytheLv: 0,
    plotSize: BALANCE.shop.plotExpansion.startSlots,
    equippedDecor: "decor_none",
    equippedMsgSkin: "skin_plain",
    equippedTheme: "theme_day",
    equippedTitle: "title_none",
    equippedCursor: "cursor_default",
    equippedWeedSkin: "weed_default",
  };
  await set(r(paths.user(uid)), record);
  return record;
}

/** Rename (1–16 chars). The self-subscription propagates the change into the store. */
export async function setNickname(uid: string, nickname: string): Promise<void> {
  const n = (nickname || "").trim().slice(0, 16);
  if (!n) return;
  if (n === "정충봉" && uid !== "U4XnjRKBRdUb2qC6qmyszyDSVY12") {
    throw new Error("관리자의 아이디입니다.");
  }
  await update(r(paths.user(uid)), { nickname: n });
}
