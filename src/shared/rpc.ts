import type { RPCSchema } from "electrobun/bun";
import type { AppState, RingRef, Settings } from "./types";

/**
 * RPC contract between the Bun process ("bun") and the popover webview ("webview").
 * `requests` are handled by the side that owns the schema; `messages` are
 * fire-and-forget notifications received by that side.
 */
export type PopoverRPC = {
	bun: RPCSchema<{
		requests: {
			getState: { params: {}; response: AppState };
			refresh: { params: { accountId?: string }; response: AppState };
			startAuth: {
				params: { providerId: string; methodId: string };
				response: { ok: true } | { ok: false; error: string };
			};
			cancelAuth: { params: { providerId: string }; response: void };
			removeAccount: { params: { accountId: string }; response: AppState };
			renameAccount: {
				params: { accountId: string; label: string };
				response: AppState;
			};
			updateSettings: { params: Partial<Settings>; response: AppState };
			setRing: {
				params: { slot: number; ref: RingRef | null };
				response: AppState;
			};
			openUrl: { params: { url: string }; response: void };
			checkForUpdates: { params: {}; response: AppState };
			installUpdate: { params: {}; response: AppState };
			quit: { params: {}; response: void };
		};
		messages: {
			/** The page asks for a new height so the window fits its content. */
			resize: { height: number };
			/** Esc pressed or a link opened: hide the popover. */
			hide: {};
			/** Keeps the page's RPC socket from idling out; no-op. */
			keepalive: {};
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			state: AppState;
			/** Sent every time the popover is shown so the page can reset its view. */
			shown: {};
		};
	}>;
};
