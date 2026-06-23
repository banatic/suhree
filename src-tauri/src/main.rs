// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clickthrough;
mod commands;
mod fullscreen;
mod platform;
mod state;
mod window;

use state::AppState;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_strip_geometry,
            commands::apply_strip_position,
            commands::show_strip,
            commands::hide_strip,
            commands::update_hit_regions,
            commands::set_clickthrough_enabled,
            commands::is_fullscreen_active,
            commands::set_preferred_monitor,
            commands::get_cursor_in_band,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Position the strip before showing it, so it never flashes at (0,0).
            window::recompute_and_apply(&handle);
            if let Some(win) = app.get_webview_window(window::STRIP_LABEL) {
                let _ = win.set_ignore_cursor_events(true);
                let _ = win.show();
            }

            clickthrough::spawn(handle.clone());
            fullscreen::spawn(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running suhree");
}
