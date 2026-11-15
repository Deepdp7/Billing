//! Native start screen, shown the instant the app is opened (Windows only). Also used by the Admin app
//! (admin-tauri/src-tauri/src/lib.rs includes this file).
//!
//! A WebView window needs about a third of a second before it can draw anything, so the app's own window starts
//! hidden and this plain Win32 window shows the logo, the name and a moving bar meanwhile, at exactly the same place and
//! size, in the same colours as the start screen in ui/index.html. Once the app's first screen is drawn, the app's
//! window is shown under this one (it stays on top meanwhile), given a moment to paint, and then this one closes:
//! the hand-over cannot be seen. It runs on its own thread with its own message loop, so it keeps moving while the
//! app starts. The WebView must keep drawing while covered (CalculateNativeWinOcclusion off in the app's window).
//!
//! The bar moves in step with the display (one frame per refresh, timed by the compositor, like a browser animation),
//! at fractional positions with blended edge pixels, and only the bar is redrawn each frame: it glides, never steps.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    GetLastError, COLORREF, ERROR_ALREADY_EXISTS, FILETIME, HWND, LPARAM, LRESULT, RECT, WPARAM,
};
use windows_sys::Win32::Graphics::Dwm::{DwmFlush, DwmSetWindowAttribute};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush, DeleteDC, DeleteObject,
    DrawTextW, EndPaint, FillRect, GetDC, ReleaseDC, SelectObject, SetBkMode, SetTextColor, CLEARTYPE_QUALITY,
    CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DT_CENTER, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, FF_DONTCARE, HDC,
    OUT_DEFAULT_PRECIS, PAINTSTRUCT, SRCCOPY, TRANSPARENT,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{
    CreateMutexW, GetCurrentProcess, GetCurrentThread, GetProcessTimes, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL,
};
use windows_sys::Win32::UI::HiDpi::{
    GetDpiForSystem, GetSystemMetricsForDpi, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyIcon, DestroyWindow, DispatchMessageW, DrawIconEx, FindWindowW, GetClientRect,
    GetMessageW, GetWindowLongPtrW, KillTimer, LoadCursorW, LoadImageW, PeekMessageW, PostMessageW, PostQuitMessage,
    RegisterClassExW, SendMessageW, SetTimer, SetWindowLongPtrW, ShowWindow, SystemParametersInfoW, TranslateMessage,
    CS_HREDRAW, CS_VREDRAW, DI_NORMAL, GWLP_USERDATA, ICON_BIG, ICON_SMALL, IDC_ARROW, IMAGE_ICON, LR_DEFAULTCOLOR, MSG,
    PM_REMOVE, SM_CXICON, SM_CXSMICON, SPI_GETWORKAREA, SW_SHOW, WM_CLOSE, WM_DESTROY, WM_ERASEBKGND, WM_PAINT, WM_QUIT,
    WM_SETICON, WNDCLASSEXW, WS_EX_APPWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

/// Colours as 0xRRGGBB, and the text shown under the logo
pub struct Style {
    pub title: &'static str,
    pub background: u32,
    pub text: u32,
    pub track: u32,
    pub accent: u32,
    /// Window size in logical pixels (the app's window gets the same)
    pub size: (f64, f64),
}

/// The open start screen. Its window lives on its own thread; this only holds what is needed to close it.
pub struct Splash {
    hwnd: usize,
    /// Where the window is, in logical pixels: x, y, width, height (the app's window is put exactly there)
    pub logical: (f64, f64, f64, f64),
}

const ICON_ID: usize = 32512; // the app icon tauri-build puts in the .exe

/// Everything drawn once (background, logo, name, empty track) is kept in `still`; a frame copies the track's part of
/// it into `bar` and draws the moving piece there.
struct State {
    still: HDC,
    still_bmp: isize,
    bar: HDC,
    bar_bmp: isize,
    track: RECT,
    track_color: u32,
    accent: u32,
    started: Instant,
}

fn rgb(c: u32) -> COLORREF {
    ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF)
}

