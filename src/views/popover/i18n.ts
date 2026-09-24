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
	launchAtLogin: "Launch at login",
	language: "Language",
	langSystem: "System",
	appearance: "Appearance",
	themeSystem: "System",
	themeLight: "Light",
	themeDark: "Dark",
	refreshEvery: "Refresh every",
	minutes: "{n} min",
	trayIcon: "Tray icon",
	iconAuto: "Match taskbar",
	iconAutoMac: "Match system",
	iconLight: "White",
	iconDark: "Black",
	showPercent: "Show % in menu bar",
	signInBrowser: "Sign in with browser",
	anotherAccountHint: "To add another account, sign out in the browser first or pick a different account on the sign-in page.",
	updateAvailable: "Version {v} is available",
	updateAvailableNoVersion: "A new version is available",
	updateNow: "Update",
	updateDownloading: "Downloading update…",
	updateInstalling: "Installing, AIUsageBar will restart…",
	updateFailed: "Update failed: {e}",
	about: "About",
	version: "Version {v}",
	checkUpdates: "Check for updates",
	upToDate: "Up to date",
	checking: "Checking…",
	ringColors: "Ring colours",
	colorDefault: "Default (matches the menu bar)",
	colorCustom: "Custom colour",
	alerts: "Notifications",
	alertLow: "Low limit alerts",
	alertThreshold: "When less than",
	alertThresholdHint: "One notification per limit; it re-arms after the limit resets.",
	percentLeft: "{n}% left",
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
	launchAtLogin: "Запуск при входе в систему",
	language: "Язык",
	langSystem: "Системный",
	appearance: "Оформление",
	themeSystem: "Системное",
	themeLight: "Светлое",
	themeDark: "Тёмное",
	refreshEvery: "Обновлять каждые",
	minutes: "{n} мин",
	trayIcon: "Иконка в трее",
	iconAuto: "Как панель задач",
	iconAutoMac: "Как в системе",
	iconLight: "Белая",
	iconDark: "Чёрная",
	showPercent: "Показывать % в строке меню",
	signInBrowser: "Войти через браузер",
	anotherAccountHint: "Чтобы добавить другой аккаунт, выйдите из текущего в браузере или выберите другой аккаунт на странице входа.",
	updateAvailable: "Доступна версия {v}",
	updateAvailableNoVersion: "Доступна новая версия",
	updateNow: "Обновить",
	updateDownloading: "Загрузка обновления…",
	updateInstalling: "Установка, AIUsageBar перезапустится…",
	updateFailed: "Не удалось обновиться: {e}",
	about: "О приложении",
	version: "Версия {v}",
	checkUpdates: "Проверить обновления",
	upToDate: "Установлена последняя версия",
	checking: "Проверка…",
	ringColors: "Цвет колец",
	colorDefault: "По умолчанию (как строка меню)",
	colorCustom: "Свой цвет",
	alerts: "Уведомления",
	alertLow: "Предупреждать о лимите",
	alertThreshold: "Когда осталось меньше",
	alertThresholdHint: "Одно уведомление на лимит; снова сработает после сброса.",
	percentLeft: "{n}%",
	quit: "Выйти из AIUsageBar",
	d: "д",
	h: "ч",
	m: "мин",
};

const systemLang = () => ((navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en");

export let locale: "en" | "ru" = systemLang();
let dict: Dict = locale === "ru" ? ru : en;
/** BCP 47 tag for dates and relative times. Keeps the OS locale when it matches the chosen language. */
let dateLocale = navigator.language;

/** Apply the language setting ("system" follows the OS). */
export function setLocale(pref: "system" | "en" | "ru") {
	locale = pref === "system" ? systemLang() : pref;
	dict = locale === "ru" ? ru : en;
	const sys = navigator.language || "en-US";
	dateLocale = sys.toLowerCase().startsWith(locale) ? sys : locale === "ru" ? "ru-RU" : "en-US";
	document.documentElement.lang = locale;
}

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
	const time = date.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" });
	if (sameDay) return time;
	return `${date.toLocaleDateString(dateLocale, { weekday: "short" })} ${time}`;
}

export function formatAgo(iso: string | undefined, now = Date.now()): string {
	if (!iso) return t("never");
	const ms = now - Date.parse(iso);
	if (ms < 60_000) return t("justNow");
	const rtf = new Intl.RelativeTimeFormat(dateLocale, { numeric: "auto" });
	const mins = Math.round(ms / 60_000);
	return mins < 60 ? rtf.format(-mins, "minute") : rtf.format(-Math.round(mins / 60), "hour");
}
