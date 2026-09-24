import type { AccountInfo, LimitWindow, ResolvedRing, RingRef, Settings, UsageSnapshot } from "../../shared/types";

export const MAX_RINGS = 3;

const pickWindow = (usage: UsageSnapshot | undefined, kind: LimitWindow["kind"], fallbackId: string) =>
	usage?.windows.find((w) => w.kind === kind)?.id ?? fallbackId;

/**
 * Default ring layout:
 *   - one account  → its short ("daily"/session) limit + its weekly limit
 *   - 2+ accounts  → the short limit of each account (up to 3 rings)
 */
export function autoRingRefs(accounts: AccountInfo[], usage: Record<string, UsageSnapshot | undefined>): RingRef[] {
	if (accounts.length === 0) return [];
	if (accounts.length === 1) {
		const a = accounts[0]!;
		const u = usage[a.id];
		return [
			{ accountId: a.id, windowId: pickWindow(u, "short", "session") },
			{ accountId: a.id, windowId: pickWindow(u, "long", "weekly") },
		];
	}
	return accounts.slice(0, MAX_RINGS).map((a) => ({ accountId: a.id, windowId: pickWindow(usage[a.id], "short", "session") }));
}

export function resolveRings(
	settings: Pick<Settings, "ringMode" | "rings"> & Partial<Pick<Settings, "providerColors">>,
	accounts: AccountInfo[],
	usage: Record<string, UsageSnapshot | undefined>,
): ResolvedRing[] {
	const known = new Map(accounts.map((a) => [a.id, a]));
	const refs =
		settings.ringMode === "custom"
			? settings.rings.filter((r): r is RingRef => !!r && known.has(r.accountId))
			: autoRingRefs(accounts, usage);

	// Custom mode with every slot emptied or pointing at removed accounts: fall back to auto.
	const effective = refs.length ? refs : autoRingRefs(accounts, usage);

	return effective.slice(0, MAX_RINGS).map((ref) => {
		const account = known.get(ref.accountId)!;
		const w = usage[ref.accountId]?.windows.find((x) => x.id === ref.windowId);
		return {
			ref,
			providerId: account.providerId,
			accountLabel: account.label,
			windowLabel: w?.label ?? ref.windowId,
			shortLabel: w?.shortLabel ?? ref.windowId,
			progress: w ? w.usedPercent / 100 : null,
			resetsAt: w?.resetsAt,
			color: settings.providerColors?.[account.providerId],
		};
	});
}
