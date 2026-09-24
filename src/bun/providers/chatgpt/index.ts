import { join } from "node:path";
import type { LimitWindow } from "../../../shared/types";
import { createPkce, decodeJwt, postJson, randomToken, startLoopback } from "../../auth/oauth";
import {
	RateLimitedError,
	ReauthRequiredError,
	type AuthResult,
	type Credentials,
	type FetchResult,
	type ProviderContext,
	type UsageProvider,
} from "../types";

// Public OAuth client used by the Codex CLI ("Sign in with ChatGPT").
// Its registered redirect is http://localhost:1455/auth/callback, which we
// serve ourselves for the duration of the sign-in.
export const CHATGPT_OAUTH = {
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	issuer: "https://auth.openai.com",
	port: 1455,
	callbackPath: "/auth/callback",
	scopes: "openid profile email offline_access",
	usageUrl: "https://chatgpt.com/backend-api/wham/usage",
};

interface Tokens {
	idToken?: string;
	accessToken: string;
	refreshToken?: string;
	accountId?: string;
}

interface OAuthCreds extends Tokens {
	source: "oauth";
}

/** Linked to the Codex CLI login (~/.codex/auth.json); re-read every time, never rotated by us. */
interface CliCreds {
	source: "codex";
}

type ChatGptCreds = OAuthCreds | CliCreds;

interface RateWindow {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_after_seconds?: number;
	/** unix seconds */
	reset_at?: number;
}

export interface ChatGptUsageResponse {
	plan_type?: string;
	rate_limit?: {
		allowed?: boolean;
		limit_reached?: boolean;
		primary_window?: RateWindow | null;
		secondary_window?: RateWindow | null;
	} | null;
	[key: string]: unknown;
}

function describeWindow(seconds: number | undefined, fallback: "primary" | "secondary"): Pick<LimitWindow, "id" | "label" | "shortLabel" | "kind"> {
	if (seconds && seconds <= 24 * 3600) {
		const hours = Math.round(seconds / 3600);
		return { id: "session", label: `${hours}-hour session`, shortLabel: `${hours}h`, kind: "short" };
	}
	if (seconds && seconds >= 6 * 86400) {
		const days = Math.round(seconds / 86400);
		return days === 7
			? { id: "weekly", label: "Weekly", shortLabel: "7d", kind: "long" }
			: { id: `${days}d`, label: `${days}-day`, shortLabel: `${days}d`, kind: "long" };
	}
	return fallback === "primary"
		? { id: "session", label: "Session", shortLabel: "5h", kind: "short" }
		: { id: "weekly", label: "Weekly", shortLabel: "7d", kind: "long" };
}

export function parseChatGptUsage(json: ChatGptUsageResponse, now = Date.now()): LimitWindow[] {
	const out: LimitWindow[] = [];
	const rl = json.rate_limit;
	if (!rl) return out;
	for (const [key, which] of [
		["primary_window", "primary"],
		["secondary_window", "secondary"],
	] as const) {
		const w = rl[key];
		if (!w || typeof w.used_percent !== "number") continue;
		const resetsAt = w.reset_at
			? new Date(w.reset_at * 1000).toISOString()
			: typeof w.reset_after_seconds === "number"
				? new Date(now + w.reset_after_seconds * 1000).toISOString()
				: undefined;
		const desc = describeWindow(w.limit_window_seconds, which);
		// Avoid id clashes if both windows look alike.
		if (out.some((o) => o.id === desc.id)) desc.id = which;
		out.push({
			...desc,
			usedPercent: Math.max(0, Math.min(100, w.used_percent)),
			resetsAt,
			windowSeconds: w.limit_window_seconds,
		});
	}
	return out;
}

