// Electrobun postWrap hook (runs before the .dmg is created).
// Apple Silicon refuses to launch binaries without any signature, so when no
// Developer ID is configured we apply an ad-hoc signature ("-") to the bundle.
// With ELECTROBUN_DEVELOPER_ID set, Electrobun signs (and notarises) itself.
const bundle = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;

if (process.env.ELECTROBUN_OS !== "macos" || !bundle) process.exit(0);
if (process.env.ELECTROBUN_DEVELOPER_ID) {
	console.log("adhoc-sign: Developer ID configured, leaving signing to Electrobun");
	process.exit(0);
}

const result = Bun.spawnSync(["codesign", "--force", "--deep", "--sign", "-", bundle], {
	stdio: ["ignore", "inherit", "inherit"],
});
if (result.exitCode !== 0) {
	console.error("adhoc-sign: codesign failed");
	process.exit(result.exitCode ?? 1);
}
console.log(`adhoc-sign: signed ${bundle}`);
