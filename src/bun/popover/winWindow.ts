import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

/**
 * Windows-only helpers for the popover window (user32.dll via bun:ffi).
 *
 * - Electrobun creates windows with WS_EX_APPWINDOW, which adds a taskbar
 *   button; a tray popover should be a tool window instead.
 * - Focus/foreground based dismissal is unreliable here: the tray click hands
 *   the foreground back to Explorer right after we show the window, and
 *   WebView2 shuffles focus between its own windows. So, like a flyout, the
 *   popover closes when a mouse button goes down outside of it.
 */

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const MOUSE_BUTTONS = [0x01, 0x02, 0x04]; // VK_LBUTTON, VK_RBUTTON, VK_MBUTTON

type User32 = {
	GetWindowLongPtrW: (hwnd: Pointer, index: number) => number | bigint;
	SetWindowLongPtrW: (hwnd: Pointer, index: number, value: number) => number | bigint;
	GetAsyncKeyState: (vk: number) => number;
	GetCursorPos: (point: Int32Array) => number;
	GetWindowRect: (hwnd: Pointer, rect: Int32Array) => number;
};

let user32: User32 | null | undefined;

function load(): User32 | null {
	if (user32 !== undefined) return user32;
	if (process.platform !== "win32") return (user32 = null);
	try {
		const lib = dlopen("user32.dll", {
			GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
			SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
			GetAsyncKeyState: { args: [FFIType.i32], returns: FFIType.i16 },
			GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
			GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
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

/** Windows 11: ask DWM for native rounded corners (no-op on Windows 10). */
export function roundCorners(hwnd: Pointer | null | undefined): boolean {
	if (process.platform !== "win32" || !hwnd) return false;
	try {
		const dwm = dlopen("dwmapi.dll", {
			DwmSetWindowAttribute: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		});
		const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
		const DWMWCP_ROUND = 2;
		const value = new Int32Array([DWMWCP_ROUND]);
		return dwm.symbols.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ptr(value), 4) === 0;
	} catch {
		return false;
	}
}

export type MouseSample = {
	/** A mouse button is held right now. */
	down: boolean;
	/** A button was pressed since the previous sample (catches short clicks). */
	pressedSinceLast: boolean;
	/** The cursor is over the popover window. */
	inside: boolean;
};

/**
 * Decides, sample by sample, whether a click happened outside the popover.
 * The first sample only records state: the click that opened the popover
 * (on the tray icon) must not close it again.
 */
export function outsideClickDetector(): (s: MouseSample) => boolean {
	let first = true;
	let wasDown = false;
	return (s) => {
		const pressed = (s.down && !wasDown) || (!first && s.pressedSinceLast);
		wasDown = s.down;
		if (first) {
			first = false;
			return false;
		}
		return pressed && !s.inside;
	};
}

function sampleMouse(u: User32, hwnd: Pointer): MouseSample | null {
	const pt = new Int32Array(2);
	const rect = new Int32Array(4);
	if (!u.GetCursorPos(pt) || !u.GetWindowRect(hwnd, rect)) return null;
	let down = false;
	let pressedSinceLast = false;
	for (const vk of MOUSE_BUTTONS) {
		const state = u.GetAsyncKeyState(vk);
		if (state & 0x8000) down = true;
		if (state & 0x0001) pressedSinceLast = true;
	}
	const x = pt[0]!;
	const y = pt[1]!;
	const [left, top, right, bottom] = [rect[0]!, rect[1]!, rect[2]!, rect[3]!];
	return { down, pressedSinceLast, inside: x >= left && x < right && y >= top && y < bottom };
}

/** Calls `onOutside` when the user clicks anywhere outside the window. */
export function watchOutsideClicks(hwnd: Pointer | null | undefined, onOutside: () => void, intervalMs = 40): () => void {
	const u = load();
	if (!u || !hwnd) return () => {};
	const detect = outsideClickDetector();
	const timer = setInterval(() => {
		try {
			const sample = sampleMouse(u, hwnd);
			if (sample && detect(sample)) onOutside();
		} catch {
			// ignore: try again on the next tick
		}
	}, intervalMs);
	return () => clearInterval(timer);
}

/**
 * Ends the process right away. Electrobun's graceful quit hangs on Windows
 * (the app stayed in the tray), so after our own cleanup we terminate.
 */
export function terminateProcess(code = 0): void {
	try {
		const k = dlopen("kernel32.dll", {
			// Pseudo-handle (-1): keep it as an integer, not a pointer.
			GetCurrentProcess: { args: [], returns: FFIType.i64 },
			TerminateProcess: { args: [FFIType.i64, FFIType.u32], returns: FFIType.i32 },
		});
		k.symbols.TerminateProcess(k.symbols.GetCurrentProcess(), code);
	} catch {
		// fall through
	}
	process.kill(process.pid, "SIGKILL");
}
