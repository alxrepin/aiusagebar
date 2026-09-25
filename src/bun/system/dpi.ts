import { dlopen, FFIType } from "bun:ffi";

/**
 * Windows: opt the process into per-monitor DPI awareness (v2). Without it
 * Windows renders the popover at 96 DPI and stretches the bitmap, so text is
 * blurry on scaled displays (e.g. 2560×1440 at 125–150%). Must run before
 * any window is created, so it's the first import in index.ts.
 */
function enableDpiAwareness(): void {
	if (process.platform !== "win32") return;
	try {
		const user32 = dlopen("user32.dll", {
			SetProcessDpiAwarenessContext: { args: [FFIType.i64], returns: FFIType.i32 },
		});
		const PER_MONITOR_AWARE_V2 = -4;
		if (user32.symbols.SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)) return;
	} catch {
		// Windows < 10 1703: fall through
	}
	try {
		dlopen("user32.dll", { SetProcessDPIAware: { args: [], returns: FFIType.i32 } }).symbols.SetProcessDPIAware();
	} catch {
		// keep the default
	}
}

enableDpiAwareness();
