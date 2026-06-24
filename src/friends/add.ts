import { get, ref, update } from "firebase/database";
import { db } from "../firebase/app";
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
  // Mutual: one add wires up BOTH sides in a single atomic multi-location write.
  // The rules let me write `true` into someone else's list only under my own uid key
  // ($friendUid === auth.uid), so the reciprocal link is created here, no consent step.
  // Both directions matter because the raid rule requires the raider to have the target
  // in the raider's OWN friends list.
  try {
    await update(ref(db), {
      [`friends/${uid}/${fuid}`]: true,
      [`friends/${fuid}/${uid}`]: true,
    });
  } catch (e) {
    console.error("addFriend failed", e);
    toast("친구 추가에 실패했어요");
    return false;
  }
  toast("서로 친구가 되었어요!");
  markPanelsDirty();
  return true;
}
