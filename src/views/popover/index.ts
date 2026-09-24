import type { AccountInfo, AppState, LimitWindow, ProviderInfo, RingRef } from "../../shared/types";
import { createBridge } from "./bridge";
import { formatAgo, formatDuration, formatResetAt, setLocale, t } from "./i18n";

const bridge = createBridge();

let state: AppState | null = null;
let view: "main" | "settings" = "main";
let confirmRemove: string | null = null;
/** In settings, providers are collapsed rows; the empty state shows them expanded. */
let expandedProvider: string | null = null;
const authErrors: Record<string, string | undefined> = {};
let refreshing = false;

// ---- tiny DOM helper --------------------------------------------------------

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string };

function h(tag: string, props: Props | null = null, ...children: Child[]): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props ?? {})) {
		if (v === undefined || v === null || v === false) continue;
		if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
		else if (k === "class") el.className = String(v);
		else if (k === "style") el.setAttribute("style", String(v));
		else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
		else el.setAttribute(k, v === true ? "" : String(v));
	}
	for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
	if (el.classList.contains("spinner")) syncAnimation(el, 800);
	return el;
}

/**
 * The popover re-renders its DOM on every state push (e.g. each download
 * percent), which would restart CSS animations and make spinners jerk.
 * A negative delay derived from the clock puts a freshly created element at
 * the same phase as the one it replaces, so the rotation looks continuous.
 */
function syncAnimation(el: Element, periodMs: number) {
	(el as HTMLElement | SVGElement).style.animationDelay = `-${Math.round(performance.now() % periodMs)}ms`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>, ...children: Element[]): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	el.append(...children);
	return el;
}

// ---- icons ------------------------------------------------------------------

const ICONS = {
	refresh: "M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
	gear: "M19.14 12.94a7.1 7.1 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2.4h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.88a.5.5 0 0 0 .12.64l2.03 1.58a7.1 7.1 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z",
	back: "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z",
	close: "M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z",
	power: "M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12a7 7 0 1 1-11.42-5.42L6.17 5.17A9 9 0 1 0 21 12a8.97 8.97 0 0 0-3.17-6.83z",
	plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
	download: "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z",
};

function icon(path: string, size = 16) {
	return svg("svg", { viewBox: "0 0 24 24", width: size, height: size, class: "icon", "aria-hidden": "true" }, svg("path", { d: path, fill: "currentColor" }));
}

function providerGlyph(p: ProviderInfo | undefined, size = 18) {
	return svg("svg", { viewBox: "0 0 24 24", width: size, height: size, class: "glyph" }, svg("path", { d: p?.iconPath ?? "", fill: "currentColor", "fill-rule": "evenodd" }));
}

// ---- rings (same geometry as the tray icon) ---------------------------------

