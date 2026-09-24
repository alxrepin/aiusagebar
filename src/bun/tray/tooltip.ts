import type { AppState, LimitWindow } from "../../shared/types";

/** Windows notification-area tooltips hold at most 127 characters. */
export const TOOLTIP_MAX = 127;

function duration(ms: number, ru: boolean): string {
	const mins = Math.max(0, Math.round(ms / 60_000));
	const d = Math.floor(mins / 1440);
	const h = Math.floor((mins % 1440) / 60);
	const m = mins % 60;
	const [dd, hh, mm] = ru ? ["д", "ч", "м"] : ["d", "h", "m"];
	if (d) return h ? `${d}${dd} ${h}${hh}` : `${d}${dd}`;
	if (h) return m ? `${h}${hh} ${m}${mm}` : `${h}${hh}`;
	return `${m}${mm}`;
}

function windowText(w: LimitWindow, now: number, ru: boolean, withReset: boolean): string {
	const pct = `${w.shortLabel} ${Math.round(Math.max(0, Math.min(100, w.usedPercent)))}%`;
	if (!withReset || !w.resetsAt) return pct;
	const ms = Date.parse(w.resetsAt) - now;
	return Number.isFinite(ms) && ms > 0 ? `${pct} (${ru ? "сброс" : "reset"} ${duration(ms, ru)})` : pct;
}

/**
 * Tray tooltip text (Windows), one line per account, e.g.
 * "Claude: 5h 42% (reset 2h 10m) · 7d 18%". Percentages are the share used, as in
 * the popover. Drops reset times, then trims lines, to fit TOOLTIP_MAX.
 */
export function trayTooltip(state: AppState, ru: boolean, now = Date.now()): string {
	if (!state.accounts.length) return ru ? "AIUsageBar — нажмите, чтобы подключить" : "AIUsageBar — click to connect";

	const perProvider = new Map<string, number>();
	for (const a of state.accounts) perProvider.set(a.providerId, (perProvider.get(a.providerId) ?? 0) + 1);

	const build = (withReset: boolean) =>
		state.accounts.map((a) => {
			const provider = state.providers.find((p) => p.id === a.providerId)?.displayName ?? a.providerId;
			const name = (perProvider.get(a.providerId) ?? 0) > 1 ? `${provider} (${a.label.split("@")[0]})` : provider;
			const status = state.status[a.id];
			if (status?.state === "error") {
				const msg = status.needsReauth ? (ru ? "нужно войти заново" : "sign in again") : ru ? "ошибка" : "error";
				return `${name}: ${msg}`;
			}
			const windows = state.usage[a.id]?.windows ?? [];
			const picked = (["short", "long"] as const)
				.map((kind) => windows.find((w) => w.kind === kind))
				.filter((w): w is LimitWindow => !!w);
			if (!picked.length) return `${name}: —`;
			return `${name}: ${picked.map((w) => windowText(w, now, ru, withReset)).join(" · ")}`;
		});

	let lines = build(true);
	if (lines.join("\n").length > TOOLTIP_MAX) lines = build(false);
	let text = lines.join("\n");
	if (text.length > TOOLTIP_MAX) text = `${text.slice(0, TOOLTIP_MAX - 1)}…`;
	return text;
}
