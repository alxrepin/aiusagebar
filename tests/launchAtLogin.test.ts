import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLaunchAtLogin, LOGIN_ITEM_ID, setLaunchAtLogin } from "../src/bun/system/launchAtLogin";
import { normalizeSettings } from "../src/bun/store/config";

const home = () => mkdtempSync(join(tmpdir(), "aiub-login-"));

test("enabled by default", () => {
	expect(normalizeSettings(undefined).launchAtLogin).toBe(true);
	expect(normalizeSettings({ launchAtLogin: false }).launchAtLogin).toBe(false);
});

test("macOS: writes and removes a LaunchAgent that opens the app bundle", async () => {
	const h = home();
	const env = { platform: "darwin" as const, homeDir: h, target: "/Applications/AIUsageBar & Co.app" };
	await setLaunchAtLogin(true, env);
	const plist = await Bun.file(join(h, "Library/LaunchAgents", `${LOGIN_ITEM_ID}.plist`)).text();
	expect(plist).toContain("<string>/usr/bin/open</string>");
	expect(plist).toContain("<string>/Applications/AIUsageBar &amp; Co.app</string>");
	expect(plist).toContain("<key>RunAtLoad</key>");
	expect(await isLaunchAtLogin(env)).toBe(true);

	await setLaunchAtLogin(false, env);
	expect(await isLaunchAtLogin(env)).toBe(false);
});

test("Windows: uses the per-user Run registry key", async () => {
	const calls: string[][] = [];
	const exec = async (cmd: string[]) => (calls.push(cmd), { code: 0, stdout: "" });
	const env = { platform: "win32" as const, homeDir: "C:\\Users\\me", target: "C:\\Users\\me\\AppData\\Local\\app\\bin\\launcher.exe", exec };
	await setLaunchAtLogin(true, env);
	await setLaunchAtLogin(false, env);
	expect(calls[0]).toEqual([
		"reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "AIUsageBar", "/t", "REG_SZ",
		"/d", '"C:\\Users\\me\\AppData\\Local\\app\\bin\\launcher.exe"', "/f",
	]);
	expect(calls[1]?.slice(0, 2)).toEqual(["reg", "delete"]);
});

test("Linux: XDG autostart entry", async () => {
	const h = home();
	const prev = process.env.XDG_CONFIG_HOME;
	delete process.env.XDG_CONFIG_HOME;
	const env = { platform: "linux" as const, homeDir: h, target: "/home/me/.local/share/app/bin/launcher" };
	await setLaunchAtLogin(true, env);
	const entry = await Bun.file(join(h, ".config/autostart", `${LOGIN_ITEM_ID}.desktop`)).text();
	expect(entry).toContain('Exec="/home/me/.local/share/app/bin/launcher"');
	await setLaunchAtLogin(false, env);
	expect(await isLaunchAtLogin(env)).toBe(false);
	if (prev) process.env.XDG_CONFIG_HOME = prev;
});
