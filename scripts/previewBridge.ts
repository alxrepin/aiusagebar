// Mock host used by `bun run preview`: renders the popover in a normal browser
// with fake data so the UI can be designed without launching the tray app.
import type { Bridge } from "../src/views/popover/bridgeTypes";
import type { AccountInfo, AppState, UsageSnapshot } from "../src/shared/types";
import { listProviders } from "../src/bun/providers/registry";
import { resolveRings } from "../src/bun/usage/rings";

const q = new URLSearchParams(location.search);
const platform = (q.get("platform") ?? "mac") as AppState["platform"];
const scenario = q.get("scenario") ?? "two";
document.documentElement.dataset.platform = platform;

const inH = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const accounts: AccountInfo[] = [];
const usage: Record<string, UsageSnapshot> = {};

if (scenario !== "empty") {
	accounts.push({ id: "claude-1", providerId: "claude", label: "alex@example.com", authMethod: "oauth", addedAt: "" });
	usage["claude-1"] = {
		accountId: "claude-1",
		fetchedAt: new Date().toISOString(),
		plan: "Max",
		windows: [
			{ id: "session", label: "5-hour session", shortLabel: "5h", kind: "short", usedPercent: 42, resetsAt: inH(2.3) },
			{ id: "weekly", label: "Weekly · all models", shortLabel: "7d", kind: "long", usedPercent: 68, resetsAt: inH(52) },
			{ id: "weekly-opus", label: "Weekly · Opus", shortLabel: "Opus", kind: "other", usedPercent: 12, resetsAt: inH(52) },
		],
	};
}
if (scenario === "two") {
	accounts.push({ id: "chatgpt-1", providerId: "chatgpt", label: "alex@example.com", authMethod: "codex", addedAt: "" });
	usage["chatgpt-1"] = {
		accountId: "chatgpt-1",
		fetchedAt: new Date().toISOString(),
		plan: "Plus",
		windows: [
			{ id: "session", label: "5-hour session", shortLabel: "5h", kind: "short", usedPercent: 81, resetsAt: inH(0.6) },
			{ id: "weekly", label: "Weekly", shortLabel: "7d", kind: "long", usedPercent: 23, resetsAt: inH(130) },
		],
	};
}

const settings: AppState["settings"] = { refreshMinutes: 5, ringMode: "auto", rings: [null, null, null], iconTheme: "auto", showPercentInMenuBar: false, alertsEnabled: true, alertThreshold: 15, launchAtLogin: true, providerColors: q.get("colors") ? { claude: "#ff9f0a", chatgpt: "#30d158" } : {} };

const state = (): AppState => ({
	platform,
	providers: listProviders(),
	accounts,
	usage,
	status: Object.fromEntries(accounts.map((a) => [a.id, { state: "ok" as const }])),
	rings: resolveRings(settings, accounts, usage),
	settings,
	pendingAuth: {},
	lastRefreshAt: new Date(Date.now() - 90_000).toISOString(),
	update,
});

let update: AppState["update"] = q.get("update")
	? { currentVersion: "0.2.0", status: "available", availableVersion: "0.3.0" }
	: { currentVersion: "0.2.0", status: "none" };

export function createBridge(): Bridge {
	const ok = async () => state();
	return {
		request: {
			getState: ok,
			refresh: ok,
			startAuth: async () => ({ ok: false, error: "Preview mode: sign-in is disabled." }),
			cancelAuth: async () => {},
			removeAccount: async ({ accountId }) => {
				accounts.splice(accounts.findIndex((a) => a.id === accountId), 1);
				return state();
			},
			renameAccount: ok,
			updateSettings: async (p) => (Object.assign(settings, p), state()),
			setRing: async ({ slot, ref }) => {
				if (settings.ringMode === "auto") {
					settings.rings = [...state().rings.map((r) => r.ref), null, null, null].slice(0, 3);
					settings.ringMode = "custom";
				}
				settings.rings[slot] = ref;
				return state();
			},
			openUrl: async () => {},
			checkForUpdates: ok,
			installUpdate: async () => ((update = { ...update, status: "downloading", progress: 42 }), state()),
			quit: async () => {},
		},
		send: { resize: ({ height }) => ((window as unknown as { __height: number }).__height = height), hide: () => {} },
		on() {},
	};
}
