// Serverless OAuth helpers: PKCE + a one-shot loopback HTTP listener.
// The browser redirects to http://localhost:<port>/<path> on the user's own
// machine, so no backend of ours is ever involved.

export interface Pkce {
	verifier: string;
	challenge: string;
}

export function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function createPkce(): Promise<Pkce> {
	const verifier = randomToken(32);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** Decodes a JWT payload without verifying it (we only read display claims). */
export function decodeJwt(token: string): Record<string, unknown> {
	const part = token.split(".")[1];
	if (!part) return {};
	try {
		return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
	} catch {
		return {};
	}
}

export interface LoopbackOptions {
	/** 0 = pick a free port. */
	port: number;
	path: string;
	/** Expected `state`; mismatches are rejected. */
	state: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface LoopbackListener {
	port: number;
	redirectUri: string;
	/** Resolves with the authorization code. */
	code: Promise<string>;
	close(): void;
}

const page = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root{color-scheme:light dark}
  body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;
       display:grid;place-items:center;height:100vh;margin:0;background:Canvas;color:CanvasText}
  main{text-align:center;max-width:360px}
  svg{width:56px;height:56px;margin-bottom:12px}
  p{opacity:.65}
</style></head>
<body><main>
<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">
  <circle cx="28" cy="28" r="24" opacity=".2"/><path d="M28 4a24 24 0 1 1-20.8 36"/>
  <circle cx="28" cy="28" r="14" opacity=".2"/><path d="M28 14a14 14 0 1 1-14 14"/>
</svg>
<h2>${title}</h2><p>${body}</p></main></body></html>`;

/** Starts a local HTTP server that captures a single OAuth redirect. */
export function startLoopback(opts: LoopbackOptions): LoopbackListener {
	let resolveCode!: (code: string) => void;
	let rejectCode!: (err: Error) => void;
	const code = new Promise<string>((res, rej) => {
		resolveCode = res;
		rejectCode = rej;
	});

	let settled = false;
	const finish = (fn: () => void) => {
		if (settled) return;
		settled = true;
		fn();
		// Let the success page flush before shutting the listener down.
		setTimeout(() => server.stop(true), 500);
		clearTimeout(timer);
	};

	const server = Bun.serve({
		port: opts.port,
		hostname: "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname !== opts.path) return new Response("Not found", { status: 404 });

			const html = (title: string, body: string, status = 200) =>
				new Response(page(title, body), {
					status,
					headers: { "content-type": "text/html; charset=utf-8" },
				});

			const error = url.searchParams.get("error");
			if (error) {
				const desc = url.searchParams.get("error_description") ?? error;
				finish(() => rejectCode(new Error(desc)));
				return html("Sign-in failed", escapeHtml(desc), 400);
			}
			if (url.searchParams.get("state") !== opts.state) {
				return html("Sign-in failed", "State mismatch. Please try again from AIUsageBar.", 400);
			}
			const value = url.searchParams.get("code");
			if (!value) return html("Sign-in failed", "No authorization code received.", 400);

			finish(() => resolveCode(value));
			return html("You're connected", "AIUsageBar can now show your limits. You can close this tab.");
		},
	});

	const timer = setTimeout(
		() => finish(() => rejectCode(new Error("Sign-in timed out"))),
		opts.timeoutMs ?? 5 * 60_000,
	);

	opts.signal?.addEventListener("abort", () => finish(() => rejectCode(new Error("Sign-in cancelled"))), {
		once: true,
	});

	const port = server.port ?? opts.port;
	return {
		port,
		redirectUri: `http://localhost:${port}${opts.path}`,
		code,
		close: () => finish(() => rejectCode(new Error("Sign-in cancelled"))),
	};
}

function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Small helper: POST and parse JSON, with a readable error on failure. */
export async function postJson<T>(
	f: typeof fetch,
	url: string,
	body: Record<string, string>,
	opts: { form?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
	const res = await f(url, {
		method: "POST",
		headers: {
			"content-type": opts.form ? "application/x-www-form-urlencoded" : "application/json",
			accept: "application/json",
		},
		body: opts.form ? new URLSearchParams(body).toString() : JSON.stringify(body),
		signal: opts.signal,
	});
	const text = await res.text();
	if (!res.ok) {
		const err = new Error(`${new URL(url).host} responded ${res.status}: ${text.slice(0, 200)}`);
		(err as Error & { status?: number }).status = res.status;
		throw err;
	}
	return JSON.parse(text) as T;
}
