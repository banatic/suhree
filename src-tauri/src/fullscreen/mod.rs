//! Fullscreen watchdog: hide the strip when a fullscreen app appears, restore it after.
//! Also re-runs geometry every ~2s so the strip follows taskbar/resolution/DPI changes.

use crate::platform::win;
use crate::state::AppState;
use crate::window::{self, STRIP_LABEL};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut consecutive_fs: u8 = 0;
        let mut consecutive_clear: u8 = 0;
        let mut geo_tick: u8 = 0;

        loop {
            thread::sleep(Duration::from_millis(500));

            let state = app.state::<AppState>();
            let fs = win::fullscreen_app_present();
            let hidden = *state.hidden_fullscreen.lock().unwrap();

            // Debounce 2 consecutive readings to avoid alt-tab flicker.
            if fs {
                consecutive_fs = consecutive_fs.saturating_add(1);
                consecutive_clear = 0;
            } else {
                consecutive_clear = consecutive_clear.saturating_add(1);
                consecutive_fs = 0;
            }

            if !hidden && consecutive_fs >= 2 {
                *state.hidden_fullscreen.lock().unwrap() = true;
                if let Some(w) = app.get_webview_window(STRIP_LABEL) {
                    let _ = w.hide();
                }
                let _ = app.emit("fullscreen-changed", true);
            } else if hidden && consecutive_clear >= 2 {
                *state.hidden_fullscreen.lock().unwrap() = false;
                window::recompute_and_apply(&app);
                // Don't resurrect a strip the user hid on purpose — only the fullscreen-driven hide.
                if !*state.manual_hidden.lock().unwrap() {
                    if let Some(w) = app.get_webview_window(STRIP_LABEL) {
                        let _ = w.show();
                    }
                }
                let _ = app.emit("fullscreen-changed", false);
            }

            // Periodic geometry refresh (~every 2s) while visible.
            geo_tick = geo_tick.wrapping_add(1);
            if geo_tick % 4 == 0 && !*state.hidden_fullscreen.lock().unwrap() {
                window::recompute_and_apply(&app);
            }
        }
    });
}
