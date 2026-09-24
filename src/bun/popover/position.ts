export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PositionInput {
	platform: "mac" | "win" | "linux";
	/** Tray icon bounds in screen coordinates (may be all zeros if unknown). */
	tray: Rect;
	/** Mouse position, used when tray bounds are unavailable (common on Linux). */
	cursor: { x: number; y: number };
	/** Full display bounds and the usable area (without menu bar / taskbar). */
	display: Rect;
	workArea: Rect;
	size: { width: number; height: number };
	gap?: number;
}

/**
 * Where to put the popover so it hangs off the tray icon:
 *   - tray at the top of the screen (macOS menu bar, top panels) → below it
 *   - tray at the bottom (Windows taskbar)                        → above it
 * Always clamped to the work area.
 */
export function popoverPosition(input: PositionInput): { x: number; y: number; anchor: "top" | "bottom" } {
	const gap = input.gap ?? 6;
	const { size, workArea, display } = input;
	let tray = { ...input.tray };

	const hasTray = tray.width > 0 && tray.height > 0;
	if (!hasTray) tray = { x: input.cursor.x, y: input.cursor.y, width: 0, height: 0 };

	// Some macOS builds report Cocoa (bottom-left origin) coordinates. The menu
	// bar is always at the top, so a large y means we need to flip it.
	if (input.platform === "mac" && hasTray && tray.y > display.y + display.height / 2) {
		tray.y = display.y + display.height - tray.y - tray.height;
	}

	const trayCenterY = tray.y + tray.height / 2;
	const anchor: "top" | "bottom" = trayCenterY < display.y + display.height / 2 ? "top" : "bottom";

	let x = Math.round(tray.x + tray.width / 2 - size.width / 2);
	let y = anchor === "top" ? tray.y + tray.height + gap : tray.y - size.height - gap;

	// Windows: the tray lives inside the taskbar, so hug the work area edge instead.
	if (input.platform === "win") {
		if (anchor === "bottom") y = workArea.y + workArea.height - size.height - gap * 2;
		else y = workArea.y + gap * 2;
	}

	const minX = workArea.x + gap;
	const maxX = workArea.x + workArea.width - size.width - gap;
	x = Math.max(minX, Math.min(maxX, x));
	const minY = workArea.y + (input.platform === "mac" ? 0 : gap);
	const maxY = workArea.y + workArea.height - size.height - gap;
	y = Math.max(minY, Math.min(maxY, Math.round(y)));

	return { x, y, anchor };
}
