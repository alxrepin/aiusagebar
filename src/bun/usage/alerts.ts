import type { AccountInfo, LimitWindow, Settings, UsageSnapshot } from "../../shared/types";

export interface LowLimitAlert {
	key: string;
	title: string;
	body: string;
}

const alertKey = (accountId: string, windowId: string) => `${accountId}|${windowId}`;

const isRu = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("ru");
	} catch {
		return false;
	}
};

function formatIn(ms: number, ru: boolean): string {
	const mins = Math.max(0, Math.round(ms / 60_000));
	const d = Math.floor(mins / 1440);
	const h = Math.floor((mins % 1440) / 60);
	const m = mins % 60;
	const [D, H, M] = ru ? ["д", "ч", "мин"] : ["d", "h", "m"];
	if (d) return h ? `${d}${D} ${h}${H}` : `${d}${D}`;
	if (h) return m ? `${h}${H} ${m}${M}` : `${h}${H}`;
	return `${m}${M}`;
}

function message(providerName: string, account: AccountInfo, w: LimitWindow, remaining: number, now: number, multiAccount: boolean) {
	const ru = isRu();
	const who = multiAccount ? `${providerName} (${account.label})` : providerName;
	const left = Math.max(0, Math.round(remaining));
	const title =
		left <= 0
			? ru
				? `${who}: лимит исчерпан`
				: `${who}: limit reached`
			: ru
				? `${who}: осталось ${left}%`
				: `${who}: ${left}% left`;
	const reset = w.resetsAt
		? ru
			? ` · сброс через ${formatIn(Date.parse(w.resetsAt) - now, ru)}`
			: ` · resets in ${formatIn(Date.parse(w.resetsAt) - now, ru)}`
		: "";
	return { title, body: `${w.label}${reset}` };
}

/**
 * Decides which limits just dropped below the "remaining" threshold.
 * Each limit notifies once when it crosses the threshold and is re-armed only
 * after it recovers (usually at reset), so polling never spams notifications.
 *
 * Mutates and returns `alerted` (the set of limits currently below the threshold).
 */
export function checkLowLimits(opts: {
	settings: Pick<Settings, "alertsEnabled" | "alertThreshold">;
	account: AccountInfo;
	providerName: string;
	snapshot: UsageSnapshot;
	alerted: Set<string>;
	multiAccount?: boolean;
	now?: number;
}): LowLimitAlert[] {
	const { settings, account, snapshot, alerted } = opts;
	const now = opts.now ?? Date.now();
	const out: LowLimitAlert[] = [];
	for (const w of snapshot.windows) {
		const key = alertKey(account.id, w.id);
		const remaining = 100 - w.usedPercent;
		if (remaining >= settings.alertThreshold) {
			alerted.delete(key);
			continue;
		}
		// Disabled: only re-arm recovered limits, so turning alerts on reports limits that are already low.
		if (!settings.alertsEnabled || alerted.has(key)) continue;
		alerted.add(key);
		out.push({ key, ...message(opts.providerName, account, w, remaining, now, !!opts.multiAccount) });
	}
	return out;
}

/** Forget alert state for an account (e.g. when it is removed). */
export function clearAccountAlerts(alerted: Set<string>, accountId: string) {
	for (const k of [...alerted]) if (k.startsWith(`${accountId}|`)) alerted.delete(k);
}
