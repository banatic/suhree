//! Thin, stable wrappers over Win32 (windows-sys) for the things the overlay needs:
//! cursor position, monitor enumeration (rect/work-area/DPI), taskbar position, and
//! fullscreen-app detection.

use std::mem::{size_of, zeroed};

use windows_sys::Win32::Foundation::{BOOL, LPARAM, POINT, RECT, TRUE};
use windows_sys::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};

/// `MONITORINFOF_PRIMARY` (not re-exported by windows-sys 0.59 here; value is 1).
const MONITORINFOF_PRIMARY: u32 = 0x0000_0001;
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::Shell::{
    SHAppBarMessage, SHQueryUserNotificationState, APPBARDATA, QUNS_BUSY,
    QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect,
};

/// `ABM_GETTASKBARPOS` — defined locally to avoid depending on its export location.
const ABM_GETTASKBARPOS: u32 = 0x0000_0005;

#[derive(Clone, Copy)]
pub struct MonitorData {
    pub rc_monitor: RECT,
    pub rc_work: RECT,
    pub dpi: u32,
    pub primary: bool,
}

pub struct Taskbar {
    /// Taskbar rectangle (screen px). Kept for completeness / future use.
    #[allow(dead_code)]
    pub rc: RECT,
    /// 0=left 1=top 2=right 3=bottom (ABE_*).
    pub edge: u32,
}

/// Current global cursor position in physical screen pixels.
pub fn cursor_pos() -> Option<(i32, i32)> {
    unsafe {
        let mut p: POINT = zeroed();
        if GetCursorPos(&mut p) != 0 {
            Some((p.x, p.y))
        } else {
            None
        }
    }
}

unsafe extern "system" fn enum_proc(
    hmon: HMONITOR,
    _hdc: HDC,
    _rc: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let monitors = &mut *(data as *mut Vec<MonitorData>);
    let mut mi: MONITORINFO = zeroed();
    mi.cbSize = size_of::<MONITORINFO>() as u32;
    if GetMonitorInfoW(hmon, &mut mi) != 0 {
        let mut dx: u32 = 96;
        let mut dy: u32 = 96;
        // GetDpiForMonitor returns S_OK(0) on success; ignore failure and keep 96.
        let _ = GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        monitors.push(MonitorData {
            rc_monitor: mi.rcMonitor,
            rc_work: mi.rcWork,
            dpi: dx,
            primary: (mi.dwFlags & MONITORINFOF_PRIMARY) != 0,
        });
    }
    TRUE
}

/// Enumerate all monitors with their full rect, work area (excludes taskbar/appbars) and DPI.
pub fn enum_monitors() -> Vec<MonitorData> {
    let mut monitors: Vec<MonitorData> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            core::ptr::null_mut(),
            core::ptr::null(),
            Some(enum_proc),
            &mut monitors as *mut _ as LPARAM,
        );
    }
    monitors
}

/// Primary-monitor taskbar rectangle + edge.
pub fn taskbar() -> Option<Taskbar> {
    unsafe {
        let mut abd: APPBARDATA = zeroed();
        abd.cbSize = size_of::<APPBARDATA>() as u32;
        let r = SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd);
        if r != 0 {
            Some(Taskbar {
                rc: abd.rc,
                edge: abd.uEdge,
            })
        } else {
            None
        }
    }
}

/// True when a fullscreen app (game / video / presentation) owns the foreground.
///
/// Combines two signals because neither is reliable alone (modern games report
/// `QUNS_BUSY`, borderless windows report nothing): the shell notification state
/// OR a foreground window whose rect covers its entire monitor.
pub fn fullscreen_app_present() -> bool {
    unsafe {
        // (1) Shell notification state.
        let mut state: i32 = 0;
        if SHQueryUserNotificationState(&mut state) == 0
            && (state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE)
        {
            return true;
        }
        let busy = state == QUNS_BUSY;

        // (2) Foreground window rect vs its monitor rect.
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }

        // Ignore the desktop/shell windows.
        let mut cls = [0u16; 256];
        let n = GetClassNameW(hwnd, cls.as_mut_ptr(), cls.len() as i32);
        if n > 0 {
            let name = String::from_utf16_lossy(&cls[..n as usize]);
            if name == "Progman" || name == "WorkerW" || name == "Shell_TrayWnd" {
                return false;
            }
        }

        let mut wr: RECT = zeroed();
        if GetWindowRect(hwnd, &mut wr) == 0 {
            return false;
        }
        let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = zeroed();
        mi.cbSize = size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut mi) == 0 {
            return false;
        }
        let m = mi.rcMonitor;
        let covers = wr.left <= m.left && wr.top <= m.top && wr.right >= m.right && wr.bottom >= m.bottom;

        // Fullscreen if it visually covers the monitor, or shell says busy AND it's maximised-ish.
        covers || busy && covers
    }
}
