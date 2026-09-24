import type { UpdateState } from "../../shared/types";

/** The bits of an update feed we need; implemented with Electrobun's Updater in index.ts. */
export interface UpdateFeed {
	currentVersion(): Promise<string>;
	check(): Promise<{ updateAvailable: boolean; version?: string; error?: string }>;
	/** Downloads the new bundle; resolves when it is ready to install. */
	download(): Promise<void>;
	/** Replaces the app and relaunches it. */
	apply(): Promise<void>;
}

export interface UpdateControllerDeps {
	feed: UpdateFeed;
	onChange: (state: UpdateState) => void;
	notify?: (title: string, body: string) => void;
	/** Background check interval. */
	intervalMs?: number;
	now?: () => number;
}

const ru = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("ru");
	} catch {
		return false;
	}
};

/**
 * Checks the release feed in the background (on launch and every few hours),
 * tells the UI when a newer version exists and notifies once per version.
 * Installing is always an explicit click, so the app never restarts under the user.
 */
export class UpdateController {
	state: UpdateState = { currentVersion: "", status: "idle" };
	private timer: ReturnType<typeof setInterval> | null = null;
	private notifiedVersion?: string;

	constructor(private deps: UpdateControllerDeps) {}

	async start(initialDelayMs = 15_000) {
		this.set({ currentVersion: await this.deps.feed.currentVersion().catch(() => "") });
		setTimeout(() => void this.check(), initialDelayMs);
		this.timer = setInterval(() => void this.check(), this.deps.intervalMs ?? 6 * 3600_000);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
	}

	private set(patch: Partial<UpdateState>) {
		this.state = { ...this.state, ...patch };
		this.deps.onChange(this.state);
	}

	async check(): Promise<UpdateState> {
		if (this.state.status === "downloading" || this.state.status === "installing") return this.state;
		this.set({ status: "checking", error: undefined });
		const checkedAt = new Date(this.deps.now?.() ?? Date.now()).toISOString();
		try {
			const r = await this.deps.feed.check();
			if (r.error) {
				this.set({ status: "error", error: r.error, checkedAt });
			} else if (r.updateAvailable) {
				this.set({ status: "available", availableVersion: r.version, checkedAt });
				const v = r.version ?? "";
				if (this.notifiedVersion !== v) {
					this.notifiedVersion = v;
					this.deps.notify?.(
						"AIUsageBar",
						ru() ? `Доступна новая версия${v ? ` ${v}` : ""}. Откройте AIUsageBar, чтобы обновиться.` : `Version${v ? ` ${v}` : ""} is available. Open AIUsageBar to update.`,
					);
				}
			} else {
				this.set({ status: "none", availableVersion: undefined, checkedAt });
			}
		} catch (err) {
			this.set({ status: "error", error: err instanceof Error ? err.message : String(err), checkedAt });
		}
		return this.state;
	}

	/** Download progress reported by the feed (0..100). */
	setProgress(progress: number) {
		if (this.state.status !== "downloading") return;
		const p = Math.max(0, Math.min(100, Math.round(progress)));
		if (p !== this.state.progress) this.set({ progress: p });
	}

	async install(): Promise<UpdateState> {
		if (this.state.status !== "available") return this.state;
		try {
			this.set({ status: "downloading", error: undefined, progress: undefined });
			await this.deps.feed.download();
			this.set({ status: "installing", progress: 100 });
			await this.deps.feed.apply();
		} catch (err) {
			this.set({ status: "error", error: err instanceof Error ? err.message : String(err) });
		}
		return this.state;
	}
}
