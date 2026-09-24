// Electrobun 1.x ships its SDK as TypeScript sources that don't pass `strict`
// type-checking. Run tsc over the whole project but only fail on our own files.
const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--pretty", "false"], { stdout: "pipe", stderr: "pipe" });
const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
await proc.exited;

const ours = out
	.split("\n")
	.filter((line) => /^\S.*\(\d+,\d+\): error/.test(line) && !line.startsWith("node_modules/"));

if (ours.length) {
	console.error(ours.join("\n"));
	console.error(`\n${ours.length} type error(s) in project sources.`);
	process.exit(1);
}
console.log("typecheck: ok (Electrobun SDK internals ignored)");
export {};
