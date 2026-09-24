import type { ProviderInfo } from "../../shared/types";
import { ChatGptProvider } from "./chatgpt";
import { ClaudeProvider } from "./claude";
import type { UsageProvider } from "./types";

/**
 * All known providers. Adding a provider = implementing `UsageProvider`
 * and appending an instance here; nothing else needs to change.
 */
const providers: UsageProvider[] = [new ClaudeProvider(), new ChatGptProvider()];

const byId = new Map(providers.map((p) => [p.id, p]));

export function getProvider(id: string): UsageProvider | undefined {
	return byId.get(id);
}

export function listProviders(): ProviderInfo[] {
	return providers.map((p) => ({
		id: p.id,
		displayName: p.displayName,
		iconPath: p.iconPath,
		authMethods: p.authMethods,
	}));
}

/** For tests / plugins. */
export function registerProvider(p: UsageProvider) {
	if (byId.has(p.id)) throw new Error(`Provider ${p.id} already registered`);
	providers.push(p);
	byId.set(p.id, p);
}
