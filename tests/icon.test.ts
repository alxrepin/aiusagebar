import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { ringGeometry, renderRings, renderRingsPng } from "../src/bun/tray/ringsIcon";

test("PNG has a valid signature and IHDR", () => {
	const png = renderRingsPng({ size: 40, progress: [0.5, 0.2], color: [0, 0, 0] });
	expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(png.buffer);
	expect(new TextDecoder().decode(png.slice(12, 16))).toBe("IHDR");
	expect(view.getUint32(16)).toBe(40);
	expect(view.getUint32(20)).toBe(40);
	// IDAT inflates to (1 filter byte + 4 bytes per pixel) per row.
	const idatLen = view.getUint32(33);
	const raw = inflateSync(png.slice(41, 41 + idatLen));
	expect(raw.length).toBe(40 * (1 + 40 * 4));
});

test("filled arc is opaque, unfilled track is translucent", () => {
	const size = 44;
	const px = renderRings({ size, progress: [0.5], color: [0, 0, 0], trackAlpha: 0.3 });
	const [g] = ringGeometry(size, 1);
	const alphaAt = (angle: number) => {
		const x = Math.floor(size / 2 + Math.sin(angle) * g!.radius);
		const y = Math.floor(size / 2 - Math.cos(angle) * g!.radius);
		return px[(y * size + x) * 4 + 3]!;
	};
	expect(alphaAt(Math.PI / 2)).toBeGreaterThan(240); // 3 o'clock: filled (50%)
	expect(alphaAt((3 * Math.PI) / 2)).toBeLessThan(100); // 9 o'clock: track only
	expect(px[3]).toBe(0); // corner is transparent
});

test("fewer rings are drawn thicker", () => {
	expect(ringGeometry(44, 1)[0]!.halfWidth).toBeGreaterThan(ringGeometry(44, 3)[0]!.halfWidth);
	expect(ringGeometry(44, 3)).toHaveLength(3);
});

test("menu bar icon: pHYs chunk marks @2x (144 dpi) so macOS sizes it in points", () => {
	const png = renderRingsPng({ size: 36, progress: [0.3], color: [0, 0, 0], weight: "thin", dpi: 144 });
	const view = new DataView(png.buffer);
	// Chunk right after IHDR (8 sig + 25 IHDR bytes).
	expect(new TextDecoder().decode(png.slice(37, 41))).toBe("pHYs");
	expect(view.getUint32(41)).toBe(5669); // 144 dpi in pixels per metre
	expect(png[49]).toBe(1); // unit: metre
});

test("thin weight is lighter than the bold UI rings", () => {
	expect(ringGeometry(36, 2, "thin")[0]!.halfWidth).toBeLessThan(ringGeometry(36, 2, "bold")[0]!.halfWidth);
});

test("per-ring colours: each ring keeps its own colour, uncoloured rings use the ink", async () => {
	const { renderRings, ringGeometry } = await import("../src/bun/tray/ringsIcon");
	const size = 44;
	const px = renderRings({ size, progress: [1, 1], color: [255, 255, 255], colors: [[250, 17, 79], null] });
	const [outer, inner] = ringGeometry(size, 2);
	const at = (r: number) => {
		const o = ((Math.floor(size / 2 - r)) * size + Math.floor(size / 2)) * 4; // straight up from centre
		return [...px.slice(o, o + 4)];
	};
	expect(at(outer!.radius)).toEqual([250, 17, 79, 255]);
	expect(at(inner!.radius)).toEqual([255, 255, 255, 255]);
});

test("hexToRgb", async () => {
	const { hexToRgb } = await import("../src/bun/tray/ringsIcon");
	expect(hexToRgb("#FA114F")).toEqual([250, 17, 79]);
	expect(hexToRgb("nope")).toBeNull();
});
