<div align="center">

<img src="assets/icon.png" width="112" alt="AIUsageBar icon" />

# AIUsageBar

**Your ChatGPT and Claude usage limits as activity rings in the menu bar / system tray**

[![Build & Release](https://github.com/alxrepin/aiusagebar/actions/workflows/release.yml/badge.svg)](https://github.com/alxrepin/aiusagebar/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/alxrepin/aiusagebar?label=release&color=111)](https://github.com/alxrepin/aiusagebar/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-111?logo=windows)

[**Download**](https://github.com/alxrepin/aiusagebar/releases/latest) · [How it works](#how-it-works) · [Privacy](#privacy) · [Development](#development)

**English** · [Русский](README.ru.md)

</div>

<br />

<p align="center">
  <img src="docs/screenshots/ui-mac-two-light.png" width="260" alt="macOS, light" />
  &nbsp;
  <img src="docs/screenshots/ui-mac-two-dark.png" width="260" alt="macOS, dark" />
  &nbsp;
  <img src="docs/screenshots/ui-win-two-dark.png" width="260" alt="Windows 11, dark" />
</p>

The tray icon shows how much of each limit you have used: the fuller the ring, the less is left. Click it for the details: every limit, the percentage used and when it resets.

<p align="center">
  <img src="docs/screenshots/tray-icons.png" width="620" alt="Tray icon variants" />
</p>

## Features

- **Apple Fitness–style rings.** A monochrome icon with 1–3 concentric rings. On macOS it follows the menu bar appearance; on Windows it matches the taskbar theme.
- **Smart default layout:**
  - one provider connected: its session (5-hour) and weekly limits;
  - several providers: the session limit of each.
- **Fully customisable.** Put any metric of any account into any ring, e.g. "Claude · Weekly · Opus".
- **Details on click:** percentages, progress bars, "resets in 2h 18m · 12:10", your plan (Plus, Pro, Max…).
- **Low-limit alerts.** A system notification when less than a set share of a limit is left (15% by default). One notification per limit, re-armed after the limit resets. The threshold and the alerts themselves are configurable.
- **Background refresh** every 1–30 minutes, plus an instant refresh when you open the popover. Errors and rate limits back off exponentially.
- **Multiple providers and accounts**, added and removed in two clicks.
- **Feels native:** Liquid Glass on macOS, Fluent on Windows 11, light and dark themes.
- **Lightweight.** Built with [Electrobun](https://electrobun.dev) and the system WebView, no bundled Chromium.
- English and Russian UI.

## Install

Grab the file for your system from the [Releases page](https://github.com/alxrepin/aiusagebar/releases/latest).

| System | File |
| --- | --- |
| macOS (Apple Silicon) | `AIUsageBar-<version>-macos-arm64.dmg` |
| Windows 10 / 11 (x64) | `AIUsageBar-<version>-windows-x64-Setup.zip` |

<details>
<summary><b>macOS: "app is damaged" or "developer cannot be verified"</b></summary>

Releases are ad-hoc signed but not notarised by Apple. After moving the app to Applications, run once:

```sh
xattr -dr com.apple.quarantine /Applications/AIUsageBar.app
```

Or right-click the app → Open → Open.
</details>

<details>
<summary><b>Windows: SmartScreen warns about an unknown publisher</b></summary>

Click "More info" → "Run anyway". The build is not signed with a publisher certificate.
</details>

## How it works

On first launch, open the popover and connect a provider. Each provider offers two ways to sign in:

| | Browser sign-in | Existing CLI login |
| --- | --- | --- |
| **Claude** | "Sign in with Claude" opens claude.ai | "Use Claude Code login" reuses the `claude` CLI sign-in |
| **ChatGPT** | "Sign in with ChatGPT" opens chatgpt.com | "Use Codex CLI login" reuses `~/.codex/auth.json` |

**Browser sign-in** is OAuth 2.0 with PKCE. The app briefly listens on `localhost`, the browser redirects the authorization code there, and the app exchanges it for tokens itself. Tokens are refreshed automatically. No intermediate server.

**CLI login** is read-only: AIUsageBar never rotates Claude Code or Codex tokens, so your CLI keeps working.

Limits come from the same endpoints the official CLIs use:

- Claude: `api.anthropic.com/api/oauth/usage` — 5-hour, weekly, and per-model (Opus / Sonnet) limits;
- ChatGPT: `chatgpt.com/backend-api/wham/usage` — primary and secondary rate-limit windows.

> [!NOTE]
> These endpoints are not part of a public API and may change. Their URLs live in the `CLAUDE_OAUTH` and `CHATGPT_OAUTH` constants so they are easy to update.

## Privacy

- **No server.** The app only talks to OpenAI and Anthropic, directly from your computer.
- **No telemetry or analytics.**
- **Tokens live in the OS secret store**, never in the settings file:

  | System | Where tokens are stored |
  | --- | --- |
  | macOS | login Keychain, service `AIUsageBar` |
  | Windows | a file encrypted with DPAPI for the current user |
  | Linux | Secret Service / libsecret, falling back to a `0600` file |

- Removing an account in Settings deletes its tokens from the store.

## Settings

The gear icon in the popover opens Settings:

- **Accounts:** connected accounts, remove, add new;
- **Rings:** "Auto" or "Custom" — pick the metric for the outer, middle and inner ring;
- **Notifications:** turn low-limit alerts on or off and choose the threshold — 5, 10, 15, 20, 25, 30 or 50% left (default 15%);
- **Refresh every** 1, 2, 5, 10, 15 or 30 minutes;
- **Tray icon** (Windows / Linux): match taskbar, white or black;
- **% in menu bar** (macOS): show a percentage next to the icon.

## Development

Requires [Bun](https://bun.sh) 1.3 or newer.

```sh
git clone https://github.com/alxrepin/aiusagebar && cd aiusagebar
bun install

bun run dev          # build and launch the app
bun test             # unit tests
bun run typecheck    # type checking
bun run preview      # the popover in a regular browser with mock data
                     # → http://localhost:5173/?platform=mac|win|linux&scenario=two|one|empty
bun run build:stable # installer for the current OS → artifacts/
```

### Architecture

```
src/
├─ shared/            types and the RPC contract between Bun and the webview
├─ bun/               main process
│  ├─ providers/      UsageProvider + claude/ and chatgpt/ implementations
│  ├─ auth/           PKCE, loopback listener for OAuth
│  ├─ usage/          accounts & refresh service, rings, low-limit alerts
│  ├─ store/          config.json and the secret store
│  ├─ tray/           ring rasteriser → PNG, tray icon controller
│  └─ popover/        the popover window and its positioning
└─ views/popover/     popover UI (TypeScript + DOM, no framework)
```

The logic doesn't depend on Electrobun and is covered by `bun test`. Only `index.ts`, `popover.ts`, `trayController.ts` and `bridge.ts` touch Electrobun.

### Adding a provider

Say you want Gemini. Two steps:

**1.** Implement `UsageProvider` in `src/bun/providers/gemini/index.ts`:

```ts
export class GeminiProvider implements UsageProvider {
  id = "gemini";
  displayName = "Gemini";
  iconPath = "M…";  // SVG path, 24×24, monochrome
  authMethods = [{ id: "oauth", label: "Sign in with Google", description: "…", kind: "browser" as const }];

  async authenticate(methodId, ctx) {
    // createPkce(), startLoopback() and ctx.openUrl are ready to use
    return { credentials: { … }, label: "me@gmail.com", identity: "<stable id>" };
  }

  async fetchUsage(credentials, ctx) {
    return {
      usage: {
        plan: "Pro",
        windows: [
          { id: "session", label: "Daily", shortLabel: "1d", kind: "short", usedPercent: 40, resetsAt: "…" },
        ],
      },
      credentials: rotated,  // if tokens were refreshed
    };
  }
}
```

**2.** Add `new GeminiProvider()` to `src/bun/providers/registry.ts`.

Sign-in buttons, cards, ring selection, alerts, background refresh and token storage all work automatically. Throw `ReauthRequiredError` to show a "Sign in again" button on the card; throw `RateLimitedError` to back off.

### Releases

Builds and releases run on GitHub Actions ([`release.yml`](.github/workflows/release.yml)):

1. Every push to `main` runs the type check and tests, then builds for **macOS (arm64)** and **Windows (x64)**.
2. If the version in `package.json` has no tag yet, a `vX.Y.Z` release is published with the installers and generated release notes.

To ship a new version, bump `version` in `package.json` and merge into `main`.

Apple signing and notarisation are optional. To enable them, add `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_TEAMID`, `ELECTROBUN_APPLEID` and `ELECTROBUN_APPLEIDPASS` as repository secrets.

### Known limitations

- **No blur behind the window.** Liquid Glass is done in CSS; Electrobun 1.x can't blur the desktop behind a window (`NSGlassEffectView`, Mica/Acrylic).
- **Linux.** Many AppIndicator implementations don't deliver plain clicks, so the icon has a menu.
- **Not yet:** launch at login and an Intel Mac build.

## License

[MIT](LICENSE). Use, modify and share freely.

AIUsageBar is an independent project and is not affiliated with OpenAI or Anthropic. ChatGPT and Claude are trademarks of their respective owners.
