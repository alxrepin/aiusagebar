import { join } from "node:path";
import type { ProviderContext } from "../types";

export interface ClaudeCodeCredentials {
	accessToken: string;
	refreshToken?: string;
	/** epoch ms */
	expiresAt?: number;
	subscriptionType?: string;
}

/**
 * Reads the Claude Code CLI login. On macOS it lives in the login Keychain
 * ("Claude Code-credentials"); elsewhere in ~/.claude/.credentials.json.
 * We only ever read it — never rotate or write it — so the CLI keeps working.
 */
export async function readClaudeCodeCredentials(ctx: ProviderContext): Promise<ClaudeCodeCredentials | null> {
	const candidates: Array<() => Promise<string | null>> = [];

	if (ctx.platform === "darwin") {
		candidates.push(async () => {
			const proc = Bun.spawn(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], {
				stdout: "pipe",
				stderr: "ignore",
			});
			const out = await new Response(proc.stdout).text();
			return (await proc.exited) === 0 ? out.trim() : null;
		});
	}

	const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(ctx.homeDir, ".claude");
	candidates.push(async () => {
		const file = Bun.file(join(configDir, ".credentials.json"));
		return (await file.exists()) ? file.text() : null;
	});

	for (const read of candidates) {
		try {
			const text = await read();
			const parsed = text ? parseClaudeCodeCredentials(text) : null;
			if (parsed) return parsed;
		} catch {
			// try the next location
		}
	}
	return null;
}

export function parseClaudeCodeCredentials(text: string): ClaudeCodeCredentials | null {
	const json = JSON.parse(text) as { claudeAiOauth?: Record<string, unknown> };
	const o = json.claudeAiOauth;
	if (!o || typeof o.accessToken !== "string") return null;
	return {
		accessToken: o.accessToken,
		refreshToken: typeof o.refreshToken === "string" ? o.refreshToken : undefined,
		expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : undefined,
		subscriptionType: typeof o.subscriptionType === "string" ? o.subscriptionType : undefined,
	};
}
