import "./styles.css";
import { store, toast, markPanelsDirty } from "./state";
import { ensureSignedIn, ensureUserRecord } from "./firebase/auth";
import { setupPresence } from "./firebase/presence";
import { initServerTime } from "./firebase/time";
import { subscribeSelf } from "./game/sync";
import { subscribeFriends } from "./friends/list";
import { startDefenseWatch } from "./raid/controller";
import { startLoop } from "./game/loop";
import { setupStripInteractions, publishHitRegions } from "./render/strip";
import { startUpdateChecker } from "./update";
import {
  getStripGeometry,
  onGeometryChanged,
  onFullscreenChanged,
  isTauri,
} from "./platform/tauri";

const NICK_KEY = "suhree_nick";

function loadNickname(): string {
  let n = localStorage.getItem(NICK_KEY);
  if (!n) {
    n = "농부" + Math.floor(100 + Math.random() * 900);
    localStorage.setItem(NICK_KEY, n);
  }
  return n;
}

async function loadFont(): Promise<void> {
  // Make MulmaruMono available to the canvas (the @font-face only auto-loads for DOM text).
  try {
    await Promise.race([
      Promise.all([
        (document as any).fonts.load('16px "MulmaruMono"'),
        (document as any).fonts.load('bold 16px "MulmaruMono"'),
      ]),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  } catch {
    /* fall back to monospace */
  }
}

async function boot(): Promise<void> {
  await loadFont();
  setupStripInteractions();
  startLoop(); // render the (empty) band immediately while we connect
  initServerTime(); // sync the server-clock offset for robust cooldown math
  startUpdateChecker(); // background auto-update (Tauri only)

  // Window geometry / fullscreen events (no-ops in a plain browser).
  if (isTauri()) {
    store.geometry = await getStripGeometry();
    await onGeometryChanged((g) => {
      store.geometry = g;
      publishHitRegions();
    });
    await onFullscreenChanged((hidden) => {
      store.hiddenFullscreen = hidden;
    });
  }
  publishHitRegions();

  // Identity (anonymous auth → uid, no password).
  try {
    const nickname = loadNickname();
    const uid = await ensureSignedIn();
    store.uid = uid;
    const user = await ensureUserRecord(uid, nickname);
    store.user = user;
    localStorage.setItem(NICK_KEY, user.nickname);

    setupPresence(uid);
    subscribeSelf(uid);
    subscribeFriends(uid);
    startDefenseWatch(uid);

    store.ready = true;
    markPanelsDirty();
    toast(`${user.nickname}님 환영해요! 친구코드 ${user.friendCode}`, 5000);
  } catch (e) {
    console.error("boot failed", e);
    store.ready = true; // still show the band so the user sees something
    toast("서버 연결 실패 — 네트워크/Firebase 설정을 확인하세요", 6000);
  }
}

void boot();
