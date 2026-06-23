// Procedural sound effects via WebAudio (no asset files). Best-effort; silent on failure.

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
