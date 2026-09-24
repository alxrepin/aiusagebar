import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPkce, startLoopback } from "../src/bun/auth/oauth";
import { ChatGptProvider } from "../src/bun/providers/chatgpt";
import { ClaudeProvider } from "../src/bun/providers/claude";
import { ReauthRequiredError, type ProviderContext } from "../src/bun/providers/types";

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

function ctx(fetchImpl: (url: string, init?: RequestInit) => Response | Promise<Response>, extra: Partial<ProviderContext> = {}): ProviderContext {
	return {
		openUrl() {},
		fetch: ((url: string, init?: RequestInit) => Promise.resolve(fetchImpl(String(url), init))) as unknown as typeof fetch,
		homeDir: mkdtempSync(join(tmpdir(), "aiub-home-")),
		platform: "linux",
		...extra,
	};
}

describe("PKCE + loopback", () => {
	test("challenge is base64url sha256 of verifier", async () => {
		const { verifier, challenge } = await createPkce();
		const digest = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
		expect(challenge).toBe(digest);
	});

	test("loopback resolves the code and rejects bad state", async () => {
		const l = startLoopback({ port: 0, path: "/cb", state: "s1" });
		const bad = await fetch(`http://127.0.0.1:${l.port}/cb?code=x&state=nope`);
		expect(bad.status).toBe(400);
		const ok = await fetch(`http://127.0.0.1:${l.port}/cb?code=abc&state=s1`);
		expect(ok.status).toBe(200);
		expect(await l.code).toBe("abc");
	});

	test("loopback rejects when aborted", async () => {
		const ac = new AbortController();
		const l = startLoopback({ port: 0, path: "/cb", state: "s", signal: ac.signal });
		ac.abort();
		await expect(l.code).rejects.toThrow("cancelled");
	});
});

describe("ChatGPT provider", () => {
	test("full browser flow: authorize → callback → token exchange", async () => {
		const p = new ChatGptProvider();
		let opened = "";
		const c = ctx(
			(url, init) => {
				expect(url).toBe("https://auth.openai.com/oauth/token");
				const body = new URLSearchParams(String(init?.body));
				expect(body.get("grant_type")).toBe("authorization_code");
				expect(body.get("code")).toBe("the-code");
				expect(body.get("code_verifier")).toBeTruthy();
				return Response.json({
					access_token: "at",
					refresh_token: "rt",
					id_token: jwt({ email: "me@x.io", "https://api.openai.com/auth": { chatgpt_account_id: "acc-1" } }),
				});
			},
			{
				openUrl: (u) => {
					opened = u;
					const url = new URL(u);
					const redirect = url.searchParams.get("redirect_uri")!;
					const state = url.searchParams.get("state")!;
					setTimeout(() => fetch(`${redirect.replace("localhost", "127.0.0.1")}?code=the-code&state=${state}`), 10);
				},
			},
		);
		const res = await p.authenticate("oauth", c);
		expect(new URL(opened).origin).toBe("https://auth.openai.com");
		expect(res.label).toBe("me@x.io");
		expect(res.identity).toBe("acc-1");
		expect(res.credentials).toMatchObject({ source: "oauth", accessToken: "at", refreshToken: "rt", accountId: "acc-1" });
	});

	test("refreshes on 401 and returns rotated credentials", async () => {
		const p = new ChatGptProvider();
		let usageCalls = 0;
		const c = ctx((url, init) => {
			if (url.endsWith("/oauth/token")) {
				expect(JSON.parse(String(init?.body)).grant_type).toBe("refresh_token");
				return Response.json({ access_token: "fresh", refresh_token: "rt2" });
			}
			usageCalls++;
			const auth = new Headers(init?.headers).get("authorization");
			if (auth !== "Bearer fresh") return new Response("", { status: 401 });
			expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe("acc-1");
			return Response.json({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000 } } });
		});
		const r = await p.fetchUsage({ source: "oauth", accessToken: "stale", refreshToken: "rt", accountId: "acc-1" }, c);
		expect(usageCalls).toBe(2);
		expect(r.usage.plan).toBe("Pro");
		expect(r.credentials).toMatchObject({ accessToken: "fresh", refreshToken: "rt2" });
	});

	test("403 also triggers a token refresh before giving up", async () => {
		const p = new ChatGptProvider();
		const c = ctx((url, init) => {
			if (url.endsWith("/oauth/token")) return Response.json({ access_token: "fresh" });
			return new Headers(init?.headers).get("authorization") === "Bearer fresh"
				? Response.json({ rate_limit: {} })
				: new Response("", { status: 403 });
		});
		const r = await p.fetchUsage({ source: "oauth", accessToken: "stale", refreshToken: "rt" }, c);
		expect(r.credentials).toMatchObject({ accessToken: "fresh" });
	});

	test("adding a second account forces the login screen", async () => {
		await Bun.sleep(700); // let the previous test release port 1455
		const p = new ChatGptProvider();
		let opened = "";
		const ac = new AbortController();
		const c = ctx(() => new Response("", { status: 500 }), {
			addingAnother: true,
			signal: ac.signal,
			openUrl: (u) => {
				opened = u;
				ac.abort();
			},
		});
		await expect(p.authenticate("oauth", c)).rejects.toThrow();
		expect(new URL(opened).searchParams.get("prompt")).toBe("login");
	});

	test("linked Codex login is read from ~/.codex/auth.json", async () => {
		const p = new ChatGptProvider();
		const c = ctx((_, init) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer codex-at");
			return Response.json({ rate_limit: { secondary_window: { used_percent: 50, limit_window_seconds: 604800 } } });
		});
		const prev = process.env.CODEX_HOME;
		delete process.env.CODEX_HOME;
		mkdirSync(join(c.homeDir, ".codex"));
		writeFileSync(join(c.homeDir, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "codex-at", account_id: "a" } }));
		const r = await p.fetchUsage({ source: "codex" }, c);
		if (prev) process.env.CODEX_HOME = prev;
		expect(r.usage.windows[0]).toMatchObject({ id: "weekly", usedPercent: 50 });
		expect(r.credentials).toBeUndefined();
	});
});

