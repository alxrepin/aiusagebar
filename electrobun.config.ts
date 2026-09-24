import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json";

// Real Apple signing is opt-in: set ELECTROBUN_DEVELOPER_ID (and, for
// notarisation, ELECTROBUN_TEAMID + ELECTROBUN_APPLEID/ELECTROBUN_APPLEIDPASS)
// as CI secrets. Without them the app is ad-hoc signed in the postWrap hook.
const developerId = !!process.env.ELECTROBUN_DEVELOPER_ID;
const notarize = developerId && !!process.env.ELECTROBUN_TEAMID;

export default {
	app: {
		name: "AIUsageBar",
		identifier: "dev.aiusagebar.app",
		version: pkg.version,
		description: pkg.description,
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			popover: {
				entrypoint: "src/views/popover/index.ts",
			},
		},
		copy: {
			"src/views/popover/index.html": "views/popover/index.html",
			"src/views/popover/index.css": "views/popover/index.css",
		},
		mac: {
			// System WebKit keeps the bundle tiny; the popover only needs basic web APIs.
			defaultRenderer: "native",
			bundleCEF: false,
			icons: "assets/icon.iconset",
			codesign: developerId,
			notarize,
			createDmg: true,
		},
		win: {
			defaultRenderer: "native",
			bundleCEF: false,
			icon: "assets/icon.png",
		},
		linux: {
			defaultRenderer: "native",
			bundleCEF: false,
			icon: "assets/icon.png",
		},
	},
	scripts: {
		postWrap: "scripts/adhoc-sign.ts",
	},
	runtime: {
		// It's a tray app: hiding the popover must not quit it.
		exitOnLastWindowClosed: false,
	},
} satisfies ElectrobunConfig;
