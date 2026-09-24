import { Electroview } from "electrobun/view";
import type { PopoverRPC } from "../../shared/rpc";
import type { Bridge } from "./bridgeTypes";

/** The parts of Electroview's (untyped) transport we lean on. */
type SocketView = {
	bunSocket?: WebSocket;
	initSocketToBun(): void;
	bunBridge(msg: string): Promise<void>;
};

const OPEN = 1;
const CONNECTING = 0;

/**
 * Electroview sends to Bun over a local WebSocket and falls back to a native
 * bridge when the socket isn't open. On Windows that fallback drops messages
 * (clicks on Quit / Check for updates / settings did nothing), and the socket
 * isn't open yet at page load or after it was closed while the popover sat
 * hidden. So: (re)connect and wait for the socket before every send.
 */
function ensureSocket(view: SocketView, timeoutMs = 3000): Promise<void> {
	if (!(window as { __electrobunRpcSocketPort?: number }).__electrobunRpcSocketPort) return Promise.resolve();
	if (view.bunSocket?.readyState === OPEN) return Promise.resolve();
	if (view.bunSocket?.readyState !== CONNECTING) {
		try {
			view.initSocketToBun();
		} catch {
			return Promise.resolve();
		}
	}
	const socket = view.bunSocket;
	if (!socket) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(done, timeoutMs);
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", done, { once: true });
		socket.addEventListener("close", done, { once: true });
	});
}

/** Real bridge: talks to the Bun process through Electrobun's encrypted RPC. */
export function createBridge(): Bridge {
	const handlers: Partial<Parameters<Bridge["on"]>[1]> = {};

	const rpc = Electroview.defineRPC<PopoverRPC>({
		maxRequestTime: 10 * 60_000,
		handlers: {
			requests: {},
			messages: {
				state: (s) => handlers.state?.(s),
				shown: () => {
					void ensureSocket(view);
					handlers.shown?.();
				},
			},
		},
	});
	const view = new Electroview({ rpc }) as unknown as SocketView;

	// Serialise sends so messages keep their order while we wait for the socket.
	const send = view.bunBridge.bind(view);
	let queue = Promise.resolve();
	view.bunBridge = (msg: string) => {
		queue = queue.then(() => ensureSocket(view)).then(() => send(msg)).catch(() => {});
		return queue;
	};

	// Keep the socket from idling out while the popover is hidden.
	setInterval(() => {
		if (view.bunSocket?.readyState === OPEN) rpc.send.keepalive({});
	}, 4 * 60_000);

	return {
		request: rpc.request as Bridge["request"],
		send: rpc.send as Bridge["send"],
		on(_, h) {
			Object.assign(handlers, h);
		},
	};
}
