import { dlopen, FFIType, type Pointer } from "bun:ffi";

/**
 * Windows-only helpers for the popover window (user32.dll via bun:ffi).
 *
 * - Electrobun creates windows with WS_EX_APPWINDOW, which adds a taskbar
 *   button; a tray popover should be a tool window instead.
 * - The "blur" event isn't reliable for a WebView2 window (focus moves into
 *   the web content's child window, and the tray click itself shuffles
 *   activation), so dismissal is based on which process owns the foreground
 *   window instead.
 */

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;

type User32 = {
	GetForegroundWindow: () => Pointer | null;
	GetWindowThreadProcessId: (hwnd: Pointer, pid: Uint32Array) => number;
	GetWindowLongPtrW: (hwnd: Pointer, index: number) => number | bigint;
	SetWindowLongPtrW: (hwnd: Pointer, index: number, value: number) => number | bigint;
};

let user32: User32 | null | undefined;

function load(): User32 | null {
	if (user32 !== undefined) return user32;
	if (process.platform !== "win32") return (user32 = null);
	try {
		const lib = dlopen("user32.dll", {
			GetForegroundWindow: { args: [], returns: FFIType.ptr },
			GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
			GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
			SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
		});
		user32 = lib.symbols as unknown as User32;
	} catch (err) {
		console.warn("[popover] user32.dll unavailable:", err);
		user32 = null;
	}
	return user32;
}

/** Turn the window into a tool window: no taskbar button, no Alt+Tab entry. */
export function makeToolWindow(hwnd: Pointer | null | undefined): boolean {
	const u = load();
	if (!u || !hwnd) return false;
	try {
		const style = Number(u.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
		u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (style & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW);
		return true;
	} catch (err) {
		console.warn("[popover] could not set tool window style:", err);
		return false;
	}
}

/** Process id that owns the foreground window, or null if unknown. */
export function foregroundProcessId(): number | null {
	const u = load();
	if (!u) return null;
	try {
		const hwnd = u.GetForegroundWindow();
		if (!hwnd) return null;
		const pid = new Uint32Array(1);
		u.GetWindowThreadProcessId(hwnd, pid);
		return pid[0] || null;
	} catch {
		return null;
	}
}

/**
 * Calls `onLeave` once the user moves to another app. Armed only after our
 * process has been in the foreground, so a slow activation right after the
 * tray click doesn't close the popover immediately.
 */
export function watchForeground(onLeave: () => void, intervalMs = 200): () => void {
	let armed = false;
	const timer = setInterval(() => {
		const pid = foregroundProcessId();
		if (pid === null) return;
		if (pid === process.pid) {
			armed = true;
			return;
		}
		if (armed) onLeave();
	}, intervalMs);
	return () => clearInterval(timer);
}