function planName(raw?: string): string | undefined {
	if (!raw) return undefined;
	const map: Record<string, string> = { plus: "Plus", pro: "Pro", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu", free: "Free" };
	return map[raw.toLowerCase()] ?? raw;
}

function claimsOf(idToken?: string) {
	const claims = idToken ? decodeJwt(idToken) : {};
	const auth = (claims["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
	return {
		email: typeof claims.email === "string" ? claims.email : undefined,
		accountId: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined,
		plan: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined,
	};
}

function isExpiringSoon(accessToken: string): boolean {
	const exp = decodeJwt(accessToken).exp;
	return typeof exp === "number" && exp * 1000 - 120_000 < Date.now();
}

export async function readCodexAuth(ctx: ProviderContext): Promise<Tokens | null> {
	const home = process.env.CODEX_HOME ?? join(ctx.homeDir, ".codex");
	const file = Bun.file(join(home, "auth.json"));
	if (!(await file.exists())) return null;
	try {
		const json = (await file.json()) as { tokens?: Record<string, string> | null };
		const t = json.tokens;
		if (!t?.access_token) return null;
		return {
			idToken: t.id_token,
			accessToken: t.access_token,
			refreshToken: t.refresh_token,
			accountId: t.account_id,
		};
	} catch {
		return null;
	}
}

export class ChatGptProvider implements UsageProvider {
	readonly id = "chatgpt";
	readonly displayName = "ChatGPT";
	// Hexagonal knot, monochrome.
	readonly iconPath =
		"M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3L12 2.6zm0 2.3L5.9 8.4v7.2l6.1 3.5 6.1-3.5V8.4L12 4.9zm0 3.2 3.4 2v3.9L12 16l-3.4-2v-3.9L12 8.1z";
	readonly authMethods = [
		{
			id: "oauth",
			label: "Sign in with ChatGPT",
			description: "Opens chatgpt.com in your browser. Tokens stay on this computer.",
			kind: "browser" as const,
		},
		{
			id: "codex",
			label: "Use Codex CLI login",
			description: "Reuses the existing `codex` CLI sign-in (~/.codex/auth.json).",
			kind: "instant" as const,
		},
	];

	async authenticate(methodId: string, ctx: ProviderContext): Promise<AuthResult> {
		if (methodId === "codex") {
			const tokens = await readCodexAuth(ctx);
			if (!tokens) throw new Error("No Codex CLI login found. Run `codex login` first, or use browser sign-in.");
			const c = claimsOf(tokens.idToken);
			return { credentials: { source: "codex" } satisfies CliCreds, label: c.email ?? "Codex CLI", identity: c.accountId ?? tokens.accountId };
		}
		if (methodId === "oauth") return this.oauth(ctx);
		throw new Error(`Unknown auth method ${methodId}`);
	}

	private async oauth(ctx: ProviderContext): Promise<AuthResult> {
		const pkce = await createPkce();
		const state = randomToken(24);
		let listener;
		try {
			listener = startLoopback({ port: CHATGPT_OAUTH.port, path: CHATGPT_OAUTH.callbackPath, state, signal: ctx.signal });
		} catch {
			throw new Error(`Port ${CHATGPT_OAUTH.port} is busy (is \`codex login\` running?). Close it and try again.`);
		}
		try {
			const url = new URL(`${CHATGPT_OAUTH.issuer}/oauth/authorize`);
			url.search = new URLSearchParams({
				response_type: "code",
				client_id: CHATGPT_OAUTH.clientId,
				redirect_uri: listener.redirectUri,
				scope: CHATGPT_OAUTH.scopes,
				code_challenge: pkce.challenge,
				code_challenge_method: "S256",
				id_token_add_organizations: "true",
				codex_cli_simplified_flow: "true",
				state,
				// Another ChatGPT account is connected: show the login screen so a different one can be picked.
				...(ctx.addingAnother ? { prompt: "login" } : {}),
			}).toString();
			ctx.openUrl(url.toString());

			const code = await listener.code;
			const token = await postJson<{ id_token?: string; access_token: string; refresh_token?: string }>(
				ctx.fetch,
				`${CHATGPT_OAUTH.issuer}/oauth/token`,
				{
					grant_type: "authorization_code",
					code,
					redirect_uri: listener.redirectUri,
					client_id: CHATGPT_OAUTH.clientId,
					code_verifier: pkce.verifier,
				},
				{ form: true, signal: ctx.signal },
			);
			const c = claimsOf(token.id_token);
			const creds: OAuthCreds = {
				source: "oauth",
				idToken: token.id_token,
				accessToken: token.access_token,
				refreshToken: token.refresh_token,
				accountId: c.accountId,
			};
			return { credentials: creds as unknown as Credentials, label: c.email ?? "ChatGPT", identity: c.accountId };
		} finally {
			listener.close();
		}
	}

	private async refresh(creds: OAuthCreds, ctx: ProviderContext): Promise<OAuthCreds> {
		if (!creds.refreshToken) throw new ReauthRequiredError("ChatGPT session expired. Please sign in again.");
		try {
			const token = await postJson<{ id_token?: string; access_token?: string; refresh_token?: string }>(
				ctx.fetch,
				`${CHATGPT_OAUTH.issuer}/oauth/token`,
				{
					client_id: CHATGPT_OAUTH.clientId,
					grant_type: "refresh_token",
					refresh_token: creds.refreshToken,
					scope: "openid profile email",
				},
				{ signal: ctx.signal },
			);
			return {
				...creds,
				idToken: token.id_token ?? creds.idToken,
				accessToken: token.access_token ?? creds.accessToken,
				refreshToken: token.refresh_token ?? creds.refreshToken,
			};
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 400 || status === 401) throw new ReauthRequiredError("ChatGPT session expired. Please sign in again.");
			throw err;
		}
	}

	async fetchUsage(raw: Credentials, ctx: ProviderContext): Promise<FetchResult> {
		const creds = raw as unknown as ChatGptCreds;
		let tokens: Tokens;
		let updated: OAuthCreds | undefined;

		if (creds.source === "codex") {
			const t = await readCodexAuth(ctx);
			if (!t) throw new ReauthRequiredError("Codex CLI login not found. Run `codex login` again.");
			tokens = t;
		} else {
			tokens = creds;
			if (isExpiringSoon(creds.accessToken)) {
				updated = await this.refresh(creds, ctx);
				tokens = updated;
			}
		}

		const request = (t: Tokens) => {
			const headers: Record<string, string> = {
				authorization: `Bearer ${t.accessToken}`,
				accept: "application/json",
				"user-agent": "AIUsageBar/0.1",
			};
			const accountId = t.accountId ?? claimsOf(t.idToken).accountId;
			if (accountId) headers["chatgpt-account-id"] = accountId;
			return ctx.fetch(CHATGPT_OAUTH.usageUrl, { headers, signal: ctx.signal });
		};

		let res = await request(tokens);
		if ((res.status === 401 || res.status === 403) && creds.source === "oauth") {
			updated = await this.refresh(updated ?? creds, ctx);
			res = await request(updated);
		}
		if (res.status === 401 || res.status === 403) {
			throw new ReauthRequiredError(
				creds.source === "codex"
					? "Codex CLI token expired. Run `codex` once to refresh it."
					: "ChatGPT session expired. Please sign in again.",
			);
		}
		if (res.status === 429) {
			throw new RateLimitedError("ChatGPT usage API is rate limiting", Number(res.headers.get("retry-after")) || undefined);
		}
		if (!res.ok) throw new Error(`ChatGPT usage API responded ${res.status}`);

		const json = (await res.json()) as ChatGptUsageResponse;
		return {
			usage: {
				plan: planName(json.plan_type ?? claimsOf(tokens.idToken).plan),
				windows: parseChatGptUsage(json),
			},
			credentials: updated as unknown as Credentials | undefined,
		};
	}
}
