import type { AccountInfo, AccountStatus, AppState, RingRef, Settings, UsageSnapshot } from "../../shared/types";
import { getProvider, listProviders } from "../providers/registry";
import { RateLimitedError, ReauthRequiredError, type Credentials, type ProviderContext } from "../providers/types";
import { normalizeSettings, type ConfigStore } from "../store/config";
import type { SecretStore } from "../store/secrets";
import { resolveRings } from "./rings";

export interface ServiceDeps {
	config: ConfigStore;
	secrets: SecretStore;
	platform: AppState["platform"];
	baseContext: Omit<ProviderContext, "signal">;
	now?: () => number;
}

type Listener = (state: AppState) => void;

const secretKey = (accountId: string) => `account-${accountId}`;

/**
 * Owns accounts, credentials and the background refresh loop.
 * UI-agnostic: the tray and the popover subscribe via `onChange`.
 */
export class UsageService {
	private status: Record<string, AccountStatus> = {};
	private pendingAuth = new Map<string, { id: string; abort: AbortController }>();
	private inflight = new Map<string, Promise<void>>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** Per-account "don't call before" timestamps after 429s / errors. */
	private backoffUntil = new Map<string, number>();
	private failures = new Map<string, number>();
	private listeners = new Set<Listener>();
	private lastRefreshAt?: string;

	constructor(private deps: ServiceDeps) {}

	private get now() {
		return this.deps.now?.() ?? Date.now();
	}

	private get data() {
		return this.deps.config.data;
	}

	onChange(fn: Listener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit() {
		const s = this.getState();
		for (const fn of this.listeners) fn(s);
	}

	getState(): AppState {
		const { settings, accounts, usage } = this.data;
		return {
			platform: this.deps.platform,
			providers: listProviders(),
			accounts,
			usage,
			status: Object.fromEntries(accounts.map((a) => [a.id, this.status[a.id] ?? { state: "idle" }])),
			rings: resolveRings(settings, accounts, usage),
			settings,
			pendingAuth: Object.fromEntries([...this.pendingAuth].map(([p, v]) => [p, v.id])),
			lastRefreshAt: this.lastRefreshAt,
		};
	}

	// ---- background refresh -------------------------------------------------

	start() {
		void this.refreshAll();
		this.schedule();
	}

	stop() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		for (const { abort } of this.pendingAuth.values()) abort.abort();
	}

	private schedule() {
		if (this.timer) clearTimeout(this.timer);
		const ms = this.data.settings.refreshMinutes * 60_000;
		this.timer = setTimeout(async () => {
			await this.refreshAll();
			this.schedule();
		}, ms);
	}

	/** Refresh if the data is older than `maxAgeMs` (used when the popover opens). */
	async refreshIfStale(maxAgeMs = 60_000) {
		const last = this.lastRefreshAt ? Date.parse(this.lastRefreshAt) : 0;
		if (this.now - last > maxAgeMs) await this.refreshAll();
	}

	async refreshAll(opts: { force?: boolean } = {}) {
		await Promise.all(this.data.accounts.map((a) => this.refreshAccount(a.id, opts)));
		this.lastRefreshAt = new Date(this.now).toISOString();
		this.emit();
	}

	refreshAccount(accountId: string, opts: { force?: boolean } = {}): Promise<void> {
		const existing = this.inflight.get(accountId);
		if (existing) return existing;
		if (!opts.force && (this.backoffUntil.get(accountId) ?? 0) > this.now) return Promise.resolve();

		const p = this.doRefresh(accountId).finally(() => this.inflight.delete(accountId));
		this.inflight.set(accountId, p);
		return p;
	}

	private async doRefresh(accountId: string) {
		const account = this.data.accounts.find((a) => a.id === accountId);
		if (!account) return;
		const provider = getProvider(account.providerId);
		if (!provider) {
			this.status[accountId] = { state: "error", message: `Unknown provider ${account.providerId}` };
			return;
		}

		this.status[accountId] = { state: "loading" };
		this.emit();

		try {
			const raw = await this.deps.secrets.get(secretKey(accountId));
			if (!raw) throw new ReauthRequiredError("Credentials are missing. Please sign in again.");
			const creds = JSON.parse(raw) as Credentials;
			const result = await provider.fetchUsage(creds, { ...this.deps.baseContext });

			// The account may have been removed while we were waiting.
			if (!this.data.accounts.some((a) => a.id === accountId)) return;

			if (result.credentials) await this.deps.secrets.set(secretKey(accountId), JSON.stringify(result.credentials));
			const snapshot: UsageSnapshot = { ...result.usage, accountId, fetchedAt: new Date(this.now).toISOString() };
			this.data.usage[accountId] = snapshot;
			this.status[accountId] = { state: "ok" };
			this.failures.delete(accountId);
			this.backoffUntil.delete(accountId);
			await this.deps.config.save();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const needsReauth = err instanceof ReauthRequiredError;
			this.status[accountId] = { state: "error", message, needsReauth };

			// Exponential backoff (1, 2, 4 … 30 min) so a broken account doesn't hammer the API.
			const n = (this.failures.get(accountId) ?? 0) + 1;
			this.failures.set(accountId, n);
			const retryAfter = err instanceof RateLimitedError && err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : 0;
			const delay = Math.max(retryAfter, Math.min(30, 2 ** (n - 1)) * 60_000);
			if (!needsReauth) this.backoffUntil.set(accountId, this.now + delay);
			console.warn(`[usage] ${account.providerId}/${account.label}: ${message}`);
		} finally {
			this.emit();
		}
	}

