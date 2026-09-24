import { dlopen, FFIType, ptr, read, type Pointer } from "bun:ffi";

/**
 * Sets the Windows tray icon tooltip (Unicode). Electrobun's own setTitle()
 * uses the ANSI NOTIFYICONDATA, which garbles non-Latin text, so we send
 * NIM_MODIFY/NIF_TIP ourselves with the icon's hWnd and uID.
 *
 * `trayPtr` is Electrobun's native NSStatusItem, which starts with its
 * NOTIFYICONDATAA: hWnd at offset 8, uID at offset 16 (x64).
 */

const NIM_MODIFY = 1;
const NIF_TIP = 0x4;
const NID_W_SIZE = 976; // sizeof(NOTIFYICONDATAW) on x64
const TIP_OFFSET = 40;
const TIP_CHARS = 128;

let shell: { Shell_NotifyIconW: (msg: number, data: Pointer) => number } | null | undefined;

function load() {
	if (shell !== undefined) return shell;
	if (process.platform !== "win32") return (shell = null);
	try {
		shell = dlopen("shell32.dll", {
			Shell_NotifyIconW: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
		}).symbols as unknown as typeof shell;
	} catch (err) {
		console.warn("[tray] shell32.dll unavailable:", err);
		shell = null;
	}
	return shell;
}

export function setTrayTooltip(trayPtr: Pointer | null | undefined, text: string): boolean {
	const s = load();
	if (!s || !trayPtr) return false;
	try {
		const hwnd = read.ptr(trayPtr, 8);
		const uid = read.u32(trayPtr, 16);
		if (!hwnd) return false;
		const buf = new ArrayBuffer(NID_W_SIZE);
		const view = new DataView(buf);
		view.setUint32(0, NID_W_SIZE, true);
		view.setBigUint64(8, BigInt(hwnd), true);
		view.setUint32(16, uid, true);
		view.setUint32(20, NIF_TIP, true);
		const tip = text.slice(0, TIP_CHARS - 1);
		for (let i = 0; i < tip.length; i++) view.setUint16(TIP_OFFSET + i * 2, tip.charCodeAt(i), true);
		return s.Shell_NotifyIconW(NIM_MODIFY, ptr(new Uint8Array(buf))) !== 0;
	} catch (err) {
		console.warn("[tray] could not set tooltip:", err);
		return false;
	}
}
