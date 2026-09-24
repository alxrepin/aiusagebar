import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "AIUsageBar",
		identifier: "dev.aiusagebar.app",
		version: "0.1.0",
		description: "ChatGPT & Claude limits as activity rings in your menu bar / tray.",
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
	runtime: {
		// It's a tray app: hiding the popover must not quit it.
		exitOnLastWindowClosed: false,
	},
} satisfies ElectrobunConfig;
