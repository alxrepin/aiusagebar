import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Registers the app to start when the user logs in, using each OS's own
 * per-user mechanism (no admin rights needed):
 *   macOS   → ~/Library/LaunchAgents/<id>.plist that runs `open -g <App.app>`
 *   Windows → HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 *   Linux   → ~/.config/autostart/<id>.desktop
 */

export const LOGIN_ITEM_ID = "dev.aiusagebar.app";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "AIUsageBar";

export interface LoginItemEnv {
	platform: NodeJS.Platform;
	homeDir: string;
	/** macOS: the .app bundle; Windows/Linux: the launcher executable. */
	target: string;
	/** Runs a command; injectable for tests. */
	exec?: (cmd: string[]) => Promise<{ code: number; stdout: string }>;
}

const defaultExec = async (cmd: string[]) => {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
	const stdout = await new Response(proc.stdout).text();
	return { code: await proc.exited, stdout };
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function macLaunchAgentPlist(appPath: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LOGIN_ITEM_ID}</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/open</string>
		<string>-g</string>
		<string>${xml(appPath)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
`;
}

export function linuxDesktopEntry(exec: string): string {
	return `[Desktop Entry]
Type=Application
Name=AIUsageBar
Comment=ChatGPT & Claude usage limits in the tray
Exec="${exec.replace(/"/g, '\\"')}"
X-GNOME-Autostart-enabled=true
Terminal=false
`;
}

const macPlistPath = (home: string) => join(home, "Library", "LaunchAgents", `${LOGIN_ITEM_ID}.plist`);
const linuxDesktopPath = (home: string) => join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "autostart", `${LOGIN_ITEM_ID}.desktop`);

export async function setLaunchAtLogin(enabled: boolean, env: LoginItemEnv): Promise<void> {
	const exec = env.exec ?? defaultExec;
	switch (env.platform) {
		case "darwin": {
			const path = macPlistPath(env.homeDir);
			if (enabled) {
				await mkdir(dirname(path), { recursive: true });
				await Bun.write(path, macLaunchAgentPlist(env.target));
			} else {
				await rm(path, { force: true });
			}
			return;
		}
		case "win32": {
			const r = enabled
				? await exec(["reg", "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `"${env.target}"`, "/f"])
				: await exec(["reg", "delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
			// Deleting a value that isn't there is fine.
			if (enabled && r.code !== 0) throw new Error("Could not update the Run registry key");
			return;
		}
		default: {
			const path = linuxDesktopPath(env.homeDir);
			if (enabled) {
				await mkdir(dirname(path), { recursive: true });
				await Bun.write(path, linuxDesktopEntry(env.target));
			} else {
				await rm(path, { force: true });
			}
		}
	}
}

export async function isLaunchAtLogin(env: LoginItemEnv): Promise<boolean> {
	const exec = env.exec ?? defaultExec;
	switch (env.platform) {
		case "darwin":
			return Bun.file(macPlistPath(env.homeDir)).exists();
		case "win32": {
			const r = await exec(["reg", "query", RUN_KEY, "/v", RUN_VALUE]);
			return r.code === 0;
		}
		default:
			return Bun.file(linuxDesktopPath(env.homeDir)).exists();
	}
}
