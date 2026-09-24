import { deflateSync } from "node:zlib";

// Minimal RGBA PNG encoder — enough for tray icons, no native deps.

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/**
 * @param dpi Resolution stored in a pHYs chunk. macOS derives an image's point
 *            size from it (144 dpi → a 36px image is 18pt), so @2x icons need it.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array, dpi?: number): Uint8Array {
	const ihdr = new Uint8Array(13);
	const v = new DataView(ihdr.buffer);
	v.setUint32(0, width);
	v.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type RGBA
	// compression, filter, interlace = 0

	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}

	const phys: Uint8Array[] = [];
	if (dpi) {
		const d = new Uint8Array(9);
		const dv = new DataView(d.buffer);
		const ppm = Math.round(dpi / 0.0254); // pixels per metre
		dv.setUint32(0, ppm);
		dv.setUint32(4, ppm);
		d[8] = 1; // unit: metre
		phys.push(chunk("pHYs", d));
	}

	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		...phys,
		chunk("IDAT", new Uint8Array(deflateSync(raw))),
		chunk("IEND", new Uint8Array(0)),
	];
	const total = parts.reduce((n, p) => n + p.length, 0);
	const png = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		png.set(p, o);
		o += p.length;
	}
	return png;
}

/**
 * Windows .ico holding PNG-compressed images (supported since Vista).
 * Windows' LoadImage(IMAGE_ICON) — used for tray icons — only reads .ico,
 * and picks the entry closest to the size it needs.
 */
export function encodeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
	const count = images.length;
	const headerSize = 6 + 16 * count;
	const total = headerSize + images.reduce((n, i) => n + i.png.length, 0);
	const out = new Uint8Array(total);
	const v = new DataView(out.buffer);
	v.setUint16(0, 0, true); // reserved
	v.setUint16(2, 1, true); // type: icon
	v.setUint16(4, count, true);
	let offset = headerSize;
	images.forEach((img, i) => {
		const e = 6 + 16 * i;
		out[e] = img.size >= 256 ? 0 : img.size; // 0 means 256
		out[e + 1] = img.size >= 256 ? 0 : img.size;
		out[e + 2] = 0; // palette
		out[e + 3] = 0; // reserved
		v.setUint16(e + 4, 1, true); // colour planes
		v.setUint16(e + 6, 32, true); // bits per pixel
		v.setUint32(e + 8, img.png.length, true);
		v.setUint32(e + 12, offset, true);
		out.set(img.png, offset);
		offset += img.png.length;
	});
	return out;
}
