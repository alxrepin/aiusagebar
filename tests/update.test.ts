import { expect, test } from "bun:test";
import { UpdateController, type UpdateFeed } from "../src/bun/update/updateController";

function setup(check: UpdateFeed["check"], extra: Partial<UpdateFeed> = {}) {
	const notes: string[] = [];
	const calls: string[] = [];
	const c = new UpdateController({
		feed: {
			currentVersion: async () => "0.2.0",
			check,
			download: async () => void calls.push("download"),
			apply: async () => void calls.push("apply"),
			...extra,
		},
		onChange: () => {},
		notify: (_, body) => notes.push(body),
	});
	return { c, notes, calls };
}

test("reports an available update and notifies once per version", async () => {
	const { c, notes } = setup(async () => ({ updateAvailable: true, version: "0.3.0" }));
	await c.check();
	await c.check();
	expect(c.state).toMatchObject({ status: "available", availableVersion: "0.3.0" });
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain("0.3.0");
});

test("no update → up to date", async () => {
	const { c, notes } = setup(async () => ({ updateAvailable: false }));
	await c.check();
	expect(c.state.status).toBe("none");
	expect(notes).toEqual([]);
});

test("install downloads then applies; only when an update is available", async () => {
	const { c, calls } = setup(async () => ({ updateAvailable: true, version: "0.3.0" }));
	await c.install();
	expect(calls).toEqual([]);
	await c.check();
	await c.install();
	expect(calls).toEqual(["download", "apply"]);
	expect(c.state.status).toBe("installing");
});

test("feed errors are surfaced, not thrown", async () => {
	const { c } = setup(async () => {
		throw new Error("offline");
	});
	await c.check();
	expect(c.state).toMatchObject({ status: "error", error: "offline" });

	const d = setup(async () => ({ updateAvailable: true, version: "1.0.0" }), {
		download: async () => {
			throw new Error("disk full");
		},
	});
	await d.c.check();
	await d.c.install();
	expect(d.c.state).toMatchObject({ status: "error", error: "disk full", availableVersion: "1.0.0" });
});

test("download progress is reported only while downloading", async () => {
	let release!: () => void;
	const { c } = setup(async () => ({ updateAvailable: true, version: "0.5.0" }), {
		download: () => new Promise<void>((r) => (release = r)),
	});
	c.setProgress(50);
	expect(c.state.progress).toBeUndefined();
	await c.check();
	const installing = c.install();
	c.setProgress(41.6);
	expect(c.state).toMatchObject({ status: "downloading", progress: 42 });
	release();
	await installing;
	expect(c.state).toMatchObject({ status: "installing", progress: 100 });
});

test("reminds again after a day while the update stays uninstalled", async () => {
	let now = Date.parse("2026-09-24T10:00:00Z");
	const notes: string[] = [];
	const c = new UpdateController({
		feed: {
			currentVersion: async () => "0.5.0",
			check: async () => ({ updateAvailable: true, version: "0.6.0" }),
			download: async () => {},
			apply: async () => {},
		},
		onChange: () => {},
		notify: (_, body) => notes.push(body),
		now: () => now,
	});
	await c.check(); // first time → notify
	now += 3600_000;
	await c.check(); // an hour later → quiet
	expect(notes).toHaveLength(1);
	now += 24 * 3600_000;
	await c.check(); // a day later → remind
	expect(notes).toHaveLength(2);
});
