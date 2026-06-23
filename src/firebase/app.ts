import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { firebaseConfig } from "../config/firebase";

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Keep the anonymous uid across restarts (webview IndexedDB). Best-effort.
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* persistence may be unavailable in some webviews; uid will be ephemeral */
});
