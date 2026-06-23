//! Strip-window placement: compute geometry from taskbar/monitor/DPI, apply it.

pub mod geometry;
pub mod position;

pub use position::STRIP_LABEL;

use crate::state::{AppState, PhysRect};
use tauri::{AppHandle, Emitter, Manager};

/// Recompute the overlay geometry and apply it to the window, then notify JS.
///
/// Skips applying (but still records the latest rects) while a fullscreen app hides us.
pub fn recompute_and_apply(app: &AppHandle) {
    let state = app.state::<AppState>();
    let preferred = state.preferred_monitor.lock().unwrap().clone();
    let band_h = *state.band_height_logical.lock().unwrap();

    if let Some(geo) = geometry::compute(&preferred, band_h) {
        *state.window_rect.lock().unwrap() = PhysRect {
            x: geo.x,
            y: geo.y,
            w: geo.w,
            h: geo.h,
        };
        // Band rect in absolute physical coords (window origin + band offset).
        *state.band_rect.lock().unwrap() = PhysRect {
            x: geo.x + geo.band_x,
            y: geo.y + geo.band_y,
            w: geo.band_w,
            h: geo.band_h,
        };

        if !*state.hidden_fullscreen.lock().unwrap() {
            position::apply(app, &geo);
        }
        let _ = app.emit("strip-geometry-changed", geo);
    }
}
