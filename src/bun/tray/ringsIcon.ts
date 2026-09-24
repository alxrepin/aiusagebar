import { encodePng } from "./png";

export interface RingsIconOptions {
	/** Pixel size of the (square) image. Use 2x the logical tray size for Retina / HiDPI. */
	size: number;
	/** One entry per ring, outermost first. 0..1 or null (= no data yet). */
	progress: (number | null)[];
	/** RGB of the monochrome ink. macOS template images should use black. */
	color: [number, number, number];
	/** Opacity of the unfilled track. */
	trackAlpha?: number;
}

interface RingGeometry {
	radius: number;
	halfWidth: number;
}

/** Concentric ring layout, Apple-Fitness style: fewer rings → thicker strokes. */
export function ringGeometry(size: number, count: number): RingGeometry[] {
	const n = Math.max(1, Math.min(3, count));
	const s = size / 44; // tuned on a 44px (22pt @2x) canvas
	const width = [8.5, 7, 5.5][n - 1]! * s;
	const gap = [0, 2, 1.5][n - 1]! * s;
	const margin = 0.75 * s;
	const rings: RingGeometry[] = [];
	let r = size / 2 - margin - width / 2;
	for (let i = 0; i < n; i++) {
		rings.push({ radius: r, halfWidth: width / 2 });
		r -= width + gap;
	}
	return rings;
}

const TAU = Math.PI * 2;

/** Alpha (0..1) of a single ring at point (dx, dy) relative to the centre. */
function ringAlpha(dx: number, dy: number, g: RingGeometry, progress: number | null, trackAlpha: number): number {
	const d = Math.hypot(dx, dy);
	const inBand = Math.abs(d - g.radius) <= g.halfWidth;

	if (progress === null || progress <= 0) return inBand ? trackAlpha : 0;

	const p = Math.min(1, progress);
	if (p >= 1) return inBand ? 1 : 0;

	// Angle clockwise from 12 o'clock.
	let theta = Math.atan2(dx, -dy);
	if (theta < 0) theta += TAU;
	const end = p * TAU;

	if (inBand && theta <= end) return 1;

	// Rounded caps at the start (12 o'clock) and at the end of the arc.
	const capHit = (angle: number) => {
		const cx = Math.sin(angle) * g.radius;
		const cy = -Math.cos(angle) * g.radius;
		return Math.hypot(dx - cx, dy - cy) <= g.halfWidth;
	};
	if (capHit(0) || capHit(end)) return 1;

	return inBand ? trackAlpha : 0;
}

/** Renders the rings into RGBA pixels with 4×4 supersampling. */
export function renderRings(opts: RingsIconOptions): Uint8Array {
	const { size, color } = opts;
	const trackAlpha = opts.trackAlpha ?? 0.3;
	// With no accounts, still draw two empty tracks so the icon is recognisable.
	const progress = opts.progress.length ? opts.progress : [null, null];
	const geo = ringGeometry(size, progress.length);
	const px = new Uint8Array(size * size * 4);
	const SS = 4;
	const c = size / 2;

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let acc = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const dx = x + (sx + 0.5) / SS - c;
					const dy = y + (sy + 0.5) / SS - c;
					let a = 0;
					for (let i = 0; i < geo.length; i++) {
						a = Math.max(a, ringAlpha(dx, dy, geo[i]!, progress[i] ?? null, trackAlpha));
						if (a === 1) break;
					}
					acc += a;
				}
			}
			const alpha = acc / (SS * SS);
			const o = (y * size + x) * 4;
			px[o] = color[0];
			px[o + 1] = color[1];
			px[o + 2] = color[2];
			px[o + 3] = Math.round(alpha * 255);
		}
	}
	return px;
}

export function renderRingsPng(opts: RingsIconOptions): Uint8Array {
	return encodePng(opts.size, opts.size, renderRings(opts));
}
