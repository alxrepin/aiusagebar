// Types shared between the Bun process and the popover webview.
// Keep this file free of runtime imports so both sides can use it.

/**
 * How long a limit window is. Used to pick sensible defaults for the rings:
 * "short" is the rolling session / "daily" limit (Claude 5h, ChatGPT 5h),
 * "long" is the weekly limit, "other" is everything else (per-model caps,
 * credits, …).
 */
export type WindowKind = "short" | "long" | "other";

export interface LimitWindow {
	/** Stable id inside a provider, e.g. "session", "weekly", "weekly-opus". */
	id: string;
	/** Human readable label, e.g. "5-hour session". */
	label: string;
	/** Short label used under the rings, e.g. "5h". */
	shortLabel: string;
	kind: WindowKind;
	/** 0..100, how much of the limit is spent. */
	usedPercent: number;
	/** ISO date of the next reset, if the provider reports it. */
	resetsAt?: string;
	/** Length of the window in seconds, if known. */
	windowSeconds?: number;
}

export interface UsageSnapshot {
	accountId: string;
	fetchedAt: string;
	/** Plan name as reported by the provider, e.g. "Max 5x", "Plus". */
	plan?: string;
	windows: LimitWindow[];
}

export type AccountStatus =
	| { state: "idle" }
	| { state: "loading" }
	| { state: "ok" }
	| { state: "error"; message: string; needsReauth?: boolean };

export interface AccountInfo {
	id: string;
	providerId: string;
	/** What the user sees: email or a custom name. */
	label: string;
	/** How the account was connected, e.g. "oauth" or "cli-import". */
	authMethod: string;
	addedAt: string;
}

export interface AuthMethodInfo {
	id: string;
	label: string;
	description: string;
	/**
	 * "browser"  - opens the system browser and waits for a local callback.
	 * "instant"  - completes without interaction (e.g. reads an existing CLI login).
	 */
	kind: "browser" | "instant";
}

export interface ProviderInfo {
	id: string;
	displayName: string;
	/** Monochrome SVG path data (24x24 viewBox) used as the provider glyph. */
	iconPath: string;
	authMethods: AuthMethodInfo[];
}

/** A reference to one metric that can be put into a ring. */
export interface RingRef {
	accountId: string;
	windowId: string;
}

export type RingMode = "auto" | "custom";

export type IconTheme = "auto" | "light" | "dark";

export interface Settings {
	/** Background refresh interval in minutes. */
	refreshMinutes: number;
	ringMode: RingMode;
	/** Up to 3 slots, outermost first. null = empty slot. Used in "custom" mode. */
	rings: (RingRef | null)[];
	/** Tray icon colour on Windows/Linux (macOS uses a template image). */
	iconTheme: IconTheme;
	/** Show a percentage next to the icon (macOS menu bar only). */
	showPercentInMenuBar: boolean;
	/** Send a system notification when a limit runs low. */
	alertsEnabled: boolean;
	/** Notify when less than this share (percent) of a limit is left. */
	alertThreshold: number;
	/** Start AIUsageBar when the user logs in. */
	launchAtLogin: boolean;
}

/** A ring after resolution: what is actually drawn. */
export interface ResolvedRing {
	ref: RingRef;
	providerId: string;
	accountLabel: string;
	windowLabel: string;
	shortLabel: string;
	/** 0..1, or null when there is no data yet. */
	progress: number | null;
	resetsAt?: string;
}

export interface UpdateState {
	/** Version of the running app. */
	currentVersion: string;
	status: "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error";
	/** Version offered by the update feed, when one is available. */
	availableVersion?: string;
	error?: string;
	checkedAt?: string;
}

export interface AppState {
	platform: "mac" | "win" | "linux";
	providers: ProviderInfo[];
	accounts: AccountInfo[];
	usage: Record<string, UsageSnapshot | undefined>;
	status: Record<string, AccountStatus>;
	rings: ResolvedRing[];
	settings: Settings;
	/** Ids of auth flows currently waiting for the browser, keyed by provider. */
	pendingAuth: Record<string, string | undefined>;
	lastRefreshAt?: string;
	update: UpdateState;
}
