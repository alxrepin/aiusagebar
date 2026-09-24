import { Electroview } from "electrobun/view";
import type { PopoverRPC } from "../../shared/rpc";
import type { Bridge } from "./bridgeTypes";

/** Real bridge: talks to the Bun process through Electrobun's encrypted RPC. */
export function createBridge(): Bridge {
	const handlers: Partial<Parameters<Bridge["on"]>[1]> = {};

	const rpc = Electroview.defineRPC<PopoverRPC>({
		maxRequestTime: 10 * 60_000,
		handlers: {
			requests: {},
			messages: {
				state: (s) => handlers.state?.(s),
				shown: () => handlers.shown?.(),
			},
		},
	});
	new Electroview({ rpc });

	return {
		request: rpc.request as Bridge["request"],
		send: rpc.send as Bridge["send"],
		on(_, h) {
			Object.assign(handlers, h);
		},
	};
}
