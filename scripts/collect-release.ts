// Copies the user-facing build outputs from Electrobun's artifacts/ folder
// into dist/ with friendly names, e.g. AIUsageBar-0.1.0-macos-arm64.dmg.
// Usage: bun scripts/collect-release.ts <platform-label>
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import pkg from "../package.json";

const label = process.argv[2];
if (!label) throw new Error("usage: collect-release.ts <platform-label>");

const src = join(import.meta.dir, "..", "artifacts");
const out = join(import.meta.dir, "..", "dist");
await mkdir(out, { recursive: true });

const files = await readdir(src);
console.log("artifacts:", files);

// Installers first; the raw update bundle (tar.zst) is only kept as a fallback.
const wanted = files.filter((f) => /\.(dmg|exe|msi|zip|AppImage)$/i.test(f));
const picked = wanted.length ? wanted : files.filter((f) => !/\.(json|patch)$/i.test(f));
if (!picked.length) throw new Error("no release artifacts found");

for (const f of picked) {
	const ext = f.endsWith(".tar.zst") ? ".tar.zst" : extname(f);
	const kind = /setup/i.test(f) ? "-Setup" : "";
	const name = `AIUsageBar-${pkg.version}-${label}${kind}${ext}`;
	await copyFile(join(src, f), join(out, name));
	console.log(`${f} → dist/${name}`);
}
