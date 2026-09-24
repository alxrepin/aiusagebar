import type { LimitWindow } from "../../../shared/types";
import { createPkce, postJson, randomToken, startLoopback } from "../../auth/oauth";
import { readClaudeCodeCredentials } from "./cliCredentials";
import {
	RateLimitedError,
	ReauthRequiredError,
	type AuthResult,
	type Credentials,
	type FetchResult,
	type ProviderContext,
	type UsageProvider,
} from "../types";

// Public OAuth client used by Claude Code. PKCE + loopback redirect means the
// whole flow runs between the user's browser and Anthropic, nothing in between.
export const CLAUDE_OAUTH = {
	clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	authorizeUrl: "https://claude.ai/oauth/authorize",
	tokenUrls: [
		"https://console.anthropic.com/v1/oauth/token",
		"https://platform.claude.com/v1/oauth/token",
	],
	scopes: "user:profile user:inference",
	usageUrl: "https://api.anthropic.com/api/oauth/usage",
	profileUrl: "https://api.anthropic.com/api/oauth/profile",
	betaHeader: "oauth-2025-04-20",
};

interface OAuthCreds {
	source: "oauth";
	accessToken: string;
	refreshToken?: string;
	/** epoch ms */
	expiresAt?: number;
	plan?: string;
}

/** Linked to the Claude Code CLI login: tokens are re-read on every refresh and never rotated by us. */
interface CliCreds {
	source: "claude-code";
	plan?: string;
}

type ClaudeCreds = OAuthCreds | CliCreds;

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	account?: { email_address?: string; uuid?: string };
	organization?: { uuid?: string; name?: string };
}

interface UsageBucket {
	utilization?: number | null;
	resets_at?: string | null;
}

export interface ClaudeUsageResponse {
	five_hour?: UsageBucket | null;
	seven_day?: UsageBucket | null;
	seven_day_opus?: UsageBucket | null;
	seven_day_sonnet?: UsageBucket | null;
	seven_day_oauth_apps?: UsageBucket | null;
	[key: string]: unknown;
}

const BUCKETS: Array<{
	key: keyof ClaudeUsageResponse;
	id: string;
	label: string;
	shortLabel: string;
	kind: LimitWindow["kind"];
	windowSeconds: number;
}> = [
	{ key: "five_hour", id: "session", label: "5-hour session", shortLabel: "5h", kind: "short", windowSeconds: 5 * 3600 },
	{ key: "seven_day", id: "weekly", label: "Weekly · all models", shortLabel: "7d", kind: "long", windowSeconds: 7 * 86400 },
	{ key: "seven_day_opus", id: "weekly-opus", label: "Weekly · Opus", shortLabel: "Opus", kind: "other", windowSeconds: 7 * 86400 },
	{ key: "seven_day_sonnet", id: "weekly-sonnet", label: "Weekly · Sonnet", shortLabel: "Son", kind: "other", windowSeconds: 7 * 86400 },
];

export function parseClaudeUsage(json: ClaudeUsageResponse): LimitWindow[] {
	const out: LimitWindow[] = [];
	for (const b of BUCKETS) {
		const bucket = json[b.key] as UsageBucket | null | undefined;
		if (!bucket || typeof bucket.utilization !== "number") continue;
		out.push({
			id: b.id,
			label: b.label,
			shortLabel: b.shortLabel,
			kind: b.kind,
			usedPercent: clampPercent(bucket.utilization),
			resetsAt: bucket.resets_at ?? undefined,
			windowSeconds: b.windowSeconds,
		});
	}
	return out;
}

const clampPercent = (n: number) => Math.max(0, Math.min(100, n));

function planName(raw?: string): string | undefined {
	if (!raw) return undefined;
	const map: Record<string, string> = {
		max: "Max",
		claude_max: "Max",
		pro: "Pro",
		claude_pro: "Pro",
		team: "Team",
		enterprise: "Enterprise",
		free: "Free",
	};
	return map[raw.toLowerCase()] ?? raw;
}

