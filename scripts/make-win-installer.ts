// Builds the single-file Windows installer with Inno Setup after
// `electrobun build` (see scripts/windows/installer.iss).
// Output: artifacts/stable-win-x64-AIUsageBar-Setup.exe
import { existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");
const buildDir = join(root, "build", "stable-win-x64");
for (const f of ["AIUsageBar-Setup.exe", "AIUsageBar-Setup.tar.zst", "AIUsageBar-Setup.metadata.json"]) {
	if (!existsSync(join(buildDir, f))) throw new Error(`missing ${f} in ${buildDir}: run \`electrobun build --env=stable\` first`);
}

const candidates = [
	process.env.ISCC,
	"C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
	"C:\\Program Files\\Inno Setup 6\\ISCC.exe",
].filter(Boolean) as string[];
const iscc = candidates.find(existsSync);
if (!iscc) throw new Error("Inno Setup (ISCC.exe) not found. Install it: choco install innosetup");

const outDir = join(root, "artifacts");
const r = Bun.spawnSync(
	[iscc, `/DAppVersion=${pkg.version}`, `/DSrcDir=${buildDir}`, `/DOutDir=${outDir}`, join(root, "scripts", "windows", "installer.iss")],
	{ stdio: ["ignore", "inherit", "inherit"] },
);
if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);

const out = join(outDir, "stable-win-x64-AIUsageBar-Setup.exe");
renameSync(join(outDir, "AIUsageBar-Setup.exe"), out);
console.log("windows installer:", out, readdirSync(outDir));
