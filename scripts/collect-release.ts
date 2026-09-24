// Prepares dist/ for the GitHub Release from Electrobun's artifacts/ folder:
//   - installers get friendly names, e.g. AIUsageBar-0.3.0-macos-arm64.dmg
//   - the in-app updater feed (<channel>-<os>-<arch>-update.json and the
//     compressed bundle) is copied with its original name, because the app
//     requests exactly those names from releases/latest/download/.
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

let installers = files.filter((f) => /\.(dmg|exe|msi|zip|AppImage)$/i.test(f));
// Windows: publish the single-file Inno Setup .exe; Electrobun's Setup.zip only
// works when its .installer folder is extracted next to Setup.exe.
if (installers.some((f) => /\.exe$/i.test(f))) installers = installers.filter((f) => !/\.zip$/i.test(f));
if (!installers.length) throw new Error("no installers found in artifacts/");
for (const f of installers) {
	const kind = /setup/i.test(f) ? "-Setup" : "";
	const name = `AIUsageBar-${pkg.version}-${label}${kind}${extname(f)}`;
	await copyFile(join(src, f), join(out, name));
	console.log(`installer: ${f} → dist/${name}`);
}

const feed = files.filter((f) => f.endsWith("-update.json") || f.endsWith(".tar.zst") || f.endsWith(".patch"));
if (!feed.some((f) => f.endsWith("-update.json"))) throw new Error("update.json missing from artifacts/");
for (const f of feed) {
	await copyFile(join(src, f), join(out, f));
	console.log(`updater feed: ${f}`);
}
