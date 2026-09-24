import { expect, test } from "bun:test";
import { popoverPosition } from "../src/bun/popover/position";

const display = { x: 0, y: 0, width: 1440, height: 900 };

test("macOS: hangs below the menu bar icon, centred", () => {
	const p = popoverPosition({
		platform: "mac",
		tray: { x: 1200, y: 0, width: 30, height: 24 },
		cursor: { x: 0, y: 0 },
		display,
		workArea: { x: 0, y: 25, width: 1440, height: 875 },
		size: { width: 340, height: 400 },
	});
	expect(p.anchor).toBe("top");
	expect(p.x).toBe(1215 - 170);
	expect(p.y).toBe(30);
});

test("macOS: flips bottom-left-origin coordinates", () => {
	const p = popoverPosition({
		platform: "mac",
		tray: { x: 1200, y: 876, width: 30, height: 24 },
		cursor: { x: 0, y: 0 },
		display,
		workArea: { x: 0, y: 25, width: 1440, height: 875 },
		size: { width: 340, height: 400 },
	});
	expect(p.anchor).toBe("top");
	expect(p.y).toBe(30);
});

test("Windows: sits above the taskbar and stays on screen", () => {
	const p = popoverPosition({
		platform: "win",
		tray: { x: 1900, y: 1045, width: 24, height: 30 },
		cursor: { x: 0, y: 0 },
		display: { x: 0, y: 0, width: 1920, height: 1080 },
		workArea: { x: 0, y: 0, width: 1920, height: 1032 },
		size: { width: 340, height: 400 },
	});
	expect(p.anchor).toBe("bottom");
	expect(p.x + 340).toBeLessThanOrEqual(1920 - 6);
	expect(p.y + 400).toBeLessThanOrEqual(1032);
});

test("unknown tray bounds fall back to the cursor", () => {
	const p = popoverPosition({
		platform: "linux",
		tray: { x: 0, y: 0, width: 0, height: 0 },
		cursor: { x: 700, y: 10 },
		display,
		workArea: { x: 0, y: 32, width: 1440, height: 868 },
		size: { width: 340, height: 400 },
	});
	expect(p.anchor).toBe("top");
	expect(p.x).toBe(700 - 170);
	expect(p.y).toBeGreaterThanOrEqual(32);
});