describe("Claude provider", () => {
	test("sends the OAuth beta header and parses usage", async () => {
		const p = new ClaudeProvider();
		const c = ctx((url, init) => {
			expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
			const h = new Headers(init?.headers);
			expect(h.get("authorization")).toBe("Bearer at");
			expect(h.get("anthropic-beta")).toBe("oauth-2025-04-20");
			return Response.json({ five_hour: { utilization: 20, resets_at: "2026-09-24T12:00:00Z" }, seven_day: { utilization: 60 } });
		});
		const r = await p.fetchUsage({ source: "oauth", accessToken: "at", expiresAt: Date.now() + 3600_000, plan: "Max" }, c);
		expect(r.usage.plan).toBe("Max");
		expect(r.usage.windows.map((w) => w.usedPercent)).toEqual([20, 60]);
	});

	test("refreshes an expired token before calling the API", async () => {
		const p = new ClaudeProvider();
		const c = ctx((url, init) => {
			if (url.endsWith("/v1/oauth/token")) {
				expect(JSON.parse(String(init?.body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt" });
				return Response.json({ access_token: "new", refresh_token: "rt2", expires_in: 3600 });
			}
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer new");
			return Response.json({ five_hour: { utilization: 1 } });
		});
		const r = await p.fetchUsage({ source: "oauth", accessToken: "old", refreshToken: "rt", expiresAt: Date.now() - 1 }, c);
		expect(r.credentials).toMatchObject({ accessToken: "new", refreshToken: "rt2" });
	});

	test("a rejected refresh asks the user to sign in again", async () => {
		const p = new ClaudeProvider();
		const c = ctx(() => new Response("invalid_grant", { status: 400 }));
		await expect(p.fetchUsage({ source: "oauth", accessToken: "old", refreshToken: "rt", expiresAt: 0 }, c)).rejects.toBeInstanceOf(
			ReauthRequiredError,
		);
	});
});
