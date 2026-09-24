import { BrowserView, BrowserWindow, Screen, Utils } from "electrobun/bun";
import type { PopoverRPC } from "../../shared/rpc";
import type { AppState } from "../../shared/types";
import { isRu } from "../i18n";
import { openUrl } from "../system/openUrl";
import type { UpdateController } from "../update/updateController";
import { makeToolWindow, watchForeground } from "./winWindow";
import type { UsageService } from "../usage/service";
import { popoverPosition, type Rect } from "./position";

const WIDTH = 344;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 640;

/**
 * The window that drops down from the tray icon. Created once, kept hidden,
 * and shown/positioned on click. Hides itself when it loses focus, like a
 * native NSPopover / Windows flyout.
 */
export class Popover {
	private win: BrowserWindow;
	private visible = false;
	private hiddenAt = 0;
	private height = 420;
	private anchorTray: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private rpc;
	/** Windows: stops the foreground watcher that dismisses the popover. */
	private stopWatch: (() => void) | null = null;

	constructor(
		private platform: AppState["platform"],
		private service: UsageService,
		updates: UpdateController,
		private getTrayBounds: () => Rect,
	) {
		const svc = service;
		this.rpc = BrowserView.defineRPC<PopoverRPC>({
			// Browser sign-in can take a while; don't time the request out.
			maxRequestTime: 10 * 60_000,
			handlers: {
				requests: {
					getState: () => svc.getState(),
					refresh: async ({ accountId }) => {
						if (accountId) await svc.refreshAccount(accountId, { force: true });
						else await svc.refreshAll({ force: true });
						return svc.getState();
					},
					startAuth: async ({ providerId, methodId }) => {
						try {
							const account = await svc.startAuth(providerId, methodId);
							Utils.showNotification({ title: "AIUsageBar", body: `${isRu() ? "Подключено" : "Connected"}: ${account.label}` });
							return { ok: true as const };
						} catch (err) {
							return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
						}
					},
					cancelAuth: ({ providerId }) => svc.cancelAuth(providerId),
					removeAccount: async ({ accountId }) => {
						await svc.removeAccount(accountId);
						return svc.getState();
					},
					renameAccount: async ({ accountId, label }) => {
						await svc.renameAccount(accountId, label);
						return svc.getState();
					},
					updateSettings: async (patch) => {
						await svc.updateSettings(patch);
						return svc.getState();
					},
					setRing: async ({ slot, ref }) => {
						await svc.setRing(slot, ref);
						return svc.getState();
					},
					openUrl: ({ url }) => {
						if (/^https:\/\//.test(url)) openUrl(url);
					},
					checkForUpdates: async () => {
						await updates.check();
						return svc.getState();
					},
					installUpdate: async () => {
						await updates.install();
						return svc.getState();
					},
					quit: () => {
						svc.stop();
						updates.stop();
						Utils.quit();
					},
				},
				messages: {
					resize: ({ height }) => this.setHeight(height),
					hide: () => this.hide(),
				},
			},
		});

		this.win = new BrowserWindow({
			title: "AIUsageBar",
			url: "views://popover/index.html",
			frame: { x: 0, y: 0, width: WIDTH, height: this.height },
			titleBarStyle: "hidden",
			transparent: true,
			hidden: true,
			styleMask: {
				Borderless: true,
				Titled: false,
				Resizable: false,
				Miniaturizable: false,
				Closable: false,
			},
			rpc: this.rpc,
		});

		if (platform === "win") {
			// Electrobun ignores `hidden` on Windows and shows new windows right
			// away (it appeared in a screen corner on first launch). Hide it now,
			// and make it a tool window so it has no taskbar button.
			this.win.hide();
			makeToolWindow(this.win.ptr);
		} else {
			this.win.on("blur", () => {
				if (this.visible) this.hide();
			});
		}

		// Push every state change to the page while it's open.
		service.onChange((state) => {
			if (this.visible) this.rpc.send.state(state);
		});
	}

	toggle() {
		if (this.visible) return this.hide();
		// Clicking the tray icon while open first blurs the window (hiding it);
		// don't immediately reopen on the same click.
		if (Date.now() - this.hiddenAt < 300) return;
		this.show();
	}

	show() {
		this.anchorTray = this.getTrayBounds();
		this.place();
		this.visible = true;
		this.win.setAlwaysOnTop(true);
		this.win.show();
		this.win.focus();
		this.rpc.send.shown({});
		this.rpc.send.state(this.service.getState());
		void this.service.refreshIfStale();
		// Windows: close when the user switches to another app (see winWindow.ts).
		if (this.platform === "win") {
			this.stopWatch?.();
			this.stopWatch = watchForeground(() => this.hide());
		}
	}

	hide() {
		if (!this.visible) return;
		this.visible = false;
		this.hiddenAt = Date.now();
		this.stopWatch?.();
		this.stopWatch = null;
		this.win.hide();
	}

	private setHeight(h: number) {
		const height = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h)));
		if (height === this.height) return;
		this.height = height;
		if (this.visible) this.place();
		else this.win.setSize(WIDTH, height);
	}

	private place() {
		const cursor = Screen.getCursorScreenPoint();
		const displays = Screen.getAllDisplays();
		const probe = this.anchorTray.width ? this.anchorTray : { ...cursor, width: 1, height: 1 };
		const display =
			displays.find(
				(d) =>
					probe.x >= d.bounds.x &&
					probe.x < d.bounds.x + d.bounds.width &&
					probe.y >= d.bounds.y &&
					probe.y < d.bounds.y + d.bounds.height,
			) ?? Screen.getPrimaryDisplay();

		const { x, y } = popoverPosition({
			platform: this.platform,
			tray: this.anchorTray,
			cursor,
			display: display.bounds,
			workArea: display.workArea.width ? display.workArea : display.bounds,
			size: { width: WIDTH, height: this.height },
		});
		this.win.setFrame(x, y, WIDTH, this.height);
	}
}
