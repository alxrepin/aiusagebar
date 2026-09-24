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
