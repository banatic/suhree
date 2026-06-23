// Wrappers around the Rust command/event surface. All are no-ops in a plain browser so the
// UI can be developed with `npm run dev` opened in a normal browser tab.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface StripGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  band_x: number;
  band_y: number;
  band_w: number;
  band_h: number;
  band_dock: "top" | "bottom";
  edge: string;
  scale: number;
  monitor_x: number;
  monitor_y: number;
  monitor_w: number;
  monitor_h: number;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isTauri(): boolean {
  return (
    typeof (window as any).__TAURI_INTERNALS__ !== "undefined" ||
    typeof (window as any).__TAURI__ !== "undefined"
  );
}

export async function getStripGeometry(): Promise<StripGeometry | null> {
  if (!isTauri()) return null;
  try {
    return (await invoke("get_strip_geometry")) as StripGeometry | null;
  } catch {
    return null;
  }
}

export async function applyStripPosition(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("apply_strip_position");
  } catch {
    /* ignore */
  }
}

export async function updateHitRegions(regions: NormRect[]): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("update_hit_regions", { regions });
  } catch {
    /* ignore */
  }
}

export async function setPreferredMonitor(monitor: "primary" | "cursor"): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_preferred_monitor", { monitor });
  } catch {
    /* ignore */
  }
}

/** Owner's cursor normalised to the crop band (0..1), or null. Used during a raid only. */
export async function getCursorInBand(): Promise<[number, number] | null> {
  if (!isTauri()) return null;
  try {
    return (await invoke("get_cursor_in_band")) as [number, number] | null;
  } catch {
    return null;
  }
}

export async function onGeometryChanged(
  cb: (g: StripGeometry) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return async () => {};
  return listen<StripGeometry>("strip-geometry-changed", (e) => cb(e.payload));
}

export async function onFullscreenChanged(
  cb: (hidden: boolean) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return async () => {};
  return listen<boolean>("fullscreen-changed", (e) => cb(e.payload));
}

/** Fires when the cursor enters/leaves the interactive strip area (drives the hover HUD). */
export async function onStripHover(cb: (hovering: boolean) => void): Promise<UnlistenFn> {
  if (!isTauri()) return async () => {};
  return listen<boolean>("strip-hover", (e) => cb(e.payload));
}
