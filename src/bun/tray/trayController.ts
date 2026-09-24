import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Tray } from "electrobun/bun";
import type { AppState, IconTheme } from "../../shared/types";
import { isRu } from "../i18n";
import { setStatusItemTemplateImage } from "./macStatusImage";
import { encodeIco } from "./png";
import { hexToRgb, renderRingsPng, type RGB } from "./ringsIcon";
import { trayTooltip } from "./tooltip";
import { setTrayTooltip } from "./winTrayTip";

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
	private lastTip = "";

	constructor(
		private platform: Platform,
		private cacheDir: string,
	) {
		const size = LOGICAL_SIZE[platform];
		// Create the tray with a real image: Electrobun applies `template` and the
		// point size only at creation time.
		mkdirSync(cacheDir, { recursive: true });
		const initial = join(cacheDir, `tray-initial.${this.ext}`);
		writeFileSync(initial, this.render([], platform === "mac" ? [0, 0, 0] : [255, 255, 255]));
		this.tray = new Tray({ title: "", image: initial, template: platform === "mac", width: size, height: size });
	}

	/** Windows tray icons must be .ico (LoadImage(IMAGE_ICON) can't read PNG). */
	private get ext() {
		return this.platform === "win" ? "ico" : "png";
	}

	private render(progress: (number | null)[], color: RGB, colors?: (RGB | null)[]) {
		const png = (size: number, dpi?: number) =>
			renderRingsPng({ size, progress, color, colors, weight: "thin", trackAlpha: 0.32, dpi });
		if (this.platform === "win") {
			// One entry per common DPI scale (100–300%) so Windows never has to resample.
			return encodeIco([16, 20, 24, 32, 40, 48].map((size) => ({ size, png: png(size) })));
		}
		// @2x: tells macOS the image is LOGICAL_SIZE points, not pixels.
		return png(LOGICAL_SIZE[this.platform] * 2, 144);
	}

	async update(state: AppState) {
		const progress = state.rings.map((r) => r.progress);
		const colors = state.rings.map((r) => (r.color ? hexToRgb(r.color) : null));
		const colored = colors.some(Boolean);
		// macOS: all-monochrome rings stay a template image (system recolours it);
		// with provider colours we draw real colours and pick the ink ourselves.
		const template = this.platform === "mac" && !colored;
		const ink = await this.inkColor(state.settings.iconTheme, template);
		const key = JSON.stringify([progress.map((p) => (p === null ? null : Math.round(p * 100))), ink, colors, template]);

		const imageChanged = key !== this.lastKey;
		if (imageChanged) {
			this.lastKey = key;
			await mkdir(this.cacheDir, { recursive: true });
			// Alternate file names: some platforms cache images by path.
			this.flip = !this.flip;
			const file = join(this.cacheDir, `tray-${this.flip ? "a" : "b"}.${this.ext}`);
			await Bun.write(file, this.render(progress, ink, colors));
			const size = LOGICAL_SIZE[this.platform];
			// macOS: Tray.setImage() would drop the template flag and size, so set it natively.
			const done = this.platform === "mac" && setStatusItemTemplateImage(this.tray.ptr, file, size, size, template);
			if (!done) this.tray.setImage(file);
			await rm(join(this.cacheDir, `tray-${this.flip ? "b" : "a"}.${this.ext}`), { force: true });
		}

		// Windows: usage in the hover tooltip (the taskbar can't show text).
		// Re-sent after every icon change, which resets Electrobun's (empty) tip.
		if (this.platform === "win") {
			const tip = trayTooltip(state, isRu());
			if (imageChanged || tip !== this.lastTip) {
				this.lastTip = tip;
				setTrayTooltip(this.tray.ptr, tip);
			}
		}

		if (this.platform === "mac") {
			const first = state.rings[0];
			const title =
				state.settings.showPercentInMenuBar && first?.progress != null ? ` ${Math.round(first.progress * 100)}%` : "";
			this.tray.setTitle(title);
		}
	}

	private async inkColor(theme: IconTheme, template: boolean): Promise<RGB> {
		const BLACK: RGB = [0, 0, 0];
		const WHITE: RGB = [255, 255, 255];
		if (template) return BLACK; // template image, recoloured by macOS
		if (theme === "light") return WHITE; // light ink for dark taskbars
		if (theme === "dark") return BLACK;
		return (await this.isSystemLightTheme()) ? BLACK : WHITE;
	}

	/**
	 * Windows: SystemUsesLightTheme (taskbar colour). macOS: light unless
	 * AppleInterfaceStyle is "Dark". Linux panels default to dark.
	 */
	private async isSystemLightTheme(): Promise<boolean> {
		if (this.platform === "linux") return false;
		if (this.systemLight && Date.now() - this.systemLight.at < 60_000) return this.systemLight.value;
		let value = false;
		if (this.platform === "mac") {
			try {
				const proc = Bun.spawn(["defaults", "read", "-g", "AppleInterfaceStyle"], { stdout: "pipe", stderr: "ignore" });
				const out = await new Response(proc.stdout).text();
				value = !/dark/i.test(out);
			} catch {
				// keep default
			}
			this.systemLight = { value, at: Date.now() };
			return value;
		}
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
