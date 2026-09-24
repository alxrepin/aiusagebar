import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProvider } from "../src/bun/providers/registry";
import { ReauthRequiredError, type UsageProvider } from "../src/bun/providers/types";
import { ConfigStore } from "../src/bun/store/config";
import { MemoryStore } from "../src/bun/store/secrets";
import { UsageService } from "../src/bun/usage/service";

let used = 10;
let fail: Error | null = null;
let calls = 0;

const fake: UsageProvider = {
	id: "fake",
	displayName: "Fake",
	iconPath: "",
	authMethods: [{ id: "token", label: "Token", description: "", kind: "instant" }],
	async authenticate() {
		return { credentials: { token: "t1" }, label: "me@example.com", identity: "user-1" };
	},
	async fetchUsage(creds) {
		calls++;
		if (fail) throw fail;
		return {
			usage: {
				plan: "Test",
				windows: [
					{ id: "session", label: "Session", shortLabel: "5h", kind: "short", usedPercent: used },
					{ id: "weekly", label: "Weekly", shortLabel: "7d", kind: "long", usedPercent: used / 2 },
				],
			},
			credentials: { ...creds, token: "t2" },
		};
	},
};
registerProvider(fake);

function makeService() {
	const dir = mkdtempSync(join(tmpdir(), "aiub-"));
	const config = new ConfigStore(join(dir, "config.json"));
	const secrets = new MemoryStore();
	const service = new UsageService({
		config,
		secrets,
		platform: "mac",
		baseContext: { openUrl() {}, fetch, homeDir: dir, platform: "darwin" },
	});
	return { service, config, secrets };
}

beforeEach(() => {
	used = 10;
	fail = null;
	calls = 0;
});

describe("UsageService", () => {
	test("adding an account stores secrets separately and fetches usage", async () => {
		const { service, config, secrets } = makeService();
		const account = await service.startAuth("fake", "token");
		const state = service.getState();

		expect(state.accounts).toHaveLength(1);
		expect(state.usage[account.id]?.windows[0]?.usedPercent).toBe(10);
		expect(state.rings.map((r) => r.progress)).toEqual([0.1, 0.05]);
		// Rotated credentials were persisted to the secret store, not the config file.
		expect(JSON.parse((await secrets.get(`account-${account.id}`))!)).toEqual({ token: "t2" });
		const file = await Bun.file(config.path).text();
		expect(file).not.toContain("t1");
		expect(file).not.toContain("t2");
	});

	test("re-connecting the same identity does not duplicate the account", async () => {
		const { service } = makeService();
		await service.startAuth("fake", "token");
		await service.startAuth("fake", "token");
		expect(service.getState().accounts).toHaveLength(1);
	});

	test("removing an account clears usage, secrets and ring slots", async () => {
		const { service, secrets } = makeService();
		const a = await service.startAuth("fake", "token");
		await service.setRing(2, { accountId: a.id, windowId: "weekly" });
		await service.removeAccount(a.id);
		const s = service.getState();
		expect(s.accounts).toEqual([]);
		expect(s.usage[a.id]).toBeUndefined();
		expect(s.settings.rings.every((r) => r === null)).toBe(true);
		expect(await secrets.get(`account-${a.id}`)).toBeNull();
	});

	test("setRing switches to custom mode seeded with the auto layout", async () => {
		const { service } = makeService();
		const a = await service.startAuth("fake", "token");
		await service.setRing(0, { accountId: a.id, windowId: "weekly" });
		const s = service.getState();
		expect(s.settings.ringMode).toBe("custom");
		expect(s.settings.rings).toEqual([
			{ accountId: a.id, windowId: "weekly" },
			{ accountId: a.id, windowId: "weekly" },
			null,
		]);
	});

	test("errors are reported and backed off; reauth errors are flagged", async () => {
		const { service } = makeService();
		const a = await service.startAuth("fake", "token");

		fail = new Error("boom");
		await service.refreshAll({ force: true });
		expect(service.getState().status[a.id]).toEqual({ state: "error", message: "boom", needsReauth: false });

		const before = calls;
		await service.refreshAll(); // within backoff → skipped
		expect(calls).toBe(before);

		fail = new ReauthRequiredError("sign in again");
		await service.refreshAll({ force: true });
		expect(service.getState().status[a.id]).toMatchObject({ state: "error", needsReauth: true });

		// Last good data is kept while erroring.
		expect(service.getState().usage[a.id]?.windows[0]?.usedPercent).toBe(10);
	});

	test("state survives a restart via the config file", async () => {
		const { service, config } = makeService();
		await service.startAuth("fake", "token");
		const reloaded = new ConfigStore(config.path);
		await reloaded.load();
		expect(reloaded.data.accounts).toHaveLength(1);
		expect(Object.values(reloaded.data.usage)[0]?.windows).toHaveLength(2);
	});
});

describe("UsageService alerts", () => {
	test("notifies once when a limit drops below the threshold and persists that", async () => {
		const dir = mkdtempSync(join(tmpdir(), "aiub-"));
		const config = new ConfigStore(join(dir, "config.json"));
		const notes: string[] = [];
		const service = new UsageService({
			config,
			secrets: new MemoryStore(),
			platform: "mac",
			notify: (title) => notes.push(title),
			baseContext: { openUrl() {}, fetch, homeDir: dir, platform: "darwin" },
		});
		used = 50;
		await service.startAuth("fake", "token");
		expect(notes).toEqual([]);

		used = 90; // 10% left on the session window
		await service.refreshAll({ force: true });
		await service.refreshAll({ force: true });
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatch(/Fake/);
		expect(config.data.alerted).toEqual([expect.stringMatching(/\|session$/)]);

		// Raising the threshold re-checks the data we already have: weekly is at 45% used → 55% left.
		await service.updateSettings({ alertThreshold: 60 });
		expect(notes).toHaveLength(2);
	});
});
