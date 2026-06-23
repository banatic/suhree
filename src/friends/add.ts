import { get, set } from "firebase/database";
import { r, paths } from "../firebase/db";
import { toast, markPanelsDirty } from "../state";

export async function addFriendByCode(uid: string, codeRaw: string): Promise<boolean> {
  const code = (codeRaw || "").trim().toUpperCase();
  if (code.length < 4) {
    toast("친구코드를 입력하세요");
    return false;
  }
  const snap = await get(r(paths.friendCode(code)));
  if (!snap.exists()) {
    toast("그런 친구코드가 없어요");
    return false;
  }
  const fuid = snap.val() as string;
  if (fuid === uid) {
    toast("자기 자신은 추가할 수 없어요");
    return false;
  }
  // Friendship is one-directional (you can only write your own list). Adding someone lets
  // YOU raid them; they add you back with your code to raid you. The raid rule checks that
  // the raider has the target in their own friends list.
  await set(r(`friends/${uid}/${fuid}`), true);
  toast("친구를 추가했어요!");
  markPanelsDirty();
  return true;
}
