import { afterEach, expect, test } from "bun:test";
import { isRu, setLanguage } from "../src/bun/i18n";
import { normalizeSettings } from "../src/bun/store/config";
import { checkLowLimits } from "../src/bun/usage/alerts";

afterEach(() => setLanguage("system"));

test("language and theme default to the system and reject unknown values", () => {
	const d = normalizeSettings(undefined);
	expect(d.language).toBe("system");
	expect(d.theme).toBe("system");
	const s = normalizeSettings({ language: "de" as never, theme: "sepia" as never });
	expect(s.language).toBe("system");
	expect(s.theme).toBe("system");
	expect(normalizeSettings({ language: "ru", theme: "dark" })).toMatchObject({ language: "ru", theme: "dark" });
});

test("notification language follows the setting, not the OS", () => {
	const run = () =>
		checkLowLimits({
			settings: { alertsEnabled: true, alertThreshold: 15 },
			account: { id: "a", providerId: "claude", label: "me", authMethod: "oauth", addedAt: "" },
			providerName: "Claude",
			snapshot: { accountId: "a", fetchedAt: "", windows: [{ id: "session", label: "5-hour session", shortLabel: "5h", kind: "short", usedPercent: 90 }] },
			alerted: new Set(),
		})[0]!.title;

	setLanguage("ru");
	expect(isRu()).toBe(true);
	expect(run()).toBe("Claude: осталось 10%");

	setLanguage("en");
	expect(isRu()).toBe(false);
	expect(run()).toBe("Claude: 10% left");
});
