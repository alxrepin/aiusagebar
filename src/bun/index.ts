import { homedir } from "node:os";
import { join } from "node:path";
import { Utils } from "electrobun/bun";
import type { AppState } from "../shared/types";
import { Popover } from "./popover/popover";
import { ConfigStore } from "./store/config";
import { createSecretStore } from "./store/secrets";
import { TrayController } from "./tray/trayController";
import { UsageService } from "./usage/service";

const platform: AppState["platform"] =
	process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";

const dataDir = join(Utils.paths.appData, "AIUsageBar");
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
		openUrl: (url) => Utils.openExternal(url),
		fetch,
		homeDir: homedir(),
		platform: process.platform,
	},
});

const tray = new TrayController(platform, cacheDir);
const popover = new Popover(platform, service, () => tray.tray.getBounds());

tray.tray.on("tray-clicked", (event) => {
	const action = (event as { data?: { action?: string } }).data?.action ?? "";
	switch (action) {
		case "refresh":
			void service.refreshAll({ force: true });
			break;
		case "quit":
			service.stop();
			Utils.quit();
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

service.onChange((state) => void tray.update(state));
await tray.update(service.getState());
service.start();
