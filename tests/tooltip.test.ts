import { describe, expect, test } from "bun:test";
import type { AppState, LimitWindow } from "../src/shared/types";
import { TOOLTIP_MAX, trayTooltip } from "../src/bun/tray/tooltip";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const win = (kind: LimitWindow["kind"], shortLabel: string, used: number, resetMin?: number): LimitWindow => ({
	id: `${kind}-${shortLabel}`,
	label: shortLabel,
	shortLabel,
	kind,
	usedPercent: used,
	resetsAt: resetMin === undefined ? undefined : new Date(NOW + resetMin * 60_000).toISOString(),
});

function state(accounts: { id: string; providerId: string; label: string; windows?: LimitWindow[]; error?: boolean }[]): AppState {
	return {
		platform: "win",
		providers: [
			{ id: "claude", displayName: "Claude", iconPath: "", authMethods: [] },
			{ id: "chatgpt", displayName: "ChatGPT", iconPath: "", authMethods: [] },
		],
		accounts: accounts.map((a) => ({ id: a.id, providerId: a.providerId, label: a.label, authMethod: "oauth", addedAt: "" })),
		usage: Object.fromEntries(accounts.map((a) => [a.id, a.windows && { accountId: a.id, fetchedAt: "", windows: a.windows }])),
		status: Object.fromEntries(
			accounts.map((a) => [a.id, a.error ? { state: "error", message: "x", needsReauth: true } : { state: "ok" }]),
		),
		rings: [],
		settings: {} as AppState["settings"],
		pendingAuth: {},
		update: { currentVersion: "0.0.0", status: "idle" },
	} as AppState;
}

describe("trayTooltip", () => {
	test("no accounts", () => {
		expect(trayTooltip(state([]), false, NOW)).toContain("click to connect");
	});

	test("session and weekly with reset time", () => {
		const s = state([{ id: "a", providerId: "claude", label: "me@x.com", windows: [win("short", "5h", 42.4, 130), win("long", "7d", 18, 4000), win("other", "Opus", 3)] }]);
		expect(trayTooltip(s, false, NOW)).toBe("Claude: 5h 42% (reset 2h 10m) · 7d 18% (reset 2d 18h)");
		expect(trayTooltip(s, true, NOW)).toBe("Claude: 5h 42% (сброс 2ч 10м) · 7d 18% (сброс 2д 18ч)");
	});

	test("several accounts of one provider are told apart; errors shown", () => {
		const s = state([
			{ id: "a", providerId: "chatgpt", label: "work@x.com", windows: [win("short", "5h", 90)] },
			{ id: "b", providerId: "chatgpt", label: "home@y.com", error: true },
		]);
		expect(trayTooltip(s, false, NOW)).toBe("ChatGPT (work): 5h 90%\nChatGPT (home): sign in again");
	});

	test("fits the Windows limit", () => {
		const accounts = Array.from({ length: 5 }, (_, i) => ({
			id: String(i),
			providerId: "claude",
			label: `account-number-${i}@example.com`,
			windows: [win("short", "5h", 10, 100), win("long", "7d", 20, 5000)],
		}));
		const tip = trayTooltip(state(accounts), false, NOW);
		expect(tip.length).toBeLessThanOrEqual(TOOLTIP_MAX);
		expect(tip).not.toContain("reset");
	});
});
