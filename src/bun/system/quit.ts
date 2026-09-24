import { Utils } from "electrobun/bun";
import { terminateProcess } from "../popover/winWindow";

/**
 * Quit the app. `cleanup` stops timers and removes the tray icon. Runs on the
 * next tick so an RPC reply / tray click handler can return first; on Windows
 * Electrobun's graceful shutdown doesn't finish, so the process terminates.
 */
export function quitApp(cleanup: () => void): void {
	setTimeout(() => {
		try {
			cleanup();
		} catch (err) {
			console.warn("[quit] cleanup failed:", err);
		}
		if (process.platform === "win32") return terminateProcess(0);
		// Safety net in case the native shutdown stalls.
		setTimeout(() => terminateProcess(0), 3000).unref?.();
		Utils.quit();
	}, 50);
}
