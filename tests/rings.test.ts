import { describe, expect, test } from "bun:test";
import { autoRingRefs, resolveRings } from "../src/bun/usage/rings";
import type { AccountInfo, UsageSnapshot } from "../src/shared/types";

const acc = (id: string, providerId: string): AccountInfo => ({ id, providerId, label: id, authMethod: "oauth", addedAt: "" });
const usage = (accountId: string, session: number, weekly: number): UsageSnapshot => ({
	accountId,
	fetchedAt: "",
	windows: [
		{ id: "session", label: "5-hour session", shortLabel: "5h", kind: "short", usedPercent: session },
		{ id: "weekly", label: "Weekly", shortLabel: "7d", kind: "long", usedPercent: weekly },
	],
});

describe("auto rings", () => {
	test("no accounts → no rings", () => {
		expect(autoRingRefs([], {})).toEqual([]);
	});

	test("one account → session + weekly of that account", () => {
		const rings = resolveRings({ ringMode: "auto", rings: [] }, [acc("c", "claude")], { c: usage("c", 40, 10) });
		expect(rings.map((r) => [r.ref.windowId, r.progress])).toEqual([
			["session", 0.4],
			["weekly", 0.1],
		]);
	});

	test("two accounts → the session limit of each", () => {
		const rings = resolveRings({ ringMode: "auto", rings: [] }, [acc("c", "claude"), acc("g", "chatgpt")], {
			c: usage("c", 40, 10),
			g: usage("g", 75, 20),
		});
		expect(rings.map((r) => [r.providerId, r.ref.windowId, r.progress])).toEqual([
			["claude", "session", 0.4],
			["chatgpt", "session", 0.75],
		]);
	});

	test("at most three rings", () => {
		const accounts = ["a", "b", "c", "d"].map((id) => acc(id, "claude"));
		expect(resolveRings({ ringMode: "auto", rings: [] }, accounts, {})).toHaveLength(3);
	});

	test("missing data → progress null", () => {
		const [r] = resolveRings({ ringMode: "auto", rings: [] }, [acc("c", "claude")], {});
		expect(r?.progress).toBeNull();
	});
});

describe("custom rings", () => {
	const accounts = [acc("c", "claude"), acc("g", "chatgpt")];
	const u = { c: usage("c", 40, 10), g: usage("g", 75, 20) };

	test("uses configured slots and skips empty ones", () => {
		const rings = resolveRings(
			{ ringMode: "custom", rings: [{ accountId: "g", windowId: "weekly" }, null, { accountId: "c", windowId: "weekly" }] },
			accounts,
			u,
		);
		expect(rings.map((r) => [r.ref.accountId, r.progress])).toEqual([
			["g", 0.2],
			["c", 0.1],
		]);
	});

	test("ignores removed accounts and falls back to auto when nothing is left", () => {
		const rings = resolveRings({ ringMode: "custom", rings: [{ accountId: "gone", windowId: "weekly" }, null, null] }, accounts, u);
		expect(rings).toHaveLength(2);
		expect(rings[0]?.ref.windowId).toBe("session");
	});
});

describe("provider colours", () => {
	test("rings carry the colour of their provider; invalid colours are dropped", async () => {
		const { normalizeSettings } = await import("../src/bun/store/config");
		const s = normalizeSettings({ providerColors: { claude: "#FF9F0A", chatgpt: "red" } as Record<string, string> });
		expect(s.providerColors).toEqual({ claude: "#ff9f0a" });
		expect(normalizeSettings(undefined).providerColors).toEqual({});

		const rings = resolveRings({ ringMode: "auto", rings: [], providerColors: s.providerColors }, [acc("c", "claude"), acc("g", "chatgpt")], {
			c: usage("c", 40, 10),
			g: usage("g", 75, 20),
		});
		expect(rings.map((r) => r.color)).toEqual(["#ff9f0a", undefined]);
	});
});
