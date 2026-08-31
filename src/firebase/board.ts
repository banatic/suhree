// 공용 낙서장 — one shared wall for the whole server. You reach it from the chest in the raid view,
// so a raid on a bare plot still has something in it.
//
// Unlike chat, this is NOT subscribed at boot: the entries are far bulkier than a chat line, and
// nothing outside the open board needs them. subscribeBoard() runs only while the board is on
// screen and returns its own unsubscribe.

import { push, set, remove, get, query, limitToLast, onValue, type Unsubscribe } from "firebase/database";
import { r, paths } from "./db";
import { store } from "../state";
import { BALANCE } from "../config/balance";

export interface BoardEntry {
  id: string;
  uid: string;
  nick: string;
  art: string;
  at: number;
}

function parse(v: Record<string, any> | null | undefined): BoardEntry[] {
  return Object.entries(v || {})
    .map(([id, e]: [string, any]) => ({ id, uid: e?.uid ?? "", nick: e?.nick ?? "", art: e?.art ?? "", at: e?.at ?? 0 }))
    .filter((e) => e.art)
    .sort((a, b) => a.at - b.at); // oldest first: later scribbles paint over earlier ones
}

/** Watch the newest `keep` scribbles for as long as the board is open. */
export function subscribeBoard(onChange: (entries: BoardEntry[]) => void): Unsubscribe {
  const q = query(r(paths.board()), limitToLast(BALANCE.doodle.board.keep));
  return onValue(q, (snap) => onChange(parse(snap.val())));
}

/** Add my scribble to the wall. False if there's nothing to post or the write is refused. */
export async function postToBoard(art: string): Promise<boolean> {
  if (!art || art.length > BALANCE.doodle.board.maxLen) return false;
  const nick = (store.user?.nickname || "농부").slice(0, 16);
  try {
    await set(push(r(paths.board())), { uid: store.uid, nick, art, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** Rub out everything I drew (the rule lets an author delete their own entries, nobody else's).
 *  Returns how many were removed. */
export async function eraseMyBoardEntries(): Promise<number> {
  try {
    const snap = await get(query(r(paths.board()), limitToLast(BALANCE.doodle.board.keep)));
    const mine = parse(snap.val()).filter((e) => e.uid === store.uid);
    await Promise.all(mine.map((e) => remove(r(paths.boardEntry(e.id))).catch(() => {})));
    return mine.length;
  } catch {
    return 0;
  }
}
