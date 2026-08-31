// 낙서장 — every farm has one wall of its own. A raider scribbles on the plot owner's board (the
// chest in the raid view opens THEIR board), and the owner reads their own from the HUD to see what
// visitors left. Several people can add to the same wall: each scribble is its own record, so two
// raiders drawing at once never overwrite each other.
//
// Unlike chat, this is NOT subscribed at boot: the entries are far bulkier than a chat line, and
// nothing outside the open board needs them. subscribeBoard() runs only while a board is on screen
// and returns its own unsubscribe.

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

/** Watch one farm's newest `keep` scribbles for as long as its board is open. */
export function subscribeBoard(ownerUid: string, onChange: (entries: BoardEntry[]) => void): Unsubscribe {
  const q = query(r(paths.board(ownerUid)), limitToLast(BALANCE.doodle.board.keep));
  return onValue(q, (snap) => onChange(parse(snap.val())));
}

/** Add my scribble to `ownerUid`'s wall. False if there's nothing to post or the write is refused. */
export async function postToBoard(ownerUid: string, art: string): Promise<boolean> {
  if (!ownerUid || !art || art.length > BALANCE.doodle.board.maxLen) return false;
  const nick = (store.user?.nickname || "농부").slice(0, 16);
  try {
    await set(push(r(paths.board(ownerUid))), { uid: store.uid, nick, art, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rub scribbles off `ownerUid`'s wall and report how many went.
 *
 * On someone else's board this only reaches my OWN scribbles — the rule lets an author delete what
 * they wrote and nothing more. On my own board it clears everything, because a wall strangers can
 * draw on is only fair if its owner can wipe it.
 */
export async function eraseFromBoard(ownerUid: string): Promise<number> {
  try {
    const snap = await get(query(r(paths.board(ownerUid)), limitToLast(BALANCE.doodle.board.keep)));
    const all = parse(snap.val());
    const doomed = ownerUid === store.uid ? all : all.filter((e) => e.uid === store.uid);
    await Promise.all(doomed.map((e) => remove(r(paths.boardEntry(ownerUid, e.id))).catch(() => {})));
    return doomed.length;
  } catch {
    return 0;
  }
}