export class ClaudeProvider implements UsageProvider {
	readonly id = "claude";
	readonly displayName = "Claude";
	// Stylised asterisk / spark, monochrome.
	readonly iconPath =
		"M12 2.5l1.6 6.1 5.1-3.7-3.2 5.4 6 .7-6 1.9 4.2 4.6-5.7-2.3.4 6.3-2.4-5.8-2.4 5.8.4-6.3-5.7 2.3 4.2-4.6-6-1.9 6-.7-3.2-5.4 5.1 3.7z";
	readonly authMethods = [
		{
			id: "oauth",
			label: "Sign in with Claude",
			description: "Opens claude.ai in your browser. Tokens stay on this computer.",
			kind: "browser" as const,
		},
		{
			id: "claude-code",
			label: "Use Claude Code login",
			description: "Reuses the existing `claude` CLI sign-in on this computer.",
			kind: "instant" as const,
		},
	];

	async authenticate(methodId: string, ctx: ProviderContext): Promise<AuthResult> {
		if (methodId === "claude-code") return this.linkClaudeCode(ctx);
		if (methodId === "oauth") return this.oauth(ctx);
		throw new Error(`Unknown auth method ${methodId}`);
	}

	private async linkClaudeCode(ctx: ProviderContext): Promise<AuthResult> {
		const cli = await readClaudeCodeCredentials(ctx);
		if (!cli) {
			throw new Error("No Claude Code login found. Run `claude` and sign in first, or use browser sign-in.");
		}
		const plan = planName(cli.subscriptionType);
		const profile = await this.fetchProfile(cli.accessToken, ctx).catch(() => undefined);
		return {
			credentials: { source: "claude-code", plan: profile?.plan ?? plan } satisfies CliCreds,
			label: profile?.email ?? "Claude Code",
			identity: profile?.accountId,
		};
	}

	private async oauth(ctx: ProviderContext): Promise<AuthResult> {
		const pkce = await createPkce();
		const state = randomToken(24);
		const listener = startLoopback({ port: 0, path: "/callback", state, signal: ctx.signal });
		try {
			const url = new URL(CLAUDE_OAUTH.authorizeUrl);
			url.search = new URLSearchParams({
				code: "true",
				client_id: CLAUDE_OAUTH.clientId,
				response_type: "code",
				redirect_uri: listener.redirectUri,
				scope: CLAUDE_OAUTH.scopes,
				code_challenge: pkce.challenge,
				code_challenge_method: "S256",
				state,
			}).toString();
			ctx.openUrl(url.toString());

			const code = await listener.code;
			const token = await this.tokenRequest(ctx, {
				grant_type: "authorization_code",
				code,
				state,
				client_id: CLAUDE_OAUTH.clientId,
				redirect_uri: listener.redirectUri,
				code_verifier: pkce.verifier,
			});
			const creds = toOAuthCreds(token);
			const profile = await this.fetchProfile(creds.accessToken, ctx).catch(() => undefined);
			creds.plan = profile?.plan;
			return {
				credentials: creds as unknown as Credentials,
				label: token.account?.email_address ?? profile?.email ?? "Claude",
				identity: token.account?.uuid ?? profile?.accountId,
			};
		} finally {
			listener.close();
		}
	}

	private async tokenRequest(ctx: ProviderContext, body: Record<string, string>): Promise<TokenResponse> {
		let lastError: unknown;
		for (const url of CLAUDE_OAUTH.tokenUrls) {
			try {
				return await postJson<TokenResponse>(ctx.fetch, url, body, { signal: ctx.signal });
			} catch (err) {
				lastError = err;
				const status = (err as { status?: number }).status;
				// A definitive answer from the auth server; don't try the fallback host.
				if (status === 400 || status === 401 || status === 403) break;
			}
		}
		throw lastError;
	}

