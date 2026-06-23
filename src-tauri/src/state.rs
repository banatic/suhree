//! Shared application state for the strip overlay.
//!
//! All geometry stored here is in *physical pixels* (screen coordinates), because the
//! process is Per-Monitor-V2 DPI aware (Tauri sets this) so Win32 screen coords, the
//! cursor position, and Tauri `PhysicalPosition`/`PhysicalSize` all share one space.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// A rectangle in physical screen pixels.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PhysRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl PhysRect {
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && py >= self.y && px <= self.x + self.w && py <= self.y + self.h
    }
}

/// A rectangle normalised to the overlay window (0..1 in both axes), pushed from JS.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct NormRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Full geometry description handed to the frontend so it can lay out the band/panel.
#[derive(Clone, Debug, Serialize)]
pub struct StripGeometry {
    /// Overlay window rect (physical px). Tall + transparent; mostly click-through.
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// The crop "band" within the window, in *window-local* physical px.
    pub band_x: i32,
    pub band_y: i32,
    pub band_w: i32,
    pub band_h: i32,
    /// "top" | "bottom" — which side of the window the band is docked to.
    pub band_dock: String,
    /// Detected taskbar edge: "top" | "bottom" | "left" | "right" | "none".
    pub edge: String,
    /// DPI scale of the chosen monitor (dpi / 96).
    pub scale: f64,
    /// Chosen monitor rect (physical px), for debugging / future use.
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_w: i32,
    pub monitor_h: i32,
}

pub struct AppState {
    /// Overlay window rect (physical px) — basis for cursor→window normalisation.
    pub window_rect: Mutex<PhysRect>,
    /// Crop band rect in *absolute* physical px — basis for owner-cursor normalisation.
    pub band_rect: Mutex<PhysRect>,
    /// Interactive regions (window-normalised) pushed from JS; cursor over any = capture.
    pub hit_regions: Mutex<Vec<NormRect>>,
    /// When false, the whole window captures the cursor (no pass-through).
    pub clickthrough_enabled: Mutex<bool>,
    /// True while hidden because a fullscreen app is in the foreground.
    pub hidden_fullscreen: Mutex<bool>,
    /// "primary" | "cursor" — which monitor to dock to.
    pub preferred_monitor: Mutex<String>,
    /// Logical height of the crop band (px @ 96dpi).
    pub band_height_logical: Mutex<i32>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            window_rect: Mutex::new(PhysRect { x: 0, y: 0, w: 1280, h: 480 }),
            band_rect: Mutex::new(PhysRect { x: 0, y: 0, w: 1280, h: 36 }),
            hit_regions: Mutex::new(Vec::new()),
            clickthrough_enabled: Mutex::new(true),
            hidden_fullscreen: Mutex::new(false),
            preferred_monitor: Mutex::new("primary".to_string()),
            band_height_logical: Mutex::new(36),
        }
    }
}
