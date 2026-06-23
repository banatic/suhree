//! Coordinate helpers for the hit-test loop.

use crate::state::{NormRect, PhysRect};

/// Normalise an absolute physical cursor point into 0..1 window space.
/// Returns `None` if the cursor is outside the window rect.
pub fn normalize(rect: &PhysRect, cx: i32, cy: i32) -> Option<(f64, f64)> {
    if rect.w <= 0 || rect.h <= 0 || !rect.contains(cx, cy) {
        return None;
    }
    Some((
        (cx - rect.x) as f64 / rect.w as f64,
        (cy - rect.y) as f64 / rect.h as f64,
    ))
}

/// True if the normalised point lies in any interactive region.
pub fn point_over(regions: &[NormRect], nx: f64, ny: f64) -> bool {
    regions
        .iter()
        .any(|r| nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h)
}
