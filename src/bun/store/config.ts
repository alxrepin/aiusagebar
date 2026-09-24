import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccountInfo, Settings, UsageSnapshot } from "../../shared/types";

export const DEFAULT_SETTINGS: Settings = {
	refreshMinutes: 5,
	ringMode: "auto",
	rings: [null, null, null],
	iconTheme: "auto",
	showPercentInMenuBar: false,
};

export interface ConfigFile {
	version: 1;
	settings: Settings;
	accounts: AccountInfo[];
	/** Last known usage, so the icon is meaningful right after launch. */
	usage: Record<string, UsageSnapshot>;
}

/** Non-secret app state persisted as JSON. Tokens live in the SecretStore. */
export class ConfigStore {
	data: ConfigFile = { version: 1, settings: { ...DEFAULT_SETTINGS }, accounts: [], usage: {} };
	private writing: Promise<void> = Promise.resolve();

	constructor(readonly path: string) {}

	async load(): Promise<ConfigFile> {
		const file = Bun.file(this.path);
		if (await file.exists()) {
			try {
				const raw = (await file.json()) as Partial<ConfigFile>;
				this.data = {
					version: 1,
					settings: normalizeSettings(raw.settings),
					accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
					usage: raw.usage && typeof raw.usage === "object" ? raw.usage : {},
				};
			} catch (err) {
				console.warn("[config] could not parse, starting fresh:", err);
			}
		}
		return this.data;
	}

	/** Atomic write, serialised so concurrent saves can't interleave. */
	save(): Promise<void> {
		const snapshot = JSON.stringify(this.data, null, 2);
		this.writing = this.writing.then(async () => {
			await mkdir(dirname(this.path), { recursive: true });
			const tmp = `${this.path}.tmp`;
			await Bun.write(tmp, snapshot);
			await rename(tmp, this.path);
		});
		return this.writing;
	}
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
	const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
	s.refreshMinutes = Math.min(60, Math.max(1, Number(s.refreshMinutes) || DEFAULT_SETTINGS.refreshMinutes));
	if (s.ringMode !== "auto" && s.ringMode !== "custom") s.ringMode = "auto";
	if (!["auto", "light", "dark"].includes(s.iconTheme)) s.iconTheme = "auto";
	const rings = Array.isArray(s.rings) ? s.rings.slice(0, 3) : [];
	while (rings.length < 3) rings.push(null);
	s.rings = rings.map((r) => (r && typeof r.accountId === "string" && typeof r.windowId === "string" ? r : null));
	return s;
}
