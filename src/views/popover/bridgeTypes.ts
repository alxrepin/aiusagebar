import type { PopoverRPC } from "../../shared/rpc";
import type { AppState } from "../../shared/types";

type BunRequests = PopoverRPC["bun"]["requests"];
type BunMessages = PopoverRPC["bun"]["messages"];

/** What the UI needs from the host. Implemented by Electrobun RPC, or a mock for previews. */
export interface Bridge {
	request: { [K in keyof BunRequests]: (params: BunRequests[K]["params"]) => Promise<BunRequests[K]["response"]> };
	send: { [K in keyof BunMessages]: (payload: BunMessages[K]) => void };
	on(event: "events", handlers: { state: (s: AppState) => void; shown: () => void }): void;
}