	private async fetchProfile(accessToken: string, ctx: ProviderContext) {
		const res = await ctx.fetch(CLAUDE_OAUTH.profileUrl, { headers: this.headers(accessToken), signal: ctx.signal });
		if (!res.ok) return undefined;
		const json = (await res.json()) as {
			account?: { email?: string; email_address?: string; uuid?: string; has_claude_max?: boolean; has_claude_pro?: boolean };
			organization?: { organization_type?: string };
		};
		const a = json.account ?? {};
		const plan = a.has_claude_max ? "Max" : a.has_claude_pro ? "Pro" : planName(json.organization?.organization_type);
		return { email: a.email ?? a.email_address, accountId: a.uuid, plan };
	}

	private headers(accessToken: string): Record<string, string> {
		return {
			authorization: `Bearer ${accessToken}`,
			"anthropic-beta": CLAUDE_OAUTH.betaHeader,
			accept: "application/json",
			"user-agent": "AIUsageBar/0.1",
		};
	}

	async fetchUsage(raw: Credentials, ctx: ProviderContext): Promise<FetchResult> {
		const creds = raw as unknown as ClaudeCreds;
		let accessToken: string;
		let updated: OAuthCreds | undefined;
		let plan = creds.plan;

		if (creds.source === "claude-code") {
			const cli = await readClaudeCodeCredentials(ctx);
			if (!cli) throw new ReauthRequiredError("Claude Code login not found. Run `claude` to sign in again.");
			if (cli.expiresAt !== undefined && cli.expiresAt < Date.now()) {
				throw new ReauthRequiredError("Claude Code token expired. Run `claude` once to refresh it.");
			}
			accessToken = cli.accessToken;
			plan = plan ?? planName(cli.subscriptionType);
		} else {
			updated = await this.ensureFresh(creds, ctx);
			accessToken = updated.accessToken;
		}

		let res = await ctx.fetch(CLAUDE_OAUTH.usageUrl, { headers: this.headers(accessToken), signal: ctx.signal });

		if ((res.status === 401 || res.status === 403) && creds.source === "oauth") {
			updated = await this.refresh(updated ?? creds, ctx);
			res = await ctx.fetch(CLAUDE_OAUTH.usageUrl, { headers: this.headers(updated.accessToken), signal: ctx.signal });
		}
		if (res.status === 401 || res.status === 403) {
			throw new ReauthRequiredError("Claude session expired. Please sign in again.");
		}
		if (res.status === 429) {
			throw new RateLimitedError("Claude usage API is rate limiting", Number(res.headers.get("retry-after")) || undefined);
		}
		if (!res.ok) throw new Error(`Claude usage API responded ${res.status}`);

		const json = (await res.json()) as ClaudeUsageResponse;
		return {
			usage: { plan, windows: parseClaudeUsage(json) },
			credentials: updated && updated !== creds ? (updated as unknown as Credentials) : undefined,
		};
	}

	private async ensureFresh(creds: OAuthCreds, ctx: ProviderContext): Promise<OAuthCreds> {
		if (creds.expiresAt !== undefined && creds.expiresAt - 60_000 < Date.now() && creds.refreshToken) {
			return this.refresh(creds, ctx);
		}
		return creds;
	}

	private async refresh(creds: OAuthCreds, ctx: ProviderContext): Promise<OAuthCreds> {
		if (!creds.refreshToken) throw new ReauthRequiredError("Claude session expired. Please sign in again.");
		try {
			const token = await this.tokenRequest(ctx, {
				grant_type: "refresh_token",
				refresh_token: creds.refreshToken,
				client_id: CLAUDE_OAUTH.clientId,
			});
			return { ...toOAuthCreds(token), refreshToken: token.refresh_token ?? creds.refreshToken, plan: creds.plan };
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 400 || status === 401) throw new ReauthRequiredError("Claude session expired. Please sign in again.");
			throw err;
		}
	}
}

function toOAuthCreds(token: TokenResponse): OAuthCreds {
	return {
		source: "oauth",
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
	};
}
