//! Tauri command surface exposed to the webview.

use crate::platform::win;
use crate::state::{AppState, NormRect, StripGeometry};
use crate::window;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn get_strip_geometry(state: State<AppState>) -> Option<StripGeometry> {
    let preferred = state.preferred_monitor.lock().unwrap().clone();
    let band_h = *state.band_height_logical.lock().unwrap();
    window::geometry::compute(&preferred, band_h)
}

#[tauri::command]
pub fn apply_strip_position(app: AppHandle) {
    window::recompute_and_apply(&app);
}

#[tauri::command]
pub fn show_strip(app: AppHandle) {
    if let Some(w) = app.get_webview_window(window::STRIP_LABEL) {
        let _ = w.show();
    }
}

#[tauri::command]
pub fn hide_strip(app: AppHandle) {
    if let Some(w) = app.get_webview_window(window::STRIP_LABEL) {
        let _ = w.hide();
    }
}

/// JS pushes the interactive regions (window-normalised 0..1) — band + any open panel.
#[tauri::command]
pub fn update_hit_regions(state: State<AppState>, regions: Vec<NormRect>) {
    *state.hit_regions.lock().unwrap() = regions;
}

/// Force the whole window to capture the cursor (e.g. a blocking modal). Default: true = normal.
#[tauri::command]
pub fn set_clickthrough_enabled(state: State<AppState>, enabled: bool) {
    *state.clickthrough_enabled.lock().unwrap() = enabled;
}

#[tauri::command]
pub fn is_fullscreen_active(state: State<AppState>) -> bool {
    *state.hidden_fullscreen.lock().unwrap()
}

#[tauri::command]
pub fn set_preferred_monitor(app: AppHandle, state: State<AppState>, monitor: String) {
    *state.preferred_monitor.lock().unwrap() = monitor;
    window::recompute_and_apply(&app);
}

/// Cursor normalised into the crop-band rect (0..1, clamped). Used by the owner to stream
/// their cursor while their own plot is being raided. Returns None if geometry isn't ready.
#[tauri::command]
pub fn get_cursor_in_band(state: State<AppState>) -> Option<(f64, f64)> {
    let (cx, cy) = win::cursor_pos()?;
    let band = *state.band_rect.lock().unwrap();
    if band.w <= 0 || band.h <= 0 {
        return None;
    }
    let nx = ((cx - band.x) as f64 / band.w as f64).clamp(0.0, 1.0);
    let ny = ((cy - band.y) as f64 / band.h as f64).clamp(0.0, 1.0);
    Some((nx, ny))
}
