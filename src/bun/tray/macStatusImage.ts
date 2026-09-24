import { dlopen, FFIType, type Pointer } from "bun:ffi";

/**
 * macOS only: puts an image into an NSStatusItem as a *template* image of a
 * given point size.
 *
 * Electrobun 1.x's `Tray.setImage()` creates a plain NSImage and drops both the
 * template flag and the size, so the menu bar icon ends up black and huge.
 * We build the NSImage ourselves through the Objective-C runtime and hand it
 * to the button on the main thread (`performSelectorOnMainThread:`), because
 * Bun runs off the AppKit main thread.
 */

const OBJC = "/usr/lib/libobjc.A.dylib";

type Api = {
	cls: (name: string) => Pointer | null;
	sel: (name: string) => Pointer | null;
	send: (obj: Pointer, sel: Pointer | null) => Pointer | null;
	sendPtr: (obj: Pointer, sel: Pointer | null, arg: Pointer | Buffer | null) => Pointer | null;
	sendBool: (obj: Pointer, sel: Pointer | null, arg: boolean) => void;
	sendSize: (obj: Pointer, sel: Pointer | null, w: number, h: number) => void;
	sendOnMain: (obj: Pointer, sel: Pointer | null, action: Pointer | null, arg: Pointer, wait: boolean) => void;
};

let api: Api | null | undefined;

const cstr = (s: string) => Buffer.from(`${s}\0`, "utf8");

function load(): Api | null {
	if (api !== undefined) return api;
	// AIUSAGEBAR_NO_NATIVE_TRAY=1 disables this path (falls back to Tray.setImage).
	if (process.platform !== "darwin" || process.env.AIUSAGEBAR_NO_NATIVE_TRAY) return (api = null);
	try {
		// objc_msgSend must be called through a correctly typed prototype, so we
		// bind the same symbol once per signature we need.
		const P = FFIType.ptr;
		const base = dlopen(OBJC, {
			objc_getClass: { args: [P], returns: P },
			sel_registerName: { args: [P], returns: P },
		}).symbols;
		const send = dlopen(OBJC, { objc_msgSend: { args: [P, P], returns: P } }).symbols.objc_msgSend;
		const sendPtr = dlopen(OBJC, { objc_msgSend: { args: [P, P, P], returns: P } }).symbols.objc_msgSend;
		const sendBool = dlopen(OBJC, { objc_msgSend: { args: [P, P, FFIType.bool], returns: FFIType.void } }).symbols.objc_msgSend;
		// NSSize is an HFA of two doubles: passed exactly like two double args on arm64 and x86_64.
		const sendSize = dlopen(OBJC, { objc_msgSend: { args: [P, P, FFIType.f64, FFIType.f64], returns: FFIType.void } }).symbols.objc_msgSend;
		const sendOnMain = dlopen(OBJC, { objc_msgSend: { args: [P, P, P, P, FFIType.bool], returns: FFIType.void } }).symbols.objc_msgSend;

		const sels = new Map<string, Pointer | null>();
		api = {
			cls: (name) => base.objc_getClass(cstr(name)) as Pointer | null,
			sel: (name) => {
				if (!sels.has(name)) sels.set(name, base.sel_registerName(cstr(name)) as Pointer | null);
				return sels.get(name)!;
			},
			send: (o, s) => send(o, s) as Pointer | null,
			sendPtr: (o, s, a) => sendPtr(o, s, a) as Pointer | null,
			sendBool: (o, s, a) => void sendBool(o, s, a),
			sendSize: (o, s, w, h) => void sendSize(o, s, w, h),
			sendOnMain: (o, s, action, a, wait) => void sendOnMain(o, s, action, a, wait),
		};
		return api;
	} catch (err) {
		console.warn("[tray] Objective-C runtime unavailable:", err);
		return (api = null);
	}
}

/** Returns false if the native path is unavailable; the caller should fall back to Tray.setImage(). */
export function setStatusItemTemplateImage(statusItem: Pointer | null, path: string, width: number, height: number): boolean {
	const o = load();
	if (!o || !statusItem) return false;
	try {
		const NSString = o.cls("NSString");
		const NSImage = o.cls("NSImage");
		if (!NSString || !NSImage) return false;

		const str = o.sendPtr(o.send(NSString, o.sel("alloc"))!, o.sel("initWithUTF8String:"), cstr(path));
		if (!str) return false;
		const image = o.sendPtr(o.send(NSImage, o.sel("alloc"))!, o.sel("initWithContentsOfFile:"), str);
		o.send(str, o.sel("release"));
		if (!image) return false;

		o.sendBool(image, o.sel("setTemplate:"), true);
		o.sendSize(image, o.sel("setSize:"), width, height);

		const button = o.send(statusItem, o.sel("button"));
		if (button) {
			o.sendOnMain(button, o.sel("performSelectorOnMainThread:withObject:waitUntilDone:"), o.sel("setImage:"), image, true);
		}
		o.send(image, o.sel("release")); // the button holds its own reference
		return !!button;
	} catch (err) {
		console.warn("[tray] native template image failed:", err);
		return false;
	}
}
