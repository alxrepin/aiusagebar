import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Stores provider tokens using the operating system's own secret storage:
 *   macOS   → login Keychain (`security`)
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

async function run(cmd: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
	const proc = Bun.spawn(cmd, {
		stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "ignore",
	});
	const stdout = await new Response(proc.stdout).text();
	return { code: await proc.exited, stdout };
}

const safeName = (key: string) => key.replace(/[^a-zA-Z0-9_.-]/g, "_");

class MacKeychainStore implements SecretStore {
	async get(key: string) {
		const r = await run(["security", "find-generic-password", "-s", SERVICE, "-a", safeName(key), "-w"]);
		if (r.code !== 0) return null;
		return Buffer.from(r.stdout.trim(), "base64").toString("utf8");
	}
	async set(key: string, value: string) {
		// Pass the secret through `security -i` on stdin so it never shows up in the process list.
		const b64 = Buffer.from(value, "utf8").toString("base64");
		const r = await run(["security", "-i"], `add-generic-password -U -s ${SERVICE} -a ${safeName(key)} -w ${b64}\n`);
		if (r.code !== 0) throw new Error("Could not write to the macOS Keychain");
	}
	async delete(key: string) {
		await run(["security", "delete-generic-password", "-s", SERVICE, "-a", safeName(key)]);
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
	if (platform === "darwin") store = new MacKeychainStore();
	else if (platform === "win32") store = new WindowsDpapiStore(secretsDir);
	else if (Bun.which("secret-tool")) store = new FallbackStore(new LibsecretStore(), new FileStore(secretsDir));
	else store = new FileStore(secretsDir);
	return new CachedStore(store);
}
