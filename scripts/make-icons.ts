// Generates the app icons from the same ring renderer as the tray icon:
//   assets/icon.iconset/*  (macOS, turned into .icns by the Electrobun build)
//   assets/icon.png        (Linux)
//   assets/icon.ico        (Windows: exe, shortcuts, installer; 16–256 px)
// Run: bun scripts/make-icons.ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { encodeIco, encodePng } from "../src/bun/tray/png";
import { renderRings } from "../src/bun/tray/ringsIcon";

const root = join(import.meta.dir, "..");

/** White rings on a near-black rounded square (macOS "squircle"-ish). */
function appIcon(size: number): Uint8Array {
	const px = new Uint8Array(size * size * 4);
	const inset = size * 0.1;
	const r = size * 0.2;
	const inner = size - inset * 2;
	const ringSize = Math.round(inner * 0.72);
	const rings = renderRings({ size: ringSize, progress: [0.72, 0.45], color: [255, 255, 255], trackAlpha: 0.22 });
	const off = Math.round((size - ringSize) / 2);

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			// rounded-rect coverage (2x2 supersampling)
			let cov = 0;
			for (const sy of [0.25, 0.75])
				for (const sx of [0.25, 0.75]) {
					const px_ = x + sx - inset;
					const py_ = y + sy - inset;
					const cx = Math.min(Math.max(px_, r), inner - r);
					const cy = Math.min(Math.max(py_, r), inner - r);
					if (px_ >= 0 && py_ >= 0 && px_ <= inner && py_ <= inner && Math.hypot(px_ - cx, py_ - cy) <= r) cov++;
				}
			const o = (y * size + x) * 4;
			// subtle vertical gradient
			const shade = Math.round(34 - (y / size) * 18);
			let R = shade,
				G = shade,
				B = shade + 2;
			const rx = x - off,
				ry = y - off;
			if (rx >= 0 && ry >= 0 && rx < ringSize && ry < ringSize) {
				const ro = (ry * ringSize + rx) * 4;
				const a = rings[ro + 3]! / 255;
				R = Math.round(R * (1 - a) + 255 * a);
				G = Math.round(G * (1 - a) + 255 * a);
				B = Math.round(B * (1 - a) + 255 * a);
			}
			px[o] = R;
			px[o + 1] = G;
			px[o + 2] = B;
			px[o + 3] = Math.round((cov / 4) * 255);
		}
	}
	return encodePng(size, size, px);
}

const iconset = join(root, "assets/icon.iconset");
await mkdir(iconset, { recursive: true });
for (const base of [16, 32, 128, 256, 512]) {
	await Bun.write(join(iconset, `icon_${base}x${base}.png`), appIcon(base));
	await Bun.write(join(iconset, `icon_${base}x${base}@2x.png`), appIcon(base * 2));
}
await Bun.write(join(root, "assets/icon.png"), appIcon(512));
await Bun.write(join(root, "assets/icon.ico"), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: appIcon(size) }))));
console.log("icons written to assets/");
