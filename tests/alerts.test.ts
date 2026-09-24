import { describe, expect, test } from "bun:test";
import { checkLowLimits } from "../src/bun/usage/alerts";
import { normalizeSettings } from "../src/bun/store/config";
import type { AccountInfo, UsageSnapshot } from "../src/shared/types";

const account: AccountInfo = { id: "c1", providerId: "claude", label: "me@x.io", authMethod: "oauth", addedAt: "" };
const now = Date.parse("2026-09-24T10:00:00Z");
const snap = (session: number, weekly = 10): UsageSnapshot => ({
	accountId: "c1",
	fetchedAt: "",
	windows: [
		{ id: "session", label: "5-hour session", shortLabel: "5h", kind: "short", usedPercent: session, resetsAt: "2026-09-24T12:30:00Z" },
		{ id: "weekly", label: "Weekly", shortLabel: "7d", kind: "long", usedPercent: weekly },
	],
});
const run = (snapshot: UsageSnapshot, alerted: Set<string>, settings = { alertsEnabled: true, alertThreshold: 15 }) =>
	checkLowLimits({ settings, account, providerName: "Claude", snapshot, alerted, now });

describe("low-limit alerts", () => {
	test("defaults: enabled, 15% left", () => {
		const s = normalizeSettings(undefined);
		expect(s.alertsEnabled).toBe(true);
		expect(s.alertThreshold).toBe(15);
	});

	test("fires once when less than the threshold is left", () => {
		const alerted = new Set<string>();
		expect(run(snap(80), alerted)).toEqual([]); // 20% left
		expect(run(snap(85), alerted)).toEqual([]); // exactly 15% left: not "less than"
		const [a] = run(snap(88), alerted); // 12% left
		expect(a?.key).toBe("c1|session");
		expect(a?.title).toMatch(/12%/);
		expect(a?.body).toMatch(/5-hour session/);
		expect(a?.body).toMatch(/2h 30m|2ч 30мин/);
		expect(run(snap(95), alerted)).toEqual([]); // still low: no repeat
	});

	test("re-arms after the limit recovers (reset)", () => {
		const alerted = new Set<string>();
		expect(run(snap(90), alerted)).toHaveLength(1);
		expect(run(snap(3), alerted)).toEqual([]); // reset
		expect(run(snap(90), alerted)).toHaveLength(1);
	});

	test("limit reached has its own wording", () => {
		const [a] = run(snap(100), new Set());
		expect(a?.title).toMatch(/limit reached|лимит исчерпан/);
	});

	test("each window is tracked separately", () => {
		expect(run(snap(90, 95), new Set()).map((a) => a.key)).toEqual(["c1|session", "c1|weekly"]);
	});

	test("disabled: nothing fires, enabling later reports a limit that is already low", () => {
		const alerted = new Set<string>();
		expect(run(snap(90), alerted, { alertsEnabled: false, alertThreshold: 15 })).toEqual([]);
		expect(run(snap(90), alerted)).toHaveLength(1);
	});

	test("custom threshold", () => {
		expect(run(snap(60), new Set(), { alertsEnabled: true, alertThreshold: 50 })).toHaveLength(1);
		expect(normalizeSettings({ alertThreshold: 500 }).alertThreshold).toBe(99);
	});
});
