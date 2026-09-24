// Electrobun postBuild hook (runs before the app is compressed into the
// installer / update bundle).
// Electrobun 1.18's own icon step fails on Windows ("Cannot find module
// rcedit"), which left launcher.exe — and so the Start menu / desktop
// shortcuts and the taskbar — without an icon. Embed it ourselves.
import { existsSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

if (process.env.ELECTROBUN_OS !== "win") process.exit(0);

const root = join(import.meta.dir, "..");
const icon = join(root, "assets", "icon.ico");
const bin = join(process.env.ELECTROBUN_BUILD_DIR ?? "", process.env.ELECTROBUN_APP_NAME ?? "AIUsageBar", "bin");
const rcedit = [join(root, "node_modules/rcedit/bin/rcedit-x64.exe"), join(root, "node_modules/rcedit/bin/rcedit.exe")].find(existsSync);

if (!rcedit) {
	console.error("win-icons: rcedit not found in node_modules");
	process.exit(1);
}

for (const exe of ["launcher.exe", "bun.exe"]) {
	const path = join(bin, exe);
	if (!existsSync(path)) {
		console.warn(`win-icons: ${path} not found, skipping`);
		continue;
	}
	const args = [
		path,
		"--set-icon", icon,
		// Shown in Task Manager and the "Open with" / notification UI instead of "bun".
		"--set-version-string", "ProductName", "AIUsageBar",
		"--set-version-string", "FileDescription", "AIUsageBar",
		"--set-version-string", "CompanyName", "allrpn",
		"--set-product-version", pkg.version,
	];
	const r = Bun.spawnSync([rcedit, ...args], { stdio: ["ignore", "inherit", "inherit"] });
	if (r.exitCode !== 0) {
		console.error(`win-icons: rcedit failed for ${exe}`);
		process.exit(r.exitCode ?? 1);
	}
	console.log(`win-icons: embedded icon into ${exe}`);
}
