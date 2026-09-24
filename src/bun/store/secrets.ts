import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Stores provider tokens using the operating system's own secret storage:
 *   macOS   → files encrypted with AES-256-GCM; the key lives in the login Keychain
 *   Windows → file encrypted with DPAPI for the current user (PowerShell)
 *   Linux   → Secret Service / libsecret (`secret-tool`), falling back to a 0600 file
 * Values are cached in memory after the first read.
 */
export interface SecretStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

const SERVICE = "AIUsageBar";

async function run(cmd: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(cmd, {
		stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { code: await proc.exited, stdout, stderr };
}

const safeName = (key: string) => key.replace(/[^a-zA-Z0-9_.-]/g, "_");

/**
 * Legacy macOS store: the whole token JSON as a Keychain item. Kept only to
 * migrate existing items — `security -i` rejects command lines over ~4 KB,
 * which ChatGPT's tokens exceed ("Could not write to the macOS Keychain").
 */
class MacKeychainItems {
	async get(account: string) {
		const r = await run(["security", "find-generic-password", "-s", SERVICE, "-a", safeName(account), "-w"]);
		if (r.code !== 0) return null;
		return Buffer.from(r.stdout.trim(), "base64").toString("utf8");
	}
	/** Only for short values (the encryption key). Passed on stdin so it never shows up in `ps`. */
	async set(account: string, value: string) {
		const b64 = Buffer.from(value, "utf8").toString("base64");
		const r = await run(["security", "-i"], `add-generic-password -U -s ${SERVICE} -a ${safeName(account)} -w ${b64}\n`);
		if (r.code !== 0 || /error/i.test(r.stderr)) {
			throw new Error(`Could not write to the macOS Keychain${r.stderr.trim() ? `: ${r.stderr.trim()}` : ""}`);
		}
	}
	async delete(account: string) {
		await run(["security", "delete-generic-password", "-s", SERVICE, "-a", safeName(account)]);
	}
}

/** Supplies the 256-bit key used by EncryptedFileStore. */
export interface KeyProvider {
	getKey(): Promise<Uint8Array>;
}

const MASTER_KEY_ACCOUNT = "encryption-key";

class MacKeychainKeyProvider implements KeyProvider {
	private key?: Promise<Uint8Array>;
	constructor(private items: MacKeychainItems) {}
	getKey() {
		this.key ??= (async () => {
			const existing = await this.items.get(MASTER_KEY_ACCOUNT);
			if (existing) return new Uint8Array(Buffer.from(existing, "base64"));
			const fresh = crypto.getRandomValues(new Uint8Array(32));
			await this.items.set(MASTER_KEY_ACCOUNT, Buffer.from(fresh).toString("base64"));
			return fresh;
		})().catch((err) => {
			this.key = undefined; // retry next time
			throw err;
		});
		return this.key;
	}
}

/**
 * Secrets as AES-256-GCM encrypted files (0600). Any size works, and only
 * the short key needs to live in the OS keychain.
 */
export class EncryptedFileStore implements SecretStore {
	constructor(
		private dir: string,
		private keys: KeyProvider,
	) {}
	private path(key: string) {
		return join(this.dir, `${safeName(key)}.enc`);
	}
	private async cryptoKey() {
		const raw = await this.keys.getKey();
		return crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
	}
	async get(key: string) {
		const f = Bun.file(this.path(key));
		if (!(await f.exists())) return null;
		const data = Buffer.from((await f.text()).trim(), "base64");
		const iv = data.subarray(0, 12);
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await this.cryptoKey(), data.subarray(12));
		return new TextDecoder().decode(plain);
	}
	async set(key: string, value: string) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.cryptoKey(), new TextEncoder().encode(value));
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		await Bun.write(this.path(key), Buffer.concat([iv, new Uint8Array(cipher)]).toString("base64"));
		await chmod(this.path(key), 0o600).catch(() => {});
	}
	async delete(key: string) {
		await rm(this.path(key), { force: true });
	}
}

/** macOS: encrypted files keyed from the Keychain, migrating items written by older versions. */
class MacStore implements SecretStore {
	private legacy = new MacKeychainItems();
	private files: EncryptedFileStore;
	constructor(dir: string) {
		this.files = new EncryptedFileStore(dir, new MacKeychainKeyProvider(this.legacy));
	}
	async get(key: string) {
		const v = await this.files.get(key);
		if (v !== null) return v;
		const old = await this.legacy.get(key);
		if (old !== null) {
			await this.files.set(key, old);
			await this.legacy.delete(key);
		}
		return old;
	}
	set(key: string, value: string) {
		return this.files.set(key, value);
	}
	async delete(key: string) {
		await this.files.delete(key);
		await this.legacy.delete(key);
	}
}

