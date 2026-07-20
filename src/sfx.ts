// Global procedural sound effects via WebAudio (no asset files). Best-effort; silent on failure.
// Grew out of raid/alarm.ts — every game-wide chirp lives here now, gated by store.soundEnabled.

import { store } from "./state";

let actx: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    if (!actx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      actx = new AC();
    }
    return actx;
  } catch {
    return null;
  }
}

function beep(freq: number, start: number, dur: number, vol = 0.14, type: OscillatorType = "square"): void {
  if (!store.soundEnabled) return;
  const a = ctx();
  if (!a) return;
  const t0 = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.connect(g);
  g.connect(a.destination);
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// ── Raid (서리) ──────────────────────────────────────────────────────────────

/** Intruder alert — two urgent rising beeps. */
export function playAlarm(): void {
  beep(660, 0, 0.18);
  beep(880, 0.18, 0.22);
}

/** Crops were stolen — a sad little descending tone (heard by the victim/thief). */
export function playSteal(): void {
  beep(520, 0, 0.16, 0.12, "triangle");
  beep(390, 0.16, 0.26, 0.12, "triangle");
}

/** Successful eviction / victory chirp. */
export function playWin(): void {
  beep(680, 0, 0.12, 0.12, "triangle");
  beep(900, 0.12, 0.18, 0.12, "triangle");
}

// ── Farming ─────────────────────────────────────────────────────────────────

/** Seed goes in the soil — one soft low "puck". */
export function playPlant(): void {
  beep(340, 0, 0.06, 0.09, "triangle");
  beep(250, 0.05, 0.1, 0.08, "triangle");
}

/** Harvest payout — a bright little coin ring. */
export function playHarvest(): void {
  beep(880, 0, 0.07, 0.1, "triangle");
  beep(1320, 0.06, 0.12, 0.1, "triangle");
}

/** One tug at a weed (progress click). */
export function playWeedTick(): void {
  beep(210, 0, 0.05, 0.08, "square");
}

/** Weed fully pulled — a quick relieved rustle. */
export function playWeedClear(): void {
  beep(300, 0, 0.07, 0.1, "triangle");
  beep(430, 0.06, 0.12, 0.1, "triangle");
}

// ── Shop / progression ──────────────────────────────────────────────────────

/** Cosmetic purchase — cheerful register chime. */
export function playBuy(): void {
  beep(620, 0, 0.08, 0.1, "triangle");
  beep(930, 0.08, 0.14, 0.1, "triangle");
}

/** Upgrade bought (강화/밭 확장) — three rising power notes. */
export function playUpgrade(): void {
  beep(440, 0, 0.08, 0.09, "square");
  beep(550, 0.08, 0.08, 0.09, "square");
  beep(660, 0.16, 0.14, 0.09, "square");
}

/** New crop discovered in the 도감 — a small sparkle arpeggio. */
export function playDexNew(): void {
  beep(1046, 0, 0.08, 0.09, "triangle");
  beep(1318, 0.08, 0.08, 0.09, "triangle");
  beep(1568, 0.16, 0.16, 0.09, "triangle");
}

/** 도감 완성 보상 — a proper little fanfare. */
export function playFanfare(): void {
  beep(523, 0, 0.1, 0.11, "triangle");
  beep(659, 0.1, 0.1, 0.11, "triangle");
  beep(784, 0.2, 0.1, 0.11, "triangle");
  beep(1046, 0.3, 0.28, 0.12, "triangle");
}

// ── Social / UI ─────────────────────────────────────────────────────────────

/** New chat message popup — a gentle KakaoTalk-ish ding-dong. */
export function playChatPop(): void {
  beep(780, 0, 0.08, 0.08, "sine");
  beep(620, 0.09, 0.14, 0.08, "sine");
}

/** Friend link created — a warm ascending pair. */
export function playFriend(): void {
  beep(520, 0, 0.1, 0.1, "triangle");
  beep(660, 0.1, 0.16, 0.1, "triangle");
}

/** Generic UI click — one tiny tick, quiet enough to never annoy. */
export function playClick(): void {
  beep(900, 0, 0.035, 0.045, "triangle");
}
