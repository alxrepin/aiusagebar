/**
 * Wraps an async function so calls run one at a time and only the newest
 * pending argument is applied: calls made while one is running collapse into
 * a single follow-up with the latest value. Keeps async renders from
 * finishing out of order and leaving stale output behind.
 */
export function latestOnly<T>(fn: (value: T) => Promise<void>, onError?: (err: unknown) => void): (value: T) => Promise<void> {
	let queue: Promise<void> = Promise.resolve();
	let pending: { value: T } | null = null;
	return (value: T) => {
		pending = { value };
		queue = queue
			.then(() => {
				const next = pending;
				pending = null;
				return next ? fn(next.value) : undefined;
			})
			.catch((err) => onError?.(err));
		return queue;
	};
}
