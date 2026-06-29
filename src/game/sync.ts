import { onValue } from "firebase/database";
import { r, paths } from "../firebase/db";
import {
  store,
  markPanelsDirty,
  type UserRecord,
  type CropData,
  type WeedData,
  type LeftMessage,
} from "../state";

/** Subscribe to my own record, crops and messages so the strip stays live. */
export function subscribeSelf(uid: string): void {
  onValue(r(paths.user(uid)), (snap) => {
    if (snap.exists()) {
      store.user = snap.val() as UserRecord;
      markPanelsDirty();
    }
  });

  onValue(r(paths.crops(uid)), (snap) => {
    store.crops = (snap.val() as Record<string, CropData>) || {};
  });

  onValue(r(paths.weeds(uid)), (snap) => {
    store.weeds = (snap.val() as Record<string, WeedData>) || {};
    markPanelsDirty();
  });

  onValue(r(paths.messages(uid)), (snap) => {
    const v = (snap.val() as Record<string, any>) || {};
    store.messages = Object.entries(v)
      .map(([id, m]) => ({ id, from: m.from, text: m.text, at: m.at, skin: m.skin }) as LeftMessage)
      .sort((a, b) => b.at - a.at);
    markPanelsDirty();
  });
}
