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
- **Multiple providers and accounts**, including several accounts of the same provider (e.g. work and personal Claude), added and removed in two clicks.
- **Self-healing connections.** Expired tokens are refreshed automatically (on 401 and 403). If a sign-in really is gone, the card shows "Sign in again" and you get a single notification. After sleep or a network change the data refreshes right away.
- **Starts with your computer** (can be turned off in Settings).
- **Automatic updates.** The app checks GitHub Releases every few hours, shows an "Update" button and restarts into the new version.
- **Feels native:** Liquid Glass on macOS, Fluent on Windows 11, light and dark themes.
- **Lightweight.** Built with [Electrobun](https://electrobun.dev) and the system WebView, no bundled Chromium.
- English and Russian UI.

## Install

**The easiest way** is one command. It downloads the latest release and installs it without Gatekeeper / SmartScreen prompts:

```sh
# macOS (Apple Silicon)
curl -fsSL https://raw.githubusercontent.com/alxrepin/aiusagebar/main/scripts/install.sh | bash
```

```powershell
# Windows 10 / 11 (PowerShell)
irm https://raw.githubusercontent.com/alxrepin/aiusagebar/main/scripts/install.ps1 | iex
```

Or grab the file for your system from the [Releases page](https://github.com/alxrepin/aiusagebar/releases/latest):

| System | File |
| --- | --- |
| macOS (Apple Silicon) | `AIUsageBar-<version>-macos-arm64.dmg` |
| Windows 10 / 11 (x64) | `AIUsageBar-<version>-windows-x64-Setup.zip` |

Once installed, AIUsageBar **updates itself**: when a new version is out, the popover shows an **Update** button.

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

<details>
<summary><b>Why do the prompts appear, and why doesn't the install script trigger them?</b></summary>

macOS and Windows flag files downloaded by a **browser** (quarantine attribute / "Mark of the Web") and then check them for an Apple notarisation ticket or a code-signing certificate. AIUsageBar is free and doesn't have either (an Apple Developer ID costs $99/year; a Windows certificate is similar). Files downloaded by `curl` or PowerShell aren't flagged, so the install script and the in-app updater never hit the prompt. You only deal with it once, if you install from the browser.
</details>

## How it works

On first launch, open the popover and connect a provider. Each provider offers two ways to sign in:

| | Browser sign-in | Existing CLI login |
| --- | --- | --- |
| **Claude** | "Sign in with Claude" opens claude.ai | "Use Claude Code login" reuses the `claude` CLI sign-in |
| **ChatGPT** | "Sign in with ChatGPT" opens chatgpt.com | "Use Codex CLI login" reuses `~/.codex/auth.json` |

**Browser sign-in** is OAuth 2.0 with PKCE. The app briefly listens on `localhost`, the browser redirects the authorization code there, and the app exchanges it for tokens itself. Tokens are refreshed automatically. No intermediate server.

**CLI login** is read-only: AIUsageBar never rotates Claude Code or Codex tokens, so your CLI keeps working.

**Several accounts of one provider.** Click **+** next to the provider in Settings again. For ChatGPT the sign-in page asks which account to use; for Claude, sign out on claude.ai first (or pick another account there). Accounts are told apart by their provider account id, so reconnecting the same account updates it instead of creating a duplicate.

**When an API stops answering.** On 401/403 the app refreshes the token and retries. If the refresh is rejected, the card switches to "Sign in again" (CLI-linked accounts also get "Sign in with browser"), and a notification is shown once. Other errors (network, 5xx, 429) keep the last known data on screen and retry with growing pauses (1 → 30 min, honouring `Retry-After`).

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
- **Launch at login:** on by default;
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
2. If the version in `package.json` has no tag yet, a `vX.Y.Z` release is published with the installers, the in-app update feed (`stable-<os>-<arch>-update.json` + bundle) and generated release notes. Installed apps pick it up from `releases/latest/download/`.

To ship a new version, bump `version` in `package.json` and merge into `main`.

Apple signing and notarisation are optional. To enable them, add `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_TEAMID`, `ELECTROBUN_APPLEID` and `ELECTROBUN_APPLEIDPASS` as repository secrets.

### Known limitations

- **No blur behind the window.** Liquid Glass is done in CSS with a near-opaque tint; Electrobun 1.x can't blur the desktop behind a window (`NSGlassEffectView`, Mica/Acrylic), and CSS `backdrop-filter` in a transparent WebView flickers, so it isn't used.
- **Linux.** Many AppIndicator implementations don't deliver plain clicks, so the icon has a menu.
- **Not yet:** an Intel Mac build.
- Versions before 0.3.0 have no updater: install 0.3.0 once, updates are automatic from then on.

## License

[MIT](LICENSE). Use, modify and share freely.

AIUsageBar is an independent project and is not affiliated with OpenAI or Anthropic. ChatGPT and Claude are trademarks of their respective owners.
