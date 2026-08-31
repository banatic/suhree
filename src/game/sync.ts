import { onValue } from "firebase/database";
import { r, paths } from "../firebase/db";
import {
  store,
  markPanelsDirty,
  type UserRecord,
  type CropData,
  type WeedData,
} from "../state";

/** Subscribe to my own record, crops and weeds so the strip stays live. */
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
}
