import type { AuthMethodInfo, UsageSnapshot } from "../../shared/types";

/**
 * Opaque, provider-specific credentials. Stored as JSON in the OS secret
 * store (Keychain / DPAPI / libsecret), never in the plain settings file.
 */
export type Credentials = Record<string, unknown>;

/** Everything a provider needs from the host app. Keeps providers free of Electrobun imports. */
export interface ProviderContext {
	/** Open a URL in the user's default browser. */
	openUrl(url: string): void;
	/** Fetch implementation (injectable for tests). */
	fetch: typeof fetch;
	/** Aborted when the user cancels a sign-in or removes the account. */
	signal?: AbortSignal;
	/** Home directory; used to find CLI credential files. */
	homeDir: string;
	platform: NodeJS.Platform;
	/**
	 * True when an account of this provider is already connected. Providers
	 * should then ask the identity provider to show its login / account picker
	 * instead of silently reusing the browser session.
	 */
	addingAnother?: boolean;
}

export interface AuthResult {
	credentials: Credentials;
	/** Suggested account label, e.g. the e-mail from the id token. */
	label: string;
	/** Stable identity used to detect duplicates, e.g. the provider account id. */
	identity?: string;
}

export interface FetchResult {
	usage: Omit<UsageSnapshot, "accountId" | "fetchedAt">;
	/** New credentials to persist, e.g. after a token refresh. */
	credentials?: Credentials;
}

/** Thrown when the stored credentials can no longer be used and the user must sign in again. */
export class ReauthRequiredError extends Error {
	readonly needsReauth = true;
	constructor(message: string) {
		super(message);
		this.name = "ReauthRequiredError";
	}
}

/** Thrown on HTTP 429 so the scheduler can back off. */
export class RateLimitedError extends Error {
	constructor(
		message: string,
		readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "RateLimitedError";
	}
}

/**
 * A usage provider. To add a new one (Gemini, Cursor, Copilot, …):
 *   1. implement this interface in `src/bun/providers/<id>/index.ts`,
 *   2. register it in `src/bun/providers/registry.ts`.
 * The UI, the rings and the scheduler pick it up automatically.
 */
export interface UsageProvider {
	readonly id: string;
	readonly displayName: string;
	/** SVG path (24x24 viewBox), drawn monochrome. */
	readonly iconPath: string;
	readonly authMethods: AuthMethodInfo[];

	/** Run an auth method and return credentials. Must honour ctx.signal. */
	authenticate(methodId: string, ctx: ProviderContext): Promise<AuthResult>;

	/** Load current limits. May refresh tokens and return the new credentials. */
	fetchUsage(credentials: Credentials, ctx: ProviderContext): Promise<FetchResult>;
}
