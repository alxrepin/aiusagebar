import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 512 * 1024;

/**
 * Mirror console.warn/error into a small log file (rotated at 512 KB), so
 * problems on a user's machine can be diagnosed: the app has no console.
 */
export function installFileLog(file: string): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
	} catch {
		return;
	}
	const write = (level: string, args: unknown[]) => {
		try {
			if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, `${file}.1`);
			const text = args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
			appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
		} catch {
			// never let logging break the app
		}
	};
	for (const level of ["warn", "error"] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			original(...args);
			write(level, args);
		};
	}
	process.on("uncaughtException", (err) => write("uncaught", [err]));
	process.on("unhandledRejection", (err) => write("unhandled", [err]));
}