	// ---- accounts -------------------------------------------------------------

	async startAuth(providerId: string, methodId: string): Promise<AccountInfo> {
		const provider = getProvider(providerId);
		if (!provider) throw new Error(`Unknown provider ${providerId}`);

		this.cancelAuth(providerId);
		const abort = new AbortController();
		const flowId = crypto.randomUUID();
		this.pendingAuth.set(providerId, { id: flowId, abort });
		this.emit();

		try {
			const result = await provider.authenticate(methodId, { ...this.deps.baseContext, signal: abort.signal });

			// Re-connecting an account we already have: update it instead of duplicating.
			const duplicate = this.data.accounts.find(
				(a) => a.providerId === providerId && (result.identity ? a.id === accountIdFor(providerId, result.identity) : a.label === result.label),
			);
			const account: AccountInfo = duplicate ?? {
				id: result.identity ? accountIdFor(providerId, result.identity) : `${providerId}-${crypto.randomUUID().slice(0, 8)}`,
				providerId,
				label: result.label,
				authMethod: methodId,
				addedAt: new Date(this.now).toISOString(),
			};
			account.authMethod = methodId;

			await this.deps.secrets.set(secretKey(account.id), JSON.stringify(result.credentials));
			if (!duplicate) this.data.accounts.push(account);
			this.failures.delete(account.id);
			this.backoffUntil.delete(account.id);
			await this.deps.config.save();
			await this.refreshAccount(account.id, { force: true });
			return account;
		} finally {
			if (this.pendingAuth.get(providerId)?.id === flowId) this.pendingAuth.delete(providerId);
			this.emit();
		}
	}

	cancelAuth(providerId: string) {
		const pending = this.pendingAuth.get(providerId);
		if (!pending) return;
		pending.abort.abort();
		this.pendingAuth.delete(providerId);
		this.emit();
	}

	async removeAccount(accountId: string) {
		this.data.accounts = this.data.accounts.filter((a) => a.id !== accountId);
		delete this.data.usage[accountId];
		delete this.status[accountId];
		this.failures.delete(accountId);
		this.backoffUntil.delete(accountId);
		// Drop ring slots that pointed at this account.
		this.data.settings.rings = this.data.settings.rings.map((r) => (r?.accountId === accountId ? null : r));
		await this.deps.secrets.delete(secretKey(accountId)).catch(() => {});
		await this.deps.config.save();
		this.emit();
	}

	async renameAccount(accountId: string, label: string) {
		const a = this.data.accounts.find((x) => x.id === accountId);
		if (a && label.trim()) {
			a.label = label.trim().slice(0, 60);
			await this.deps.config.save();
			this.emit();
		}
	}

	// ---- settings ---------------------------------------------------------------

	async updateSettings(patch: Partial<Settings>) {
		const before = this.data.settings.refreshMinutes;
		this.data.settings = normalizeSettings({ ...this.data.settings, ...patch });
		await this.deps.config.save();
		if (this.data.settings.refreshMinutes !== before && this.timer) this.schedule();
		this.emit();
	}

	async setRing(slot: number, ref: RingRef | null) {
		if (slot < 0 || slot > 2) return;
		const s = this.data.settings;
		// Switching to custom starts from what auto mode currently shows.
		if (s.ringMode === "auto") {
			const current = resolveRings(s, this.data.accounts, this.data.usage).map((r) => r.ref);
			s.rings = [current[0] ?? null, current[1] ?? null, current[2] ?? null];
			s.ringMode = "custom";
		}
		s.rings[slot] = ref;
		await this.updateSettings({ rings: s.rings, ringMode: "custom" });
	}
}

export function accountIdFor(providerId: string, identity: string): string {
	// Short, stable, filesystem/keychain-safe id derived from the provider identity.
	const hash = new Bun.CryptoHasher("sha256").update(`${providerId}:${identity}`).digest("hex").slice(0, 12);
	return `${providerId}-${hash}`;
}
