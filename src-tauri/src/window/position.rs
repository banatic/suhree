//! Apply a computed geometry to the overlay window (physical px, no DPI re-scaling).

use crate::state::StripGeometry;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

pub const STRIP_LABEL: &str = "strip";

pub fn apply(app: &AppHandle, geo: &StripGeometry) {
    if let Some(win) = app.get_webview_window(STRIP_LABEL) {
        let _ = win.set_size(PhysicalSize::new(geo.w.max(1) as u32, geo.h.max(1) as u32));
        let _ = win.set_position(PhysicalPosition::new(geo.x, geo.y));
        let _ = win.set_always_on_top(true);
    }
}
