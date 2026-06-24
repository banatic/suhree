// Forced auto-update (Tauri updater plugin). Mirrors Hypercool: poll a raw-GitHub latest.json,
// verify the minisign signature against the pubkey in tauri.conf.json, install, relaunch.
// MANDATORY: the moment a newer version is found we block the UI, install it, and relaunch —
// the user cannot keep playing an out-of-date build. No-ops outside the Tauri shell (npm run dev).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./platform/tauri";
import { toast } from "./state";
import { BALANCE } from "./config/balance";

let busy = false; // a check/install is in flight — don't let the timer stack calls
let committed = false; // an update was found; we are committed to installing + relaunching

function overlay(): HTMLDivElement {
  let el = document.getElementById("update-overlay") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "update-overlay";
    document.body.appendChild(el);
  }
  return el;
}

function showOverlay(msg: string): void {
  const el = overlay();
  el.textContent = msg;
  el.style.display = "block";
}

function hideOverlay(): void {
  const el = document.getElementById("update-overlay");
  if (el) el.style.display = "none";
}

export async function checkForUpdates(silent = true): Promise<void> {
  if (!isTauri()) return;
  if (busy || committed) return; // never re-enter mid-install
  busy = true;
  try {
    const update = await check();
    if (!update) {
      if (!silent) toast("이미 최신 버전이에요");
      return;
    }
    // Version mismatch → mandatory. Commit, block the strip, install, relaunch.
    committed = true;
    showOverlay(`새 버전 ${update.version} 적용 중…`);
    await update.downloadAndInstall();
    showOverlay("업데이트 완료! 다시 시작합니다…");
    await relaunch();
  } catch (e) {
    console.error("update check/install failed", e);
    committed = false; // let the next tick retry (e.g. transient network failure)
    hideOverlay();
    if (!silent) toast("업데이트 확인 실패");
  } finally {
    busy = false;
  }
}

export function startUpdateChecker(): void {
  if (!isTauri()) return;
  void checkForUpdates(true); // check immediately on launch — before the user settles in
  setInterval(() => void checkForUpdates(true), BALANCE.update.checkIntervalMs);
}
