<div align="center">

<img src="assets/icon.png" width="112" alt="AIUsageBar icon" />

# AIUsageBar

**Лимиты ChatGPT и Claude в виде колец активности в строке меню и трее**

[![Build & Release](https://github.com/alxrepin/aiusagebar/actions/workflows/release.yml/badge.svg)](https://github.com/alxrepin/aiusagebar/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/alxrepin/aiusagebar?label=release&color=111)](https://github.com/alxrepin/aiusagebar/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-111?logo=windows)

[**Скачать**](https://github.com/alxrepin/aiusagebar/releases/latest) · [Как это работает](#как-это-работает) · [Приватность](#приватность) · [Разработка](#разработка)

[English](README.md) · **Русский**

</div>

<br />

<p align="center">
  <img src="docs/screenshots/ui-mac-two-light.png" width="260" alt="macOS, светлая тема" />
  &nbsp;
  <img src="docs/screenshots/ui-mac-two-dark.png" width="260" alt="macOS, тёмная тема" />
  &nbsp;
  <img src="docs/screenshots/ui-win-two-dark.png" width="260" alt="Windows 11, тёмная тема" />
</p>

Иконка в трее показывает, сколько лимита уже потрачено: чем больше заполнено кольцо, тем меньше осталось. Если кликнуть по иконке, откроется окно с каждым лимитом, процентами и временем до сброса.

<p align="center">
  <img src="docs/screenshots/tray-icons.png" width="620" alt="Варианты иконки в трее" />
</p>

## Возможности

- **Кольца как в Apple Fitness.** Иконка монохромная, в ней от 1 до 3 концентрических колец. На macOS она перекрашивается вместе со строкой меню, на Windows подстраивается под тему панели задач.
- **Раскладка колец выбирается сама:**
  - подключён один провайдер: сессионный (5-часовой) и недельный лимит;
  - подключено несколько: сессионный лимит каждого.
- **Ручная настройка.** В любое кольцо можно поставить любую метрику любого аккаунта, например «Claude · Weekly · Opus».
- **Подробности по клику:** проценты, прогресс-бары, «сброс через 2 ч 18 мин · 12:10», тариф (Plus, Pro, Max…).
- **Уведомление о заканчивающемся лимите.** Когда остаётся меньше заданного порога (по умолчанию 15%), приходит системное уведомление. На каждый лимит — одно уведомление; после сброса оно снова «взводится». Порог и сами уведомления настраиваются.
- **Фоновое обновление** раз в 1–30 минут. При открытии окна свежие данные подтягиваются сразу. Если API ответил ошибкой или «слишком много запросов», следующие попытки идут всё реже.
- **Несколько провайдеров и аккаунтов.** Добавляются и удаляются в два клика.
- **Выглядит как родное приложение:** Liquid Glass на macOS, Fluent на Windows 11, светлая и тёмная темы.
- **Лёгкое приложение.** Сделано на [Electrobun](https://electrobun.dev) и системном WebView, без встроенного Chromium.
- Интерфейс на русском и английском.

## Установка

Скачайте файл для своей системы со [страницы релизов](https://github.com/alxrepin/aiusagebar/releases/latest).

| Система | Файл |
| --- | --- |
| macOS (Apple Silicon) | `AIUsageBar-<версия>-macos-arm64.dmg` |
| Windows 10 / 11 (x64) | `AIUsageBar-<версия>-windows-x64-Setup.zip` |

<details>
<summary><b>macOS: «приложение повреждено» или «не удаётся проверить разработчика»</b></summary>

Релизы подписаны ad-hoc, но не нотаризованы Apple. После переноса в «Программы» выполните один раз:

```sh
xattr -dr com.apple.quarantine /Applications/AIUsageBar.app
```

Можно и так: правый клик по приложению → «Открыть» → «Открыть».
</details>

<details>
<summary><b>Windows: SmartScreen предупреждает о неизвестном издателе</b></summary>

Нажмите «Подробнее» → «Выполнить в любом случае». Сборка не подписана сертификатом издателя.
</details>

## Как это работает

При первом запуске откройте окно и подключите провайдера. Для каждого есть два способа.

| | Вход через браузер | Готовый логин CLI |
| --- | --- | --- |
| **Claude** | «Sign in with Claude»: откроется claude.ai | «Use Claude Code login»: берётся вход `claude` CLI |
| **ChatGPT** | «Sign in with ChatGPT»: откроется chatgpt.com | «Use Codex CLI login»: берётся `~/.codex/auth.json` |

**Вход через браузер** использует OAuth 2.0 с PKCE. Приложение ненадолго слушает `localhost`, браузер возвращает туда код авторизации, и приложение само обменивает его на токены. Токены потом обновляются автоматически. Сервер-посредник не нужен.

**Готовый логин CLI** только читается: токены Claude Code или Codex не меняются, и CLI продолжает работать как раньше.

Откуда берутся лимиты — из тех же эндпоинтов, что используют официальные CLI:

- Claude: `api.anthropic.com/api/oauth/usage`, отдаёт 5-часовой лимит, недельный и отдельно по Opus и Sonnet;
- ChatGPT: `chatgpt.com/backend-api/wham/usage`, отдаёт основное и дополнительное окно лимитов.

> [!NOTE]
> Эти эндпоинты не входят в публичный API и могут измениться. Адреса вынесены в константы `CLAUDE_OAUTH` и `CHATGPT_OAUTH`, чтобы их легко было поправить.

## Приватность

- **Сервера нет.** Приложение обращается только к OpenAI и Anthropic, прямо с вашего компьютера.
- **Нет телеметрии и аналитики.**
- **Токены лежат в системном хранилище секретов**, а в файле настроек их нет:

  | Система | Где хранятся токены |
  | --- | --- |
  | macOS | Связка ключей (login Keychain), сервис `AIUsageBar` |
  | Windows | Файл, зашифрованный DPAPI для текущего пользователя |
  | Linux | Secret Service / libsecret, без него — файл с правами `0600` |

- Когда вы удаляете аккаунт в настройках, его токены удаляются из хранилища.

## Настройки

Шестерёнка в окне открывает настройки:

- **Аккаунты:** список подключённых, удалить, добавить новый;
- **Кольца:** «Авто» или «Вручную» — выбор метрики для внешнего, среднего и внутреннего кольца;
- **Уведомления:** включить или выключить предупреждение о лимите и выбрать порог — 5, 10, 15, 20, 25, 30 или 50% остатка (по умолчанию 15%);
- **Обновлять каждые** 1, 2, 5, 10, 15 или 30 минут;
- **Иконка в трее** (Windows и Linux): как панель задач, белая или чёрная;
- **% в строке меню** (macOS): процент рядом с иконкой.

## Разработка

Нужен [Bun](https://bun.sh) версии 1.3 или новее.

```sh
git clone https://github.com/alxrepin/aiusagebar && cd aiusagebar
bun install

bun run dev          # собрать и запустить приложение
bun test             # юнит-тесты
bun run typecheck    # проверка типов
bun run preview      # окно в обычном браузере с тестовыми данными
                     # → http://localhost:5173/?platform=mac|win|linux&scenario=two|one|empty
bun run build:stable # установщик для текущей ОС → artifacts/
```

### Архитектура

```
src/
├─ shared/            типы и RPC-контракт между Bun и webview
├─ bun/               главный процесс
│  ├─ providers/      UsageProvider + реализации claude/ и chatgpt/
│  ├─ auth/           PKCE, loopback-листенер для OAuth
│  ├─ usage/          сервис аккаунтов и обновления, кольца, уведомления о лимитах
│  ├─ store/          config.json и хранилище секретов
│  ├─ tray/           растеризатор колец → PNG, контроллер иконки
│  └─ popover/        окно у иконки и расчёт его позиции
└─ views/popover/     интерфейс окна (TypeScript + DOM, без фреймворка)
```

Логика не зависит от Electrobun и покрыта тестами через `bun test`. От Electrobun зависят только `index.ts`, `popover.ts`, `trayController.ts` и `bridge.ts`.

### Как добавить провайдера

Пусть это будет, например, Gemini. Нужно сделать две вещи.

**1.** Реализовать `UsageProvider` в `src/bun/providers/gemini/index.ts`:

```ts
export class GeminiProvider implements UsageProvider {
  id = "gemini";
  displayName = "Gemini";
  iconPath = "M…";  // SVG path, 24×24, монохромный
  authMethods = [{ id: "oauth", label: "Sign in with Google", description: "…", kind: "browser" as const }];

  async authenticate(methodId, ctx) {
    // createPkce(), startLoopback() и ctx.openUrl уже готовы
    return { credentials: { … }, label: "me@gmail.com", identity: "<стабильный id>" };
  }

  async fetchUsage(credentials, ctx) {
    return {
      usage: {
        plan: "Pro",
        windows: [
          { id: "session", label: "Daily", shortLabel: "1d", kind: "short", usedPercent: 40, resetsAt: "…" },
        ],
      },
      credentials: rotated,  // если токены обновились
    };
  }
}
```

**2.** Добавить `new GeminiProvider()` в `src/bun/providers/registry.ts`.

Кнопки входа, карточки, выбор колец, фоновое обновление и хранение токенов заработают сами. Чтобы в карточке появилась кнопка «Войти заново», бросьте `ReauthRequiredError`. Чтобы включилась пауза между повторами, бросьте `RateLimitedError`.

### Релизы

Сборки и релизы делает GitHub Actions ([`release.yml`](.github/workflows/release.yml)):

1. Каждый push в `main` запускает проверку типов и тесты, затем сборку под **macOS (arm64)** и **Windows (x64)**.
2. Если версии из `package.json` ещё нет среди тегов, создаётся релиз `vX.Y.Z` с установщиками и автоматическими release notes.

Чтобы выпустить новую версию, поднимите `version` в `package.json` и смёржите изменения в `main`.

Подпись и нотаризация Apple необязательны. Чтобы их включить, добавьте в секреты репозитория `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_TEAMID`, `ELECTROBUN_APPLEID` и `ELECTROBUN_APPLEIDPASS`.

### Известные ограничения

- **Размытие под окном.** Liquid Glass сделан средствами CSS. Размывать сам рабочий стол за окном (`NSGlassEffectView`, Mica/Acrylic) Electrobun 1.x не умеет.
- **Linux.** Многие реализации AppIndicator не передают обычный клик, поэтому у иконки есть меню.
- **Не реализовано:** автозапуск при входе в систему и сборка для Intel Mac.

## Лицензия

[MIT](LICENSE). Используйте, меняйте и распространяйте свободно.

AIUsageBar — независимый проект, он не связан с OpenAI и Anthropic. ChatGPT и Claude — товарные знаки соответствующих владельцев.
