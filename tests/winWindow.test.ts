import { describe, expect, test } from "bun:test";
import { outsideClickDetector, type MouseSample } from "../src/bun/popover/winWindow";

const s = (down: boolean, inside: boolean, pressedSinceLast = false): MouseSample => ({ down, inside, pressedSinceLast });

describe("outsideClickDetector", () => {
	test("ignores the tray click that opened the popover", () => {
		const d = outsideClickDetector();
		expect(d(s(true, false, true))).toBe(false); // button still held after the tray click
		expect(d(s(false, false))).toBe(false); // released
		expect(d(s(false, false))).toBe(false);
	});

	test("ignores clicks inside the popover", () => {
		const d = outsideClickDetector();
		d(s(false, false));
		expect(d(s(true, true, true))).toBe(false);
		expect(d(s(false, true))).toBe(false);
	});

	test("fires on a press outside", () => {
		const d = outsideClickDetector();
		d(s(false, true));
		expect(d(s(true, false, true))).toBe(true);
		expect(d(s(true, false))).toBe(false); // held: fires once
	});

	test("catches a click shorter than the polling interval", () => {
		const d = outsideClickDetector();
		d(s(false, false));
		expect(d(s(false, false, true))).toBe(true);
	});

	test("dragging from inside to outside doesn't dismiss", () => {
		const d = outsideClickDetector();
		d(s(false, true));
		expect(d(s(true, true, true))).toBe(false);
		expect(d(s(true, false))).toBe(false);
	});
});
