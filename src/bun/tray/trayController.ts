import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Tray } from "electrobun/bun";
import type { AppState, IconTheme } from "../../shared/types";
import { setStatusItemTemplateImage } from "./macStatusImage";
import { renderRingsPng } from "./ringsIcon";

type Platform = AppState["platform"];

/** Logical tray icon size per platform (points / DIPs). Rendered at 2x. */
const LOGICAL_SIZE: Record<Platform, number> = { mac: 18, win: 16, linux: 22 };

/**
 * Owns the tray icon: re-renders the rings PNG whenever usage changes.
 * macOS gets a template image (black + alpha) so it follows the menu bar
 * appearance automatically; Windows/Linux pick black or white ink.
 */
export class TrayController {
	readonly tray: Tray;
	private flip = false;
	private lastKey = "";
	private systemLight: { value: boolean; at: number } | null = null;

	constructor(
		private platform: Platform,
		private cacheDir: string,
	) {
		const size = LOGICAL_SIZE[platform];
		// Create the tray with a real image: Electrobun applies `template` and the
		// point size only at creation time.
		mkdirSync(cacheDir, { recursive: true });
		const initial = join(cacheDir, "tray-initial.png");
		writeFileSync(initial, this.render([], platform === "mac" ? [0, 0, 0] : [255, 255, 255]));
		this.tray = new Tray({ title: "", image: initial, template: platform === "mac", width: size, height: size });
	}

	private render(progress: (number | null)[], color: [number, number, number]) {
		return renderRingsPng({
			size: LOGICAL_SIZE[this.platform] * 2,
			progress,
			color,
			weight: "thin",
			trackAlpha: 0.32,
			// @2x: tells macOS the image is LOGICAL_SIZE points, not pixels.
			dpi: 144,
		});
	}

	async update(state: AppState) {
		const progress = state.rings.map((r) => r.progress);
		const ink = await this.inkColor(state.settings.iconTheme);
		const key = JSON.stringify([progress.map((p) => (p === null ? null : Math.round(p * 100))), ink]);

		if (key !== this.lastKey) {
			this.lastKey = key;
			await mkdir(this.cacheDir, { recursive: true });
			// Alternate file names: some platforms cache images by path.
			this.flip = !this.flip;
			const file = join(this.cacheDir, `tray-${this.flip ? "a" : "b"}.png`);
			await Bun.write(file, this.render(progress, ink));
			const size = LOGICAL_SIZE[this.platform];
			// macOS: Tray.setImage() would drop the template flag and size, so set it natively.
			const done = this.platform === "mac" && setStatusItemTemplateImage(this.tray.ptr, file, size, size);
			if (!done) this.tray.setImage(file);
			await rm(join(this.cacheDir, `tray-${this.flip ? "b" : "a"}.png`), { force: true });
		}

		if (this.platform === "mac") {
			const first = state.rings[0];
			const title =
				state.settings.showPercentInMenuBar && first?.progress != null ? ` ${Math.round(first.progress * 100)}%` : "";
			this.tray.setTitle(title);
		}
	}

	private async inkColor(theme: IconTheme): Promise<[number, number, number]> {
		const BLACK: [number, number, number] = [0, 0, 0];
		const WHITE: [number, number, number] = [255, 255, 255];
		if (this.platform === "mac") return BLACK; // template image, recoloured by macOS
		if (theme === "light") return WHITE; // light ink for dark taskbars
		if (theme === "dark") return BLACK;
		return (await this.isSystemLightTheme()) ? BLACK : WHITE;
	}

	/** Windows: reads SystemUsesLightTheme (taskbar colour). Linux panels default to dark. */
	private async isSystemLightTheme(): Promise<boolean> {
		if (this.platform !== "win") return false;
		if (this.systemLight && Date.now() - this.systemLight.at < 60_000) return this.systemLight.value;
		let value = false;
		try {
			const proc = Bun.spawn(
				["reg", "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "SystemUsesLightTheme"],
				{ stdout: "pipe", stderr: "ignore" },
			);
			const out = await new Response(proc.stdout).text();
			value = /SystemUsesLightTheme\s+REG_DWORD\s+0x1/i.test(out);
		} catch {
			// keep default
		}
		this.systemLight = { value, at: Date.now() };
		return value;
	}
}