class WindowsDpapiStore implements SecretStore {
	constructor(private dir: string) {}
	private path(key: string) {
		return join(this.dir, `${safeName(key)}.dpapi`);
	}
	private ps(script: string, stdin?: string) {
		return run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], stdin);
	}
	async get(key: string) {
		const file = Bun.file(this.path(key));
		if (!(await file.exists())) return null;
		const script =
			"Add-Type -AssemblyName System.Security;" +
			"$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
			"$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser');" +
			"[Console]::Out.Write([Convert]::ToBase64String($d))";
		const r = await this.ps(script, await file.text());
		if (r.code !== 0) return null;
		return Buffer.from(r.stdout.trim(), "base64").toString("utf8");
	}
	async set(key: string, value: string) {
		await mkdir(this.dir, { recursive: true });
		const script =
			"Add-Type -AssemblyName System.Security;" +
			"$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
			"$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser');" +
			"[Console]::Out.Write([Convert]::ToBase64String($e))";
		const r = await this.ps(script, Buffer.from(value, "utf8").toString("base64"));
		if (r.code !== 0 || !r.stdout.trim()) throw new Error("Could not encrypt secret with DPAPI");
		await Bun.write(this.path(key), r.stdout.trim());
	}
	async delete(key: string) {
		await rm(this.path(key), { force: true });
	}
}

class LibsecretStore implements SecretStore {
	async get(key: string) {
		const r = await run(["secret-tool", "lookup", "service", SERVICE, "account", key]);
		return r.code === 0 && r.stdout ? r.stdout : null;
	}
	async set(key: string, value: string) {
		const r = await run(["secret-tool", "store", `--label=${SERVICE} ${key}`, "service", SERVICE, "account", key], value);
		if (r.code !== 0) throw new Error("secret-tool store failed");
	}
	async delete(key: string) {
		await run(["secret-tool", "clear", "service", SERVICE, "account", key]);
	}
}

/** Last-resort store: a file readable only by the current user. */
export class FileStore implements SecretStore {
	constructor(private dir: string) {}
	private path(key: string) {
		return join(this.dir, `${safeName(key)}.json`);
	}
	async get(key: string) {
		const f = Bun.file(this.path(key));
		return (await f.exists()) ? f.text() : null;
	}
	async set(key: string, value: string) {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		await Bun.write(this.path(key), value);
		await chmod(this.path(key), 0o600).catch(() => {});
	}
	async delete(key: string) {
		await rm(this.path(key), { force: true });
	}
}

/** In-memory store, used by tests. */
export class MemoryStore implements SecretStore {
	map = new Map<string, string>();
	async get(key: string) {
		return this.map.get(key) ?? null;
	}
	async set(key: string, value: string) {
		this.map.set(key, value);
	}
	async delete(key: string) {
		this.map.delete(key);
	}
}

class CachedStore implements SecretStore {
	private cache = new Map<string, string | null>();
	constructor(private inner: SecretStore) {}
	async get(key: string) {
		if (!this.cache.has(key)) this.cache.set(key, await this.inner.get(key));
		return this.cache.get(key) ?? null;
	}
	async set(key: string, value: string) {
		if (this.cache.get(key) === value) return;
		await this.inner.set(key, value);
		this.cache.set(key, value);
	}
	async delete(key: string) {
		this.cache.delete(key);
		await this.inner.delete(key);
	}
}

/** Linux: prefer libsecret, but fall back to the file store if no Secret Service is running. */
class FallbackStore implements SecretStore {
	constructor(
		private primary: SecretStore,
		private fallback: SecretStore,
	) {}
	async get(key: string) {
		return (await this.primary.get(key).catch(() => null)) ?? this.fallback.get(key);
	}
	async set(key: string, value: string) {
		try {
			await this.primary.set(key, value);
			await this.fallback.delete(key);
		} catch {
			await this.fallback.set(key, value);
		}
	}
	async delete(key: string) {
		await this.primary.delete(key).catch(() => {});
		await this.fallback.delete(key);
	}
}

export function createSecretStore(dataDir: string, platform = process.platform): SecretStore {
	const secretsDir = join(dataDir, "secrets");
	let store: SecretStore;
	if (platform === "darwin") store = new MacStore(secretsDir);
	else if (platform === "win32") store = new WindowsDpapiStore(secretsDir);
	else if (Bun.which("secret-tool")) store = new FallbackStore(new LibsecretStore(), new FileStore(secretsDir));
	else store = new FileStore(secretsDir);
	return new CachedStore(store);
}