/** `colors`: optional "#rrggbb" per ring; rings without one use the text ink. */
function ringsSvg(progress: (number | null)[], size: number, highlight?: number, colors?: (string | undefined)[]) {
	const n = Math.max(1, Math.min(3, progress.length || 2));
	const items = progress.length ? progress : [null, null];
	const s = size / 44;
	const width = [8.5, 7, 5.5][n - 1]! * s;
	const gap = [0, 2, 1.5][n - 1]! * s;
	let r = size / 2 - 0.75 * s - width / 2;
	const root = svg("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "rings" });
	items.forEach((p, i) => {
		const circ = 2 * Math.PI * r;
		const dim = highlight !== undefined && highlight !== i;
		const g = svg("g", { class: dim ? "ring dim" : "ring", transform: `rotate(-90 ${size / 2} ${size / 2})` });
		const color = colors?.[i];
		if (color) g.setAttribute("style", `color:${color}`);
		g.append(svg("circle", { cx: size / 2, cy: size / 2, r, "stroke-width": width, class: "track" }));
		if (p !== null && p > 0) {
			const len = Math.min(1, p) * circ;
			g.append(
				svg("circle", {
					cx: size / 2,
					cy: size / 2,
					r,
					"stroke-width": width,
					class: "fill",
					"stroke-dasharray": `${len} ${circ}`,
					"stroke-linecap": "round",
				}),
			);
		}
		root.append(g);
		r -= width + gap;
	});
	return root;
}

// ---- helpers ----------------------------------------------------------------

const providerOf = (id: string) => state?.providers.find((p) => p.id === id);
const pct = (n: number) => `${Math.round(n)}%`;

function resetText(w: Pick<LimitWindow, "resetsAt">) {
	if (!w.resetsAt) return t("resetUnknown");
	const ms = Date.parse(w.resetsAt) - Date.now();
	if (ms <= 0) return t("resetsAt", { t: formatResetAt(w.resetsAt) });
	return `${t("resetsIn", { t: formatDuration(ms) })} · ${formatResetAt(w.resetsAt)}`;
}

/** "5h · 2h 18m left" — compact, fits next to the big rings. */
function legendSub(r: AppState["rings"][number]) {
	if (r.progress === null) return `${r.shortLabel} · ${t("noData")}`;
	if (!r.resetsAt) return r.windowLabel;
	const ms = Date.parse(r.resetsAt) - Date.now();
	return `${r.shortLabel} · ↻ ${formatDuration(Math.max(0, ms))}`;
}

async function act<T>(fn: () => Promise<T>) {
	const result = await fn();
	if (result && typeof result === "object" && "accounts" in (result as object)) {
		state = result as unknown as AppState;
		render();
	}
	return result;
}

// ---- main view ---------------------------------------------------------------

function renderHeader() {
	const loading = refreshing || Object.values(state!.status).some((s) => s.state === "loading");
	return h(
		"header",
		{ class: "head" },
		h("div", { class: "title" }, t("title")),
		h(
			"div",
			{ class: "actions" },
			state!.accounts.length
				? h(
						"button",
						{
							class: `icon-btn${loading ? " spinning" : ""}`,
							title: t("refresh"),
							onClick: async () => {
								refreshing = true;
								render();
								await act(() => bridge.request.refresh({})).finally(() => {
									refreshing = false;
									render();
								});
							},
						},
						(() => {
							const i = icon(ICONS.refresh);
							if (loading) syncAnimation(i, 900);
							return i;
						})(),
					)
				: null,
			h("button", { class: "icon-btn", title: t("settings"), onClick: () => go("settings") }, icon(ICONS.gear)),
		),
	);
}

function renderSummary() {
	const rings = state!.rings;
	return h(
		"section",
		{ class: "summary glass" },
		ringsSvg(
			rings.map((r) => r.progress),
			84,
			undefined,
			rings.map((r) => r.color),
		),
		h(
			"div",
			{ class: "legend" },
			...rings.map((r, i) =>
				h(
					"div",
					{ class: "legend-row" },
					ringsSvg(
						rings.map(() => 1),
						14,
						i,
						rings.map((r) => r.color),
					),
					h(
						"div",
						{ class: "legend-text" },
						h("div", { class: "legend-label" }, ringOwner(r.providerId, r.ref.accountId)),
						h("div", { class: "legend-sub" }, legendSub(r)),
					),
					h("div", { class: "legend-value" }, r.progress === null ? "–" : pct(r.progress * 100)),
				),
			),
		),
	);
}

function renderAccountCard(a: AccountInfo) {
	const p = providerOf(a.providerId);
	const usage = state!.usage[a.id];
	const status = state!.status[a.id] ?? { state: "idle" };

	const color = state!.settings.providerColors[a.providerId];
	const limits = (usage?.windows ?? []).map((w) =>
		h(
			"div",
			{ class: "limit" },
			h("div", { class: "limit-row" }, h("span", { class: "limit-label" }, w.label), h("span", { class: "limit-pct" }, pct(w.usedPercent))),
			h(
				"div",
				{ class: "bar", style: color ? `--bar-color:${color}` : undefined },
				h("i", { style: `width:${Math.max(0, Math.min(100, w.usedPercent))}%` }),
			),
			h("div", { class: "limit-meta" }, resetText(w)),
		),
	);

	return h(
		"article",
		{ class: "card glass" },
		h(
			"div",
			{ class: "card-head" },
			providerGlyph(p),
			h("div", { class: "card-title" }, h("div", { class: "name" }, p?.displayName ?? a.providerId), h("div", { class: "sub" }, a.label)),
			usage?.plan ? h("span", { class: "pill" }, usage.plan) : null,
			status.state === "loading" ? h("span", { class: "spinner", title: t("loading") }) : null,
		),
		status.state === "error"
			? h(
					"div",
					{ class: "error" },
					h("span", null, status.message),
					status.needsReauth ? renderReauthButtons(a, p) : null,
				)
			: null,
		...(limits.length ? limits : status.state !== "error" ? [h("div", { class: "limit-meta" }, status.state === "loading" ? t("loading") : t("noData"))] : []),
	);
}

/** "Sign in again" for OAuth accounts; CLI-linked ones also get a browser sign-in fallback. */
function renderReauthButtons(a: AccountInfo, p: ProviderInfo | undefined) {
	const own = p?.authMethods.find((m) => m.id === a.authMethod);
	const browser = p?.authMethods.find((m) => m.kind === "browser");
	if (!own || own.kind === "browser" || !browser) {
		return h("button", { class: "btn small", onClick: () => startAuth(a.providerId, a.authMethod) }, t("reconnect"));
	}
	return h(
		"div",
		{ class: "reauth" },
		h("button", { class: "btn small primary", onClick: () => startAuth(a.providerId, browser.id) }, t("signInBrowser")),
		h("button", { class: "btn small", title: own.description, onClick: () => startAuth(a.providerId, own.id) }, t("reconnect")),
	);
}

/** Provider name, plus the account when several accounts of that provider are connected. */
function ringOwner(providerId: string, accountId: string) {
	const name = providerOf(providerId)?.displayName ?? providerId;
	const same = state!.accounts.filter((a) => a.providerId === providerId);
	if (same.length < 2) return name;
	const label = state!.accounts.find((a) => a.id === accountId)?.label ?? "";
	return `${name} · ${label.split("@")[0]}`;
}

function renderEmpty() {
	return h(
		"section",
		{ class: "empty" },
		ringsSvg([null, null], 72),
		h("h2", null, t("emptyTitle")),
		h("p", null, t("emptyBody")),
		renderAddProviders(),
	);
}

function renderUpdateBanner() {
	const u = state!.update;
	const visible = ["available", "downloading", "installing"].includes(u?.status) || (u?.status === "error" && !!u.availableVersion);
	if (!visible) return null;
	const busy = u.status === "downloading" || u.status === "installing";
	const text =
		busy
			? updateProgressText(u)
			: u.status === "error"
					? t("updateFailed", { e: u.error ?? "" })
					: u.availableVersion
						? t("updateAvailable", { v: u.availableVersion })
						: t("updateAvailableNoVersion");
	return h(
		"div",
		{ class: "banner glass" },
		busy ? h("span", { class: "spinner" }) : icon(ICONS.download),
		h("span", { class: "banner-text" }, text),
		busy ? null : h("button", { class: "btn small primary", onClick: () => runUpdateAction("install") }, t("updateNow")),
	);
}

function renderMain() {
	const s = state!;
	if (!s.accounts.length) return [renderHeader(), renderUpdateBanner(), renderEmpty()];
	return [
		renderHeader(),
		renderUpdateBanner(),
		renderSummary(),
		h("div", { class: "cards" }, ...s.accounts.map(renderAccountCard)),
		h("footer", { class: "foot" }, t("updated", { t: formatAgo(s.lastRefreshAt) })),
	];
}

// ---- settings view -------------------------------------------------------------

async function startAuth(providerId: string, methodId: string) {
	authErrors[providerId] = undefined;
	render();
	const res = await bridge.request.startAuth({ providerId, methodId });
	if (!res.ok) authErrors[providerId] = res.error;
	else expandedProvider = null;
	state = await bridge.request.getState({});
	render();
}

function renderAuthMethods(p: ProviderInfo) {
	if (state!.pendingAuth[p.id]) {
		return h(
			"div",
			{ class: "pending" },
			h("span", { class: "spinner" }),
			h("span", null, t("waitingBrowser")),
			h("button", { class: "btn small ghost", onClick: () => bridge.request.cancelAuth({ providerId: p.id }) }, t("cancel")),
		);
	}
	return h(
		"div",
		{ class: "methods" },
		...p.authMethods.map((m, i) =>
			h("button", { class: `btn${i === 0 ? " primary" : ""}`, title: m.description, onClick: () => startAuth(p.id, m.id) }, m.label),
		),
	);
}

/** Expanded provider cards, used on the empty screen. */
function renderAddProviders() {
	return h(
		"div",
		{ class: "providers" },
		...state!.providers.map((p) =>
			h(
				"div",
				{ class: "provider glass" },
				h("div", { class: "provider-head" }, providerGlyph(p, 20), h("span", { class: "name" }, p.displayName)),
				renderAuthMethods(p),
				authErrors[p.id] ? h("div", { class: "error" }, authErrors[p.id]) : null,
			),
		),
	);
}

/** Compact list for settings: one row per provider, expands to its sign-in options. */
function renderAddProviderRows() {
	return h(
		"div",
		{ class: "list glass" },
		...state!.providers.map((p) => {
			const open = expandedProvider === p.id || !!state!.pendingAuth[p.id] || !!authErrors[p.id];
			return h(
				"div",
				{ class: "row-group" },
				h(
					"div",
					{ class: "row" },
					providerGlyph(p),
					h("div", { class: "row-text" }, h("div", { class: "name" }, p.displayName)),
					h(
						"button",
						{
							class: `icon-btn${open ? " open" : ""}`,
							title: t("addAccount"),
							onClick: () => {
								expandedProvider = open ? null : p.id;
								authErrors[p.id] = undefined;
								render();
							},
						},
						icon(ICONS.plus),
					),
				),
				open
					? h(
							"div",
							{ class: "row-body" },
							state!.accounts.some((a) => a.providerId === p.id) ? h("div", { class: "hint flush" }, t("anotherAccountHint")) : null,
							renderAuthMethods(p),
							authErrors[p.id] ? h("div", { class: "error" }, authErrors[p.id]) : null,
						)
					: null,
			);
		}),
	);
}

function segmented<T extends string>(value: T, options: Array<[T, string]>, onChange: (v: T) => void) {
	return h(
		"div",
		{ class: "segmented", role: "radiogroup" },
		...options.map(([v, label]) =>
			h(
				"button",
				{
					class: v === value ? "seg active" : "seg",
					role: "radio",
					"aria-checked": String(v === value),
					onClick: () => v !== value && onChange(v),
				},
				label,
			),
		),
	);
}

function select(value: string, options: Array<[string, string]>, onChange: (v: string) => void) {
	const el = h("select", { class: "select", onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }) as HTMLSelectElement;
	for (const [v, label] of options) el.append(h("option", { value: v, selected: v === value }, label));
	return el;
}

function ringOptions(): Array<[string, string]> {
	const s = state!;
	const opts: Array<[string, string]> = [["", t("ringEmpty")]];
	for (const a of s.accounts) {
		const p = providerOf(a.providerId)?.displayName ?? a.providerId;
		const windows = s.usage[a.id]?.windows ?? [
			{ id: "session", label: "Session" },
			{ id: "weekly", label: "Weekly" },
		];
		const multi = s.accounts.filter((x) => x.providerId === a.providerId).length > 1;
		for (const w of windows) opts.push([`${a.id}|${w.id}`, `${p}${multi ? ` (${a.label})` : ""} · ${w.label}`]);
	}
	return opts;
}

/** Show the spinner immediately on click, before the host reports back. */
function runUpdateAction(action: "check" | "install") {
	const u = state!.update;
	state = { ...state!, update: { ...u, status: action === "check" ? "checking" : "downloading", progress: undefined, error: undefined } };
	render();
	void act(() => (action === "check" ? bridge.request.checkForUpdates({}) : bridge.request.installUpdate({})));
}

function updateProgressText(u: AppState["update"]) {
	if (u.status === "downloading") return `${t("updateDownloading")}${u.progress != null ? ` ${u.progress}%` : ""}`;
	if (u.status === "installing") return t("updateInstalling");
	return t("checking");
}

function renderAbout() {
	const u = state!.update;
	const busy = u.status === "checking" || u.status === "downloading" || u.status === "installing";
	const status = busy
		? updateProgressText(u)
		: u.status === "none"
			? t("upToDate")
			: u.status === "available"
				? t("updateAvailable", { v: u.availableVersion ?? "" })
				: u.status === "error"
					? t("updateFailed", { e: u.error ?? "" })
					: "";
	return h(
		"section",
		{ class: "group" },
		h("h3", null, t("about")),
		h(
			"div",
			{ class: "list glass" },
			h(
				"div",
				{ class: "row" },
				h(
					"div",
					{ class: "row-text" },
					h("div", { class: "name" }, t("version", { v: u.currentVersion || "—" })),
					status ? h("div", { class: "sub" }, status) : null,
				),
				busy
					? h("span", { class: "spinner", title: status })
					: u.status === "available"
						? h("button", { class: "btn small primary", onClick: () => runUpdateAction("install") }, t("updateNow"))
						: h("button", { class: "btn small", onClick: () => runUpdateAction("check") }, t("checkUpdates")),
			),
			u.status === "downloading" || u.status === "installing" ? renderUpdateProgress(u) : null,
		),
	);
}

/** Thin bar under the row; indeterminate until the download size is known. */
function renderUpdateProgress(u: AppState["update"]) {
	const known = u.progress != null;
	return h(
		"div",
		{ class: "update-progress" },
		h(
			"div",
			{ class: known ? "bar" : "bar indeterminate" },
			(() => {
				const fill = h("i", { style: known ? `width:${u.progress}%` : "" });
				if (!known) syncAnimation(fill, 1100);
				return fill;
			})(),
		),
	);
}

const SWATCHES = ["#fa114f", "#ff9f0a", "#ffd60a", "#92e82a", "#1eeaef", "#0a84ff", "#bf5af2"];

/** Per-provider ring colour: default (monochrome), a preset or a custom colour. */
function renderColors() {
	const s = state!;
	const providerIds = [...new Set(s.accounts.map((a) => a.providerId))];
	if (!providerIds.length) return null;
	const setColor = (providerId: string, color: string | null) => {
		const next = { ...s.settings.providerColors };
		if (color) next[providerId] = color;
		else delete next[providerId];
		void act(() => bridge.request.updateSettings({ providerColors: next }));
	};
	return h(
		"section",
		{ class: "group" },
		h("h3", null, t("ringColors")),
		h(
			"div",
			{ class: "list glass" },
			...providerIds.map((id) => {
				const p = providerOf(id);
				const current = s.settings.providerColors[id];
				const custom = current && !SWATCHES.includes(current) ? current : undefined;
				return h(
					"div",
					{ class: "row color-row" },
					providerGlyph(p),
					h("div", { class: "row-text" }, h("div", { class: "name" }, p?.displayName ?? id)),
					h(
						"div",
						{ class: "swatches", role: "radiogroup" },
						h("button", {
							class: `swatch default${!current ? " active" : ""}`,
							title: t("colorDefault"),
							"aria-checked": String(!current),
							role: "radio",
							onClick: () => setColor(id, null),
						}),
						...SWATCHES.map((c) =>
							h("button", {
								class: `swatch${current === c ? " active" : ""}`,
								style: `--swatch:${c}`,
								title: c,
								role: "radio",
								"aria-checked": String(current === c),
								onClick: () => setColor(id, c),
							}),
						),
						h(
							"label",
							{ class: `swatch custom${custom ? " active" : ""}`, title: t("colorCustom"), style: custom ? `--swatch:${custom}` : undefined },
							h("input", {
								type: "color",
								value: current ?? "#ffffff",
								onChange: (e: Event) => setColor(id, (e.target as HTMLInputElement).value),
							}),
						),
					),
				);
			}),
		),
	);
}

/** Preset thresholds, plus the current value if it was set to something custom. */
function thresholdOptions(current: number) {
	const presets = [5, 10, 15, 20, 25, 30, 50];
	return presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
}

function renderSettings() {
	const s = state!;
	const refValue = (r: RingRef | null | undefined) => (r ? `${r.accountId}|${r.windowId}` : "");
	const currentRefs = s.settings.ringMode === "custom" ? s.settings.rings : s.rings.map((r) => r.ref);
	const opts = ringOptions();

	const accountRows = s.accounts.map((a) => {
		const p = providerOf(a.providerId);
		const method = p?.authMethods.find((m) => m.id === a.authMethod)?.label ?? a.authMethod;
		return h(
			"div",
			{ class: "row" },
			providerGlyph(p),
			h("div", { class: "row-text" }, h("div", { class: "name" }, `${p?.displayName ?? a.providerId} · ${a.label}`), h("div", { class: "sub" }, method)),
			confirmRemove === a.id
				? h(
						"button",
						{
							class: "btn small danger",
							onClick: async () => {
								confirmRemove = null;
								await act(() => bridge.request.removeAccount({ accountId: a.id }));
							},
						},
						t("removeConfirm"),
					)
				: h(
						"button",
						{
							class: "btn small ghost",
							onClick: () => {
								confirmRemove = a.id;
								render();
							},
						},
						t("remove"),
					),
		);
	});

	const ringLabels = [t("ringOuter"), t("ringMiddle"), t("ringInner")];

	return [
		h(
			"header",
			{ class: "head" },
			h("button", { class: "icon-btn", title: t("back"), onClick: () => go("main") }, icon(ICONS.back)),
			h("div", { class: "title" }, t("settings")),
			h("div", { class: "actions" }),
		),
		s.accounts.length
			? h("section", { class: "group" }, h("h3", null, t("accounts")), h("div", { class: "list glass" }, ...accountRows))
			: null,
		h("section", { class: "group" }, h("h3", null, t("addAccount")), renderAddProviderRows()),
		s.accounts.length
			? h(
					"section",
					{ class: "group" },
					h("h3", null, t("rings")),
					h(
						"div",
						{ class: "list glass" },
						h(
							"div",
							{ class: "row" },
							segmented(s.settings.ringMode, [
								["auto", t("ringsAuto")],
								["custom", t("ringsCustom")],
							], (v) => act(() => bridge.request.updateSettings({ ringMode: v }))),
						),
						s.settings.ringMode === "auto" ? h("div", { class: "hint" }, t("ringsAutoHint")) : null,
						...[0, 1, 2].map((slot) =>
							h(
								"div",
								{ class: "row" },
								h("span", { class: "ring-slot", title: ringLabels[slot] }, ringsSvg([1, 1, 1], 18, slot)),
								select(refValue(currentRefs[slot]), opts, (v) => {
									const [accountId, windowId] = v.split("|");
									void act(() => bridge.request.setRing({ slot, ref: accountId && windowId ? { accountId, windowId } : null }));
								}),
							),
						),
					),
				)
			: null,
		renderColors(),
		h(
			"section",
			{ class: "group" },
			h("h3", null, t("alerts")),
			h(
				"div",
				{ class: "list glass" },
				h(
					"label",
					{ class: "row" },
					h("div", { class: "row-text" }, h("div", { class: "name" }, t("alertLow"))),
					h("input", {
						type: "checkbox",
						class: "switch",
						checked: s.settings.alertsEnabled,
						onChange: (e: Event) => act(() => bridge.request.updateSettings({ alertsEnabled: (e.target as HTMLInputElement).checked })),
					}),
				),
				s.settings.alertsEnabled
					? h(
							"div",
							{ class: "row" },
							h("div", { class: "row-text" }, h("div", { class: "name" }, t("alertThreshold"))),
							select(
								String(s.settings.alertThreshold),
								thresholdOptions(s.settings.alertThreshold).map((n) => [String(n), t("percentLeft", { n })]),
								(v) => act(() => bridge.request.updateSettings({ alertThreshold: Number(v) })),
							),
						)
					: null,
				s.settings.alertsEnabled ? h("div", { class: "hint" }, t("alertThresholdHint")) : null,
			),
		),
		h(
			"section",
			{ class: "group" },
			h("h3", null, t("general")),
			h(
				"div",
				{ class: "list glass" },
				h(
					"div",
					{ class: "row stacked" },
					h("div", { class: "row-text" }, h("div", { class: "name" }, t("appearance"))),
					segmented(s.settings.theme, [
						["system", t("themeSystem")],
						["light", t("themeLight")],
						["dark", t("themeDark")],
					], (v) => act(() => bridge.request.updateSettings({ theme: v }))),
				),
				h(
					"div",
					{ class: "row" },
					h("div", { class: "row-text" }, h("div", { class: "name" }, t("language"))),
					// Language names are shown in their own language so they're recognisable either way.
					select(
						s.settings.language,
						[
							["system", t("langSystem")],
							["en", "English"],
							["ru", "Русский"],
						],
						(v) => act(() => bridge.request.updateSettings({ language: v as AppState["settings"]["language"] })),
					),
				),
				h(
					"label",
					{ class: "row" },
					h("div", { class: "row-text" }, h("div", { class: "name" }, t("launchAtLogin"))),
					h("input", {
						type: "checkbox",
						class: "switch",
						checked: s.settings.launchAtLogin,
						onChange: (e: Event) => act(() => bridge.request.updateSettings({ launchAtLogin: (e.target as HTMLInputElement).checked })),
					}),
				),
				h(
					"div",
					{ class: "row" },
					h("div", { class: "row-text" }, h("div", { class: "name" }, t("refreshEvery"))),
					select(
						String(s.settings.refreshMinutes),
						[1, 2, 5, 10, 15, 30].map((n) => [String(n), t("minutes", { n })]),
						(v) => act(() => bridge.request.updateSettings({ refreshMinutes: Number(v) })),
					),
				),
				s.platform === "mac"
					? h(
							"label",
							{ class: "row" },
							h("div", { class: "row-text" }, h("div", { class: "name" }, t("showPercent"))),
							h("input", {
								type: "checkbox",
								class: "switch",
								checked: s.settings.showPercentInMenuBar,
								onChange: (e: Event) => act(() => bridge.request.updateSettings({ showPercentInMenuBar: (e.target as HTMLInputElement).checked })),
							}),
						)
					: null,
				// macOS only needs this when provider colours are used (then the icon isn't a template).
				s.platform !== "mac" || Object.keys(s.settings.providerColors).length
					? h(
							"div",
							{ class: "row" },
							h("div", { class: "row-text" }, h("div", { class: "name" }, t("trayIcon"))),
							select(
								s.settings.iconTheme,
								[
									["auto", s.platform === "mac" ? t("iconAutoMac") : t("iconAuto")],
									["light", t("iconLight")],
									["dark", t("iconDark")],
								],
								(v) => act(() => bridge.request.updateSettings({ iconTheme: v as AppState["settings"]["iconTheme"] })),
							),
						)
					: null,
			),
		),
		renderAbout(),
		h(
			"footer",
			{ class: "foot" },
			h("button", { class: "btn ghost quit", onClick: () => bridge.request.quit({}) }, icon(ICONS.power, 14), t("quit")),
		),
	];
}

// ---- render loop ---------------------------------------------------------------

const root = document.getElementById("app")!;
const content = h("div", { class: "content" });
// .panel = fixed frame (background, rim, shadow); .scroller = what actually scrolls.
const scroller = h("div", { class: "scroller" }, content);
const panel = h("div", { class: "panel" }, scroller);
root.append(panel);

function go(v: typeof view) {
	view = v;
	confirmRemove = null;
	render();
	scroller.scrollTop = 0;
}

// ---- theme & language ------------------------------------------------------------

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

/** Applies the language and theme settings ("system" follows the OS). */
function applyPrefs() {
	if (!state) return;
	const { language, theme } = state.settings;
	setLocale(language);
	const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
	document.documentElement.dataset.theme = dark ? "dark" : "light";
}

darkQuery.addEventListener("change", () => {
	if (state?.settings.theme === "system") applyPrefs();
});

function render() {
	if (!state) return;
	applyPrefs();
	document.documentElement.dataset.platform = state.platform;
	const scroll = scroller.scrollTop;
	content.replaceChildren(...(view === "main" ? renderMain() : renderSettings()).filter((n): n is HTMLElement => !!n));
	scroller.scrollTop = scroll;
}

// Tell the host how tall we are so the native window hugs the content.
// (--window-pad depends on data-platform, which is set on the first render.)
const windowPadding = () => 2 * parseInt(getComputedStyle(document.documentElement).getPropertyValue("--window-pad") || "0", 10);
let lastHeight = 0;
new ResizeObserver(() => {
	const frame = getComputedStyle(panel);
	const inner = getComputedStyle(scroller);
	const chrome =
		parseFloat(frame.borderTopWidth) + parseFloat(frame.borderBottomWidth) + parseFloat(inner.paddingTop) + parseFloat(inner.paddingBottom);
	const height = Math.ceil(content.offsetHeight + chrome + windowPadding());
	if (Math.abs(height - lastHeight) > 1) {
		lastHeight = height;
		bridge.send.resize({ height });
	}
}).observe(content);

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		if (view === "settings") go("main");
		else bridge.send.hide({});
	}
});

bridge.on("events", {
	state: (s) => {
		state = s;
		render();
	},
	shown: () => {
		// Give the page keyboard/wheel focus (Windows doesn't always hand it over).
		window.focus();
		if (view !== "main") go("main");
	},
});

// Keep relative times ("resets in 12m") fresh while open.
setInterval(render, 30_000);

void bridge.request.getState({}).then((s) => {
	state = s;
	render();
});
