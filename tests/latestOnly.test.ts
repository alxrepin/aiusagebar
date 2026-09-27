import { expect, test } from "bun:test";
import { latestOnly } from "../src/bun/util/latestOnly";

test("overlapping calls finish in order and the newest value wins", async () => {
	const drawn: number[] = [];
	// The in-flight (older) update is slower than the later ones, like a slow icon write.
	const draw = latestOnly<number>(async (v) => {
		await Bun.sleep(v === 1 ? 30 : 1);
		drawn.push(v);
	});
	void draw(1);
	await Bun.sleep(5); // 1 is now running
	void draw(2);
	await draw(3);
	expect(drawn).toEqual([1, 3]); // 2 was superseded before it started; 3 lands last
});

test("calls in the same tick collapse into one", async () => {
	const drawn: number[] = [];
	const draw = latestOnly<number>(async (v) => void drawn.push(v));
	void draw(1);
	await draw(2);
	expect(drawn).toEqual([2]);
});

test("an error doesn't stop later updates", async () => {
	const drawn: number[] = [];
	const errors: unknown[] = [];
	const draw = latestOnly<number>(
		async (v) => {
			if (v === 1) throw new Error("boom");
			drawn.push(v);
		},
		(e) => errors.push(e),
	);
	await draw(1);
	await draw(2);
	expect(errors).toHaveLength(1);
	expect(drawn).toEqual([2]);
});