fn mix(a: u32, b: u32, t: f64) -> u32 {
    let ch = |s: u32| -> f64 { ((a >> s) & 0xFF) as f64 * (1.0 - t) + ((b >> s) & 0xFF) as f64 * t };
    ((ch(16).round() as u32) << 16) | ((ch(8).round() as u32) << 8) | ch(0).round() as u32
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn fill(dc: HDC, r: RECT, c: u32) {
    let brush = CreateSolidBrush(rgb(c));
    FillRect(dc, &r, brush);
    DeleteObject(brush);
}

/// The still picture, laid out like ui/index.html: logo 88, gap 14, name (22px bold), gap 14, track 140 x 3, centred
unsafe fn draw_still(window_dc: HDC, w: i32, h: i32, scale: f64, style: &Style, icon: isize) -> State {
    let still = CreateCompatibleDC(window_dc);
    let still_bmp = CreateCompatibleBitmap(window_dc, w, h);
    SelectObject(still, still_bmp);
    fill(still, RECT { left: 0, top: 0, right: w, bottom: h }, style.background);

    let px = |v: f64| (v * scale).round() as i32;
    let (logo, gap, line, bar_w, bar_h) = (px(88.0), px(14.0), px(30.0), px(140.0), px(3.0).max(2));
    let top = (h - (logo + gap + line + gap + bar_h)) / 2;
    if icon != 0 {
        DrawIconEx(still, (w - logo) / 2, top, icon as _, logo, logo, 0, std::ptr::null_mut(), DI_NORMAL);
    }
    let font = CreateFontW(
        -px(22.0), 0, 0, 0, 700, 0, 0, 0, DEFAULT_CHARSET as u32, OUT_DEFAULT_PRECIS as u32, CLIP_DEFAULT_PRECIS as u32,
        CLEARTYPE_QUALITY as u32, FF_DONTCARE as u32, wide("Segoe UI").as_ptr(),
    );
    let old_font = SelectObject(still, font);
    SetBkMode(still, TRANSPARENT as _);
    SetTextColor(still, rgb(style.text));
    let title = wide(style.title);
    let mut text_rect = RECT { left: 0, top: top + logo + gap, right: w, bottom: top + logo + gap + line };
    DrawTextW(still, title.as_ptr(), -1, &mut text_rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    SelectObject(still, old_font);
    DeleteObject(font);

    let bar_top = top + logo + gap + line + gap;
    let track = RECT { left: (w - bar_w) / 2, top: bar_top, right: (w - bar_w) / 2 + bar_w, bottom: bar_top + bar_h };
    fill(still, track, style.track);

    let bar = CreateCompatibleDC(window_dc);
    let bar_bmp = CreateCompatibleBitmap(window_dc, bar_w, bar_h);
    SelectObject(bar, bar_bmp);
    State {
        still,
        still_bmp: still_bmp as isize,
        bar,
        bar_bmp: bar_bmp as isize,
        track,
        track_color: style.track,
        accent: style.accent,
        started: Instant::now(),
    }
}

/// One frame of the bar: a piece 40% as wide as the track slides across it once a second, easing in and out (CSS
/// ease-in-out), at a fractional position whose edge pixels are blended, so it glides instead of stepping
unsafe fn draw_bar(dc: HDC, st: &State) {
    let (tw, th) = (st.track.right - st.track.left, st.track.bottom - st.track.top);
    BitBlt(st.bar, 0, 0, tw, th, st.still, st.track.left, st.track.top, SRCCOPY);
    let t = st.started.elapsed().as_secs_f64() % 1.0;
    let e = if t < 0.5 { 4.0 * t * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(3) / 2.0 };
    let piece = tw as f64 * 0.4;
    let a = (piece * (-1.0 + 3.5 * e)).max(0.0);
    let b = (piece * (-1.0 + 3.5 * e) + piece).min(tw as f64);
    if b > a {
        let (first, last) = (a.floor() as i32, b.ceil() as i32 - 1);
        let column = |x: i32, cover: f64| fill(st.bar, RECT { left: x, top: 0, right: x + 1, bottom: th }, mix(st.track_color, st.accent, cover.clamp(0.0, 1.0)));
        if first == last {
            column(first, b - a);
        } else {
            column(first, (first + 1) as f64 - a);
            column(last, b - last as f64);
            if last - first > 1 {
                fill(st.bar, RECT { left: first + 1, top: 0, right: last, bottom: th }, st.accent);
            }
        }
    }
    BitBlt(dc, st.track.left, st.track.top, tw, th, st.bar, 0, 0, SRCCOPY);
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let st = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const State;
    match msg {
        WM_ERASEBKGND => 1,
        WM_PAINT if !st.is_null() => {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut ps);
            let mut client: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut client);
            BitBlt(dc, 0, 0, client.right, client.bottom, (*st).still, 0, 0, SRCCOPY);
            draw_bar(dc, &*st);
            EndPaint(hwnd, &ps);
            0
        }
        WM_CLOSE => {
            DestroyWindow(hwnd);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// The app is open already (the single-instance plugin's hidden window "<identifier>-siw" exists): opening it again
/// only brings that window forward, so no start screen
pub fn already_running(identifier: &str) -> bool {
    unsafe { !FindWindowW(std::ptr::null(), wide(&format!("{identifier}-siw")).as_ptr()).is_null() }
}

/// True for the first copy of the app only. A named mutex made at the very start of the process: unlike the other
/// copy's window (which exists only after its framework has started), it is there from the first millisecond, so two
/// quick double-clicks cannot both start an engine. The handle stays open for as long as the process lives.
pub fn first_instance(identifier: &str) -> bool {
    unsafe {
        let mutex = CreateMutexW(std::ptr::null(), 0, wide(&format!("Local\\{identifier}-first-start")).as_ptr());
        mutex.is_null() || GetLastError() != ERROR_ALREADY_EXISTS
    }
}

/// This start's timing marks, kept for save_trace
static MARKS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Startup timing marks: how many milliseconds have passed since Windows created the process (so it includes loading
/// the program itself). Kept for save_trace; with the environment variable APNA_TRACE set, also printed.
pub fn trace(label: &str) {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let line = format!("{:>6} ms  {label}", since_start_ms());
    if *ON.get_or_init(|| std::env::var_os("APNA_TRACE").is_some()) {
        println!("[trace] {line}");
    }
    if let Ok(mut marks) = MARKS.lock() {
        marks.push(line);
    }
}

/// Adds this start's marks to a small log (the last starts only), so a slow start on someone's computer can be looked
/// at afterwards
#[allow(dead_code)] // the admin app (which shares this file) does not keep one
pub fn save_trace(file: std::path::PathBuf) {
    let marks = MARKS.lock().map(|m| m.join("
")).unwrap_or_default();
    std::thread::spawn(move || {
        let when = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let old = std::fs::read_to_string(&file).unwrap_or_default();
        let mut from = old.len().saturating_sub(16_000);
        while !old.is_char_boundary(from) {
            from += 1;
        }
        let keep = if old.len() > 24_000 { &old[from..] } else { &old[..] };
        let keep = keep.find("== start").map(|i| &keep[i..]).unwrap_or("");
        let _ = std::fs::write(&file, format!("{keep}== start at {when} (Unix time), version {}
{marks}
", env!("CARGO_PKG_VERSION")));
    });
}

fn since_start_ms() -> u64 {
    unsafe {
        let mut created: FILETIME = std::mem::zeroed();
        let (mut exited, mut kernel, mut user): (FILETIME, FILETIME, FILETIME) = (created, created, created);
        GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user);
        let created = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64; // 100 ns since 1601
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64 / 100).unwrap_or(0)
            + 116_444_736_000_000_000;
        now.saturating_sub(created) / 10_000
    }
}

/// Opens the start screen and returns once it is on screen
pub fn show(style: Style) -> Option<Splash> {
    let (tx, rx) = mpsc::channel::<Option<Splash>>();
    std::thread::spawn(move || unsafe {
        // In real pixels from the start, as the app's window will be (tao switches the process to this a moment
        // later; a window made before that would suddenly shrink on a 125% / 150% display)
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        // The app starting up behind it must not make the bar stutter
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
        let instance = GetModuleHandleW(std::ptr::null());
        let class = wide("ApnaStartScreen");
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: instance,
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW), // the normal pointer over the start screen
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassExW(&wc);

        // Same rule as the app's window: centred in the work area, never larger than it
        let scale = GetDpiForSystem() as f64 / 96.0;
        let mut area: RECT = std::mem::zeroed();
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut area as *mut RECT as *mut _, 0);
        let (aw, ah) = (area.right - area.left, area.bottom - area.top);
        let w = ((style.size.0 * scale).round() as i32).min(aw);
        let h = ((style.size.1 * scale).round() as i32).min(ah);
        let (x, y) = (area.left + (aw - w) / 2, area.top + (ah - h) / 2);

        let hwnd = CreateWindowExW(
            // WS_EX_APPWINDOW: a taskbar button from the first moment, so the app is seen to be opening
            WS_EX_APPWINDOW | WS_EX_TOPMOST, class.as_ptr(), wide(style.title).as_ptr(), WS_POPUP, x, y, w, h,
            std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null(),
        );
        if hwnd.is_null() {
            let _ = tx.send(None);
            return;
        }
        // The taskbar and Alt+Tab show this window's own icons, at the sizes Windows asks for on this display
        let dpi = GetDpiForSystem();
        let load = |size: i32| LoadImageW(instance, ICON_ID as *const u16, IMAGE_ICON, size, size, LR_DEFAULTCOLOR) as isize;
        let taskbar_big = load(GetSystemMetricsForDpi(SM_CXICON, dpi));
        let taskbar_small = load(GetSystemMetricsForDpi(SM_CXSMICON, dpi));
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as WPARAM, taskbar_big);
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL as WPARAM, taskbar_small);
        let logo = (88.0 * scale).round() as i32;
        let icon = LoadImageW(instance, ICON_ID as *const u16, IMAGE_ICON, logo, logo, LR_DEFAULTCOLOR) as isize;
        let window_dc = GetDC(hwnd);
        let state = Box::into_raw(Box::new(draw_still(window_dc, w, h, scale, &style, icon)));
        ReleaseDC(hwnd, window_dc);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);
        // Rounded corners like the app's window on Windows 11 (ignored on Windows 10)
        let round: u32 = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(hwnd, 33, &round as *const u32 as *const _, 4); // DWMWA_WINDOW_CORNER_PREFERENCE
        ShowWindow(hwnd, SW_SHOW);
        trace("start screen on screen");
        let _ = tx.send(Some(Splash {
            hwnd: hwnd as usize,
            logical: (x as f64 / scale, y as f64 / scale, w as f64 / scale, h as f64 / scale),
        }));

        // Windows shows the busy "app starting" pointer after a launch until the app first waits for a message
        // (GetMessage). The frame loop below never waits (PeekMessage), so wait once here: a 1 ms timer makes sure a
        // message comes at once. The pointer is normal from now on.
        let mut msg: MSG = std::mem::zeroed();
        SetTimer(hwnd, 1, 1, None);
        if GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        KillTimer(hwnd, 1);

        // One frame per display refresh: handle what came in, draw the bar, wait for the compositor's next frame
        'frames: loop {
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    break 'frames;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let dc = GetDC(hwnd);
            if !dc.is_null() {
                draw_bar(dc, &*state);
                ReleaseDC(hwnd, dc);
            }
            if DwmFlush() != 0 {
                std::thread::sleep(Duration::from_millis(8)); // no compositor: about 120 frames a second
            }
        }

        let st = Box::from_raw(state);
        DeleteDC(st.bar);
        DeleteObject(st.bar_bmp as _);
        DeleteDC(st.still);
        DeleteObject(st.still_bmp as _);
        for handle in [icon, taskbar_big, taskbar_small] {
            if handle != 0 {
                DestroyIcon(handle as _);
            }
        }
    });
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

impl Splash {
    /// Closes the start screen at once (e.g. before an error message)
    pub fn close(&self) {
        unsafe { PostMessageW(self.hwnd as HWND, WM_CLOSE, 0, 0) };
    }

    /// `show_app` shows the app's window (under the start screen, which stays on top); once it has had a moment to
    /// paint, the start screen closes. Runs on its own thread.
    pub fn hand_over(self, show_app: impl FnOnce() + Send + 'static) {
        std::thread::spawn(move || {
            show_app();
            std::thread::sleep(Duration::from_millis(150));
            self.close();
        });
    }
}
