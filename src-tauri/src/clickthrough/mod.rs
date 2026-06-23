//! Partial click-through for the transparent overlay.
//!
//! Tauri has no per-region hit testing, so we run a Rust poll loop: read the *global*
//! cursor position (an ignore-events window receives no mousemove, so JS can't do this),
//! hit-test it against the regions JS pushed, and toggle `set_ignore_cursor_events` only
//! on state change.

pub mod hit_test;
pub mod regions;

pub use hit_test::spawn;
