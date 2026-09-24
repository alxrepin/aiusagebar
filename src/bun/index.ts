import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Updater, Utils } from "electrobun/bun";
import type { AppState } from "../shared/types";
import { Popover } from "./popover/popover";
import { ConfigStore } from "./store/config";
import { createSecretStore } from "./store/secrets";
import { setLaunchAtLogin } from "./system/launchAtLogin";
import { installFileLog } from "./system/log";
import { openUrl } from "./system/openUrl";
import { quitApp } from "./system/quit";
import { TrayController } from "./tray/trayController";
import { UpdateController } from "./update/updateController";
import { UsageService } from "./usage/service";

const platform: AppState["platform"] =
	process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";

const dataDir = join(Utils.paths.appData, "AIUsageBar");
installFileLog(join(dataDir, "aiusagebar.log"));

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
	return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}
const cacheDir = join(Utils.paths.cache, "AIUsageBar");

// Menu-bar-only app: no Dock icon on macOS.
if (platform === "mac") Utils.setDockIconVisible(false);

const config = new ConfigStore(join(dataDir, "config.json"));
await config.load();

const service = new UsageService({
	config,
	secrets: createSecretStore(dataDir),
	platform,
	notify: (title, body) => Utils.showNotification({ title, body }),
	baseContext: {
		openUrl,
		fetch,
		homeDir: homedir(),
		platform: process.platform,
	},
});

// Updates come from GitHub Releases (release.baseUrl in electrobun.config.ts).
const updates = new UpdateController({
	feed: {
		currentVersion: () => Updater.localInfo.version(),
		check: async () => {
			// Electrobun's fetch has no timeout; don't leave the spinner running forever.
			const r = await withTimeout(Updater.checkForUpdate(), 30_000, "Update check timed out");
			return { updateAvailable: r.updateAvailable, version: r.version, error: r.error || undefined };
		},
		download: async () => {
			await Updater.downloadUpdate();
			if (!Updater.updateInfo()?.updateReady) throw new Error("Update download failed");
		},
		apply: () => Updater.applyUpdate(),
	},
	onChange: (u) => service.setUpdateState(u),
	notify: (title, body) => Utils.showNotification({ title, body }),
});

Updater.onStatusChange((entry) => {
	const progress = (entry.details as { progress?: number } | undefined)?.progress;
	if (entry.status === "download-progress" && typeof progress === "number") updates.setProgress(progress);
});

const tray = new TrayController(platform, cacheDir);
const quit = () =>
	quitApp(() => {
		service.stop();
		updates.stop();
		tray.tray.remove();
	});
const popover = new Popover(platform, service, updates, () => tray.tray.getBounds(), quit);

tray.tray.on("tray-clicked", (event) => {
	const action = (event as { data?: { action?: string } }).data?.action ?? "";
	switch (action) {
		case "refresh":
			void service.refreshAll({ force: true });
			break;
		case "quit":
			quit();
			break;
		default:
			popover.toggle();
	}
});

// Linux (AppIndicator) often doesn't deliver plain clicks, so give it a menu.
// On macOS/Windows a menu would replace the click → popover behaviour.
if (platform === "linux") {
	tray.tray.setMenu([
		{ type: "normal", label: "Show usage", action: "open" },
		{ type: "normal", label: "Refresh now", action: "refresh" },
		{ type: "divider" },
		{ type: "normal", label: "Quit AIUsageBar", action: "quit" },
	]);
}

// Launch at login (on by default, toggled in Settings). Re-applied on every
// start so the registered path stays correct if the app was moved.
async function loginItemTarget(): Promise<string | null> {
	if ((await Updater.localInfo.channel().catch(() => "dev")) === "dev") return null; // `bun run dev` build
	if (platform === "mac") return resolve(dirname(process.execPath), "..", ".."); // …/AIUsageBar.app
	const exe = platform === "win" ? "launcher.exe" : "launcher";
	return join(await Updater.appDataFolder(), "app", "bin", exe);
}
let appliedLaunchAtLogin: boolean | undefined;
async function syncLaunchAtLogin(enabled: boolean) {
	if (enabled === appliedLaunchAtLogin) return;
	appliedLaunchAtLogin = enabled;
	const target = await loginItemTarget();
	if (!target) return;
	await setLaunchAtLogin(enabled, { platform: process.platform, homeDir: homedir(), target }).catch((err) =>
		console.warn("[login item]", err),
	);
}
void syncLaunchAtLogin(config.data.settings.launchAtLogin);

service.onChange((state) => void syncLaunchAtLogin(state.settings.launchAtLogin));
service.onChange((state) => void tray.update(state));
await tray.update(service.getState());
service.start();
void updates.start();
