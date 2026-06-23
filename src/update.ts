// Auto-update (Tauri updater plugin). Mirrors Hypercool: poll a raw-GitHub latest.json,
// verify the minisign signature against the pubkey in tauri.conf.json, install, relaunch.
// No-ops outside the Tauri shell (e.g. `npm run dev` in a browser).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./platform/tauri";
import { toast } from "./state";

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min, like Hypercool's poller

export async function checkForUpdates(silent = true): Promise<void> {
  if (!isTauri()) return;
  try {
    const update = await check();
    if (!update) {
      if (!silent) toast("이미 최신 버전이에요");
      return;
    }
    toast(`업데이트 ${update.version} 받는 중...`, 8000);
    await update.downloadAndInstall();
    toast("업데이트 완료! 재시작합니다", 4000);
    await relaunch();
  } catch (e) {
    console.error("update check failed", e);
    if (!silent) toast("업데이트 확인 실패");
  }
}

export function startUpdateChecker(): void {
  if (!isTauri()) return;
  void checkForUpdates(true);
  setInterval(() => void checkForUpdates(true), CHECK_INTERVAL_MS);
}
