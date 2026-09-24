const en = {
	title: "AI Usage",
	updated: "Updated {t}",
	justNow: "just now",
	never: "not yet",
	refresh: "Refresh",
	settings: "Settings",
	back: "Back",
	done: "Done",
	resetsIn: "Resets in {t}",
	resetsAt: "Resets {t}",
	resetUnknown: "Reset time unknown",
	used: "used",
	noData: "No data yet",
	loading: "Updating…",
	reconnect: "Sign in again",
	emptyTitle: "Track your AI limits",
	emptyBody: "Connect ChatGPT or Claude. Sign-in happens in your browser; tokens never leave this computer.",
	accounts: "Accounts",
	addAccount: "Add account",
	remove: "Remove",
	removeConfirm: "Remove?",
	waitingBrowser: "Waiting for browser…",
	cancel: "Cancel",
	rings: "Rings",
	ringsAuto: "Auto",
	ringsCustom: "Custom",
	ringsAutoHint: "One account: session + weekly. Several accounts: the session limit of each.",
	ringOuter: "Outer",
	ringMiddle: "Middle",
	ringInner: "Inner",
	ringEmpty: "—",
	general: "General",
	refreshEvery: "Refresh every",
	minutes: "{n} min",
	trayIcon: "Tray icon",
	iconAuto: "Match taskbar",
	iconLight: "White",
	iconDark: "Black",
	showPercent: "Show % in menu bar",
	quit: "Quit AIUsageBar",
	d: "d",
	h: "h",
	m: "m",
};

type Dict = typeof en;

const ru: Dict = {
	title: "Лимиты ИИ",
	updated: "Обновлено {t}",
	justNow: "только что",
	never: "ещё нет",
	refresh: "Обновить",
	settings: "Настройки",
	back: "Назад",
	done: "Готово",
	resetsIn: "Сброс через {t}",
	resetsAt: "Сброс {t}",
	resetUnknown: "Время сброса неизвестно",
	used: "потрачено",
	noData: "Нет данных",
	loading: "Обновление…",
	reconnect: "Войти заново",
	emptyTitle: "Следите за лимитами ИИ",
	emptyBody: "Подключите ChatGPT или Claude. Вход происходит в браузере, токены не покидают этот компьютер.",
	accounts: "Аккаунты",
	addAccount: "Добавить аккаунт",
	remove: "Удалить",
	removeConfirm: "Удалить?",
	waitingBrowser: "Ожидание браузера…",
	cancel: "Отмена",
	rings: "Кольца",
	ringsAuto: "Авто",
	ringsCustom: "Вручную",
	ringsAutoHint: "Один аккаунт: сессия + неделя. Несколько: сессионный лимит каждого.",
	ringOuter: "Внешнее",
	ringMiddle: "Среднее",
	ringInner: "Внутреннее",
	ringEmpty: "—",
	general: "Общее",
	refreshEvery: "Обновлять каждые",
	minutes: "{n} мин",
	trayIcon: "Иконка в трее",
	iconAuto: "Как панель задач",
	iconLight: "Белая",
	iconDark: "Чёрная",
	showPercent: "Показывать % в строке меню",
	quit: "Выйти из AIUsageBar",
	d: "д",
	h: "ч",
	m: "мин",
};

const lang = (navigator.language || "en").toLowerCase();
export const locale = lang.startsWith("ru") ? "ru" : "en";
const dict: Dict = locale === "ru" ? ru : en;

export function t(key: keyof Dict, vars: Record<string, string | number> = {}): string {
	return dict[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** "2h 14m", "3d 4h", "12m" */
export function formatDuration(ms: number): string {
	const mins = Math.max(0, Math.round(ms / 60_000));
	const d = Math.floor(mins / 1440);
	const h = Math.floor((mins % 1440) / 60);
	const m = mins % 60;
	if (d > 0) return h ? `${d}${t("d")} ${h}${t("h")}` : `${d}${t("d")}`;
	if (h > 0) return m ? `${h}${t("h")} ${m}${t("m")}` : `${h}${t("h")}`;
	return `${m}${t("m")}`;
}

export function formatResetAt(iso: string, now = Date.now()): string {
	const date = new Date(iso);
	const sameDay = new Date(now).toDateString() === date.toDateString();
	const time = date.toLocaleTimeString(navigator.language, { hour: "2-digit", minute: "2-digit" });
	if (sameDay) return time;
	return `${date.toLocaleDateString(navigator.language, { weekday: "short" })} ${time}`;
}

export function formatAgo(iso: string | undefined, now = Date.now()): string {
	if (!iso) return t("never");
	const ms = now - Date.parse(iso);
	if (ms < 60_000) return t("justNow");
	const rtf = new Intl.RelativeTimeFormat(navigator.language, { numeric: "auto" });
	const mins = Math.round(ms / 60_000);
	return mins < 60 ? rtf.format(-mins, "minute") : rtf.format(-Math.round(mins / 60), "hour");
}
