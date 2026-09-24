import { Utils } from "electrobun/bun";

/**
 * Opens a URL in the default browser.
 *
 * Windows: Electrobun's openExternal calls ShellExecuteW from the Bun thread,
 * which isn't COM-initialised, so it silently failed at times (e.g. sign-in
 * from the first-run screen). A separate rundll32 process is reliable and
 * passes the URL as a plain argument (no shell, so "&" in OAuth URLs is safe).
 */
export function openUrl(url: string): void {
	if (process.platform === "win32") {
		try {
			Bun.spawn(["rundll32.exe", "url.dll,FileProtocolHandler", url], { stdio: ["ignore", "ignore", "ignore"] });
			return;
		} catch (err) {
			console.warn("[openUrl] rundll32 failed, falling back:", err);
		}
	}
	Utils.openExternal(url);
}
