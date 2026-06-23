//! Pure geometry: pick a monitor, find its taskbar edge from the monitor/work-area gap,
//! and produce a tall transparent overlay rect plus the crop "band" sub-rect.
//!
//! The overlay window is taller than the band so panels (shop/friends) can render into
//! the transparent space without ever resizing the OS window. Everything is physical px.

use crate::platform::win::{self, MonitorData};
use crate::state::StripGeometry;
use windows_sys::Win32::Foundation::RECT;

/// Max overlay height @96dpi. The band sits at one end; the rest is transparent panel space.
const WINDOW_HEIGHT_LOGICAL: i32 = 480;

fn rect_contains(r: &RECT, x: i32, y: i32) -> bool {
    x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

fn pick_primary(monitors: &[MonitorData]) -> MonitorData {
    monitors
        .iter()
        .find(|m| m.primary)
        .copied()
        .unwrap_or(monitors[0])
}

/// Compute overlay geometry. `band_h_logical` is the crop-strip thickness @96dpi.
pub fn compute(preferred: &str, band_h_logical: i32) -> Option<StripGeometry> {
    let monitors = win::enum_monitors();
    if monitors.is_empty() {
        return None;
    }

    let chosen = match preferred {
        "cursor" => match win::cursor_pos() {
            Some((cx, cy)) => monitors
                .iter()
                .find(|m| rect_contains(&m.rc_monitor, cx, cy))
                .copied()
                .unwrap_or_else(|| pick_primary(&monitors)),
            None => pick_primary(&monitors),
        },
        _ => pick_primary(&monitors),
    };

    let mon = chosen.rc_monitor;
    let work = chosen.rc_work;
    let scale = chosen.dpi as f64 / 96.0;

    // Find the taskbar edge from the per-monitor (monitor − work-area) gap. This is more
    // reliable than ABM_GETTASKBARPOS, which only reports the primary monitor.
    let gap_left = work.left - mon.left;
    let gap_top = work.top - mon.top;
    let gap_right = mon.right - work.right;
    let gap_bottom = mon.bottom - work.bottom;
    let max_gap = gap_left.max(gap_top).max(gap_right).max(gap_bottom);

    let edge = if max_gap <= 0 {
        // No work-area gap (e.g. auto-hidden taskbar). Fall back to SHAppBarMessage,
        // which still reports the taskbar's edge even when it's hidden.
        match win::taskbar() {
            Some(tb) => match tb.edge {
                0 => "left",
                1 => "top",
                2 => "right",
                _ => "bottom",
            },
            None => "bottom",
        }
    } else if max_gap == gap_bottom {
        "bottom"
    } else if max_gap == gap_top {
        "top"
    } else if max_gap == gap_left {
        "left"
    } else {
        "right"
    };

    let band_h = ((band_h_logical as f64) * scale).round() as i32;
    let win_h_full = ((WINDOW_HEIGHT_LOGICAL as f64) * scale).round() as i32;

    // Width spans the work area (excludes a side/top taskbar so we never overlap it).
    let x = work.left;
    let w = (work.right - work.left).max(1);
    let work_h = (work.bottom - work.top).max(band_h);
    let win_h = win_h_full.min(work_h);

    // Only a top taskbar docks the band to the top of the window; in every other case
    // (bottom/left/right/none) the band is a horizontal strip at the bottom of the work area.
    let (y, band_y, band_dock) = if edge == "top" {
        (work.top, 0, "top")
    } else {
        (work.bottom - win_h, win_h - band_h, "bottom")
    };

    Some(StripGeometry {
        x,
        y,
        w,
        h: win_h,
        band_x: 0,
        band_y,
        band_w: w,
        band_h,
        band_dock: band_dock.to_string(),
        edge: edge.to_string(),
        scale,
        monitor_x: mon.left,
        monitor_y: mon.top,
        monitor_w: mon.right - mon.left,
        monitor_h: mon.bottom - mon.top,
    })
}
