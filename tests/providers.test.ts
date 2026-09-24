import { describe, expect, test } from "bun:test";
import { parseChatGptUsage } from "../src/bun/providers/chatgpt";
import { parseClaudeUsage } from "../src/bun/providers/claude";
import { parseClaudeCodeCredentials } from "../src/bun/providers/claude/cliCredentials";

describe("Claude usage parsing", () => {
	test("maps five_hour / seven_day / per-model buckets", () => {
		const w = parseClaudeUsage({
			five_hour: { utilization: 37.5, resets_at: "2026-09-24T15:00:00Z" },
			seven_day: { utilization: 12, resets_at: "2026-09-29T08:00:00Z" },
			seven_day_opus: { utilization: 3, resets_at: null },
			seven_day_sonnet: null,
		});
		expect(w.map((x) => [x.id, x.kind, x.usedPercent])).toEqual([
			["session", "short", 37.5],
			["weekly", "long", 12],
			["weekly-opus", "other", 3],
		]);
		expect(w[0]?.resetsAt).toBe("2026-09-24T15:00:00Z");
		expect(w[2]?.resetsAt).toBeUndefined();
	});

	test("clamps out-of-range values", () => {
		expect(parseClaudeUsage({ five_hour: { utilization: 130 } })[0]?.usedPercent).toBe(100);
	});
});

describe("ChatGPT usage parsing", () => {
	test("classifies primary/secondary windows by length", () => {
		const now = Date.parse("2026-09-24T10:00:00Z");
		const w = parseChatGptUsage(
			{
				plan_type: "plus",
				rate_limit: {
					primary_window: { used_percent: 64, limit_window_seconds: 18000, reset_after_seconds: 3600 },
					secondary_window: { used_percent: 21, limit_window_seconds: 604800, reset_at: 1790000000 },
				},
			},
			now,
		);
		expect(w.map((x) => [x.id, x.shortLabel, x.kind, x.usedPercent])).toEqual([
			["session", "5h", "short", 64],
			["weekly", "7d", "long", 21],
		]);
		expect(w[0]?.resetsAt).toBe("2026-09-24T11:00:00.000Z");
		expect(w[1]?.resetsAt).toBe(new Date(1790000000 * 1000).toISOString());
	});

	test("handles missing rate_limit", () => {
		expect(parseChatGptUsage({})).toEqual([]);
	});
});

test("Claude Code credentials file parsing", () => {
	const c = parseClaudeCodeCredentials(
		JSON.stringify({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: 5, subscriptionType: "max" } }),
	);
	expect(c).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 5, subscriptionType: "max" });
	expect(parseClaudeCodeCredentials("{}")).toBeNull();
});
