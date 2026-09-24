// Builds the popover UI against a mock bridge into .preview/ and serves it.
//   bun run preview            → http://localhost:5173/?platform=mac&scenario=two
// Query: platform=mac|win|linux, scenario=two|one|empty, view=settings
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, ".preview");
await mkdir(out, { recursive: true });

const result = await Bun.build({
	entrypoints: [join(root, "src/views/popover/index.ts")],
	outdir: out,
	target: "browser",
	format: "esm",
	plugins: [
		{
			name: "mock-bridge",
			setup(build) {
				build.onResolve({ filter: /^\.\/bridge$/ }, () => ({ path: join(root, "scripts/previewBridge.ts") }));
			},
		},
	],
});
if (!result.success) {
	console.error(result.logs);
	process.exit(1);
}
await cp(join(root, "src/views/popover/index.html"), join(out, "index.html"));
await cp(join(root, "src/views/popover/index.css"), join(out, "index.css"));

if (process.argv.includes("--build-only")) process.exit(0);

const server = Bun.serve({
	port: Number(process.env.PORT ?? 5173),
	async fetch(req) {
		const path = new URL(req.url).pathname;
		const file = Bun.file(join(out, path === "/" ? "index.html" : path));
		return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
	},
});
console.log(`Preview: http://localhost:${server.port}/?platform=mac&scenario=two`);
