//! 60 Hz cursor poll → toggle click-through.

use super::regions;
use crate::state::AppState;
use crate::window::STRIP_LABEL;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        // Window starts ignoring the cursor (created with no decorations, click-through on).
        let mut last_ignore = true;
        loop {
            thread::sleep(Duration::from_millis(16));
            let state = app.state::<AppState>();

            // While hidden by a fullscreen app, leave it click-through and idle.
            if *state.hidden_fullscreen.lock().unwrap() {
                continue;
            }

            let enabled = *state.clickthrough_enabled.lock().unwrap();
            let want_capture = if !enabled {
                // Click-through disabled → the whole window grabs the cursor.
                true
            } else if let Some((cx, cy)) = crate::platform::win::cursor_pos() {
                let rect = *state.window_rect.lock().unwrap();
                if let Some((nx, ny)) = regions::normalize(&rect, cx, cy) {
                    let regs = state.hit_regions.lock().unwrap();
                    regions::point_over(&regs, nx, ny)
                } else {
                    false
                }
            } else {
                false
            };

            let ignore = !want_capture;
            if ignore != last_ignore {
                if let Some(win) = app.get_webview_window(STRIP_LABEL) {
                    let _ = win.set_ignore_cursor_events(ignore);
                }
                // Tell the webview whether the cursor is over the strip, so it can roll the
                // HUD up/down. An ignore-events window gets no mouseleave, so this is the
                // reliable hover signal.
                let _ = app.emit("strip-hover", want_capture);
                last_ignore = ignore;
            }
        }
    });
}
