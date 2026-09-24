import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedFileStore, type KeyProvider } from "../src/bun/store/secrets";

const keyOf = (byte: number): KeyProvider => ({ getKey: async () => new Uint8Array(32).fill(byte) });

// ChatGPT's id + access tokens are several KB; `security -i` rejected them.
const bigToken = JSON.stringify({ source: "oauth", idToken: "x".repeat(3000), accessToken: "y".repeat(4000), refreshToken: "z".repeat(100) });

test("round-trips large secrets without storing plaintext", async () => {
	const dir = mkdtempSync(join(tmpdir(), "aiub-sec-"));
	const store = new EncryptedFileStore(dir, keyOf(7));
	await store.set("account-chatgpt-1", bigToken);
	expect(await store.get("account-chatgpt-1")).toBe(bigToken);

	const [file] = readdirSync(dir);
	const raw = await Bun.file(join(dir, file!)).text();
	expect(raw).not.toContain("yyyy");
	expect(Buffer.from(raw, "base64").toString("latin1")).not.toContain("yyyy");
	if (process.platform !== "win32") expect(statSync(join(dir, file!)).mode & 0o777).toBe(0o600);
});

test("a fresh IV per write; wrong key can't decrypt; delete removes the file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "aiub-sec-"));
	const store = new EncryptedFileStore(dir, keyOf(1));
	await store.set("a", "secret");
	const first = await Bun.file(join(dir, "a.enc")).text();
	await store.set("a", "secret");
	expect(await Bun.file(join(dir, "a.enc")).text()).not.toBe(first);

	await expect(new EncryptedFileStore(dir, keyOf(2)).get("a")).rejects.toThrow();

	await store.delete("a");
	expect(await store.get("a")).toBeNull();
});
