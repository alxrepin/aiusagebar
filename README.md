# AIUsageBar

Показывает, сколько лимитов **ChatGPT** и **Claude** уже потрачено, в виде колец активности (как в Apple Fitness) прямо в строке меню macOS или в трее Windows / Linux. Иконка монохромная; чем больше заполнено кольцо, тем больше потрачено.

Клик по иконке открывает окно с подробностями: какие лимиты, сколько процентов потрачено и когда сброс.

| macOS · светлая | macOS · тёмная | Windows 11 · тёмная |
| --- | --- | --- |
| ![](docs/screenshots/ui-mac-two-light.png) | ![](docs/screenshots/ui-mac-two-dark.png) | ![](docs/screenshots/ui-win-two-dark.png) |

Иконка в трее: 1–3 концентрических кольца, заливка = потраченная доля лимита, трек = остаток:

![](docs/screenshots/tray-icons.png)

## Возможности

- **Кольца в трее.** Своя растеризация в PNG со сглаживанием. На macOS это template-изображение, система сама перекрашивает его под светлую или тёмную строку меню. На Windows цвет берётся из темы панели задач (или задаётся вручную).
- **Раскладка колец по умолчанию:**
  - подключён один провайдер: 2 кольца, сессионный («дневной», 5 ч) и недельный лимит;
  - подключено несколько: по одному кольцу на провайдера, сессионный лимит каждого.
- **Ручная настройка колец.** Для внешнего, среднего и внутреннего кольца можно выбрать любую метрику любого аккаунта, например «Claude · Weekly · Opus».
- **Фоновое обновление** раз в 1–30 мин (по умолчанию 5). При открытии окна устаревшие данные обновляются сразу. При ошибках интервал растёт экспоненциально, `Retry-After` на 429 учитывается.
- **Несколько провайдеров и аккаунтов**, добавление и удаление прямо из окна.
- **Стиль под платформу:** Liquid Glass на macOS (полупрозрачные слои, блик по краю, капсульные контролы), Fluent на Windows 11 (Segoe UI Variable, радиусы 8/4 px, тонкие прогресс-бары), нейтральный стиль на Linux. Светлая и тёмная темы.
- Интерфейс на русском и английском, язык берётся из системы.

## Авторизация без сервера

Сервера у приложения нет. Все запросы идут напрямую с компьютера пользователя к OpenAI и Anthropic.

| Провайдер | Способ | Как работает |
| --- | --- | --- |
| Claude | **Sign in with Claude** | OAuth 2.0 + PKCE с публичным клиентом Claude Code. Приложение поднимает одноразовый HTTP-листенер на `127.0.0.1:<случайный порт>/callback`, открывает `claude.ai/oauth/authorize` в браузере и обменивает код на токены. Refresh-токен обновляется автоматически. |
| Claude | **Use Claude Code login** | Читает существующий логин `claude` CLI: macOS Keychain `Claude Code-credentials` или `~/.claude/.credentials.json`. Только чтение, токены CLI не ротируются, чтобы CLI продолжал работать. |
| ChatGPT | **Sign in with ChatGPT** | OAuth 2.0 + PKCE с публичным клиентом Codex CLI. Callback на `localhost:1455/auth/callback`, это его зарегистрированный redirect. Refresh-токен обновляется автоматически. |
| ChatGPT | **Use Codex CLI login** | Читает `~/.codex/auth.json` (или `$CODEX_HOME/auth.json`), тоже только чтение. |

Лимиты берутся из тех же эндпоинтов, что используют сами CLI:
- Claude: `GET https://api.anthropic.com/api/oauth/usage` (`five_hour`, `seven_day`, `seven_day_opus`, …);
- ChatGPT: `GET https://chatgpt.com/backend-api/wham/usage` (`rate_limit.primary_window` / `secondary_window`).

**Где хранятся токены.** Токены лежат в системном хранилище секретов, в `config.json` их нет:

- macOS: login Keychain (сервис `AIUsageBar`), значение передаётся в `security` через stdin и не попадает в список процессов;
- Windows: файл, зашифрованный DPAPI для текущего пользователя;
- Linux: Secret Service / libsecret (`secret-tool`), без него — файл с правами `0600`.

> ⚠️ Эти эндпоинты и OAuth-клиенты не являются публичным API. Они стабильно работают в самих CLI, но формат может поменяться. Все URL и client id вынесены в константы `CLAUDE_OAUTH` / `CHATGPT_OAUTH`.

## Архитектура

```
src/
├─ shared/                  типы и RPC-контракт, общие для Bun и webview
│  ├─ types.ts              LimitWindow, UsageSnapshot, Settings, AppState…
│  └─ rpc.ts                PopoverRPC (запросы и сообщения в обе стороны)
├─ bun/                     главный процесс (Bun)
│  ├─ index.ts              точка входа: трей, окно, сервис
│  ├─ providers/
│  │  ├─ types.ts           интерфейс UsageProvider ← расширяется здесь
│  │  ├─ registry.ts        список провайдеров
│  │  ├─ claude/            OAuth, импорт из Claude Code, парсинг usage
│  │  └─ chatgpt/           OAuth, импорт из Codex CLI, парсинг usage
│  ├─ auth/oauth.ts         PKCE, loopback-листенер, decodeJwt
│  ├─ usage/
│  │  ├─ service.ts         аккаунты, секреты, фоновое обновление, backoff
│  │  └─ rings.ts           выбор метрик для колец (авто и ручной режим)
│  ├─ store/
│  │  ├─ config.ts          config.json: настройки, аккаунты, последний usage
│  │  └─ secrets.ts         Keychain / DPAPI / libsecret / файл
│  ├─ tray/
│  │  ├─ ringsIcon.ts       растеризатор колец (4×4 supersampling)
│  │  ├─ png.ts             минимальный PNG-энкодер
│  │  └─ trayController.ts  обновление иконки, цвет под тему
│  └─ popover/
│     ├─ popover.ts         окно у иконки, скрытие при потере фокуса, RPC-обработчики
│     └─ position.ts        расчёт позиции (меню сверху или панель задач снизу)
└─ views/popover/           UI окна: чистый TS + DOM, без фреймворка
   ├─ index.ts, i18n.ts, index.css, index.html
   └─ bridge.ts             Electrobun RPC (для превью подменяется моком)
```

Все модули, кроме `index.ts`, `popover.ts` и `trayController.ts`, не зависят от Electrobun и тестируются через `bun test`.

### Как добавить провайдера

1. Создать `src/bun/providers/<id>/index.ts` с классом, реализующим `UsageProvider`:

   ```ts
   export class GeminiProvider implements UsageProvider {
     id = "gemini";
     displayName = "Gemini";
     iconPath = "M…";                     // SVG path 24×24, монохром
     authMethods = [{ id: "oauth", label: "Sign in with Google", description: "…", kind: "browser" }];

     async authenticate(methodId, ctx) {
       // ctx.openUrl, ctx.fetch, ctx.signal; startLoopback() и createPkce() уже есть
       return { credentials: {...}, label: "me@gmail.com", identity: "<stable id>" };
     }

     async fetchUsage(credentials, ctx) {
       return {
         usage: { plan: "Pro", windows: [
           { id: "session", label: "Daily", shortLabel: "1d", kind: "short", usedPercent: 40, resetsAt: "…" },
         ]},
         credentials: rotated,           // если токены обновились
       };
     }
   }
   ```

2. Добавить экземпляр в `src/bun/providers/registry.ts`.

Всё остальное подхватится само: кнопки входа, карточки, выбор колец, фоновое обновление, хранение секретов. Если бросить `ReauthRequiredError`, в карточке появится кнопка «Войти заново». `RateLimitedError` включает backoff.

## Разработка

Нужен [Bun](https://bun.sh) ≥ 1.3.

```sh
bun install
bun run dev          # собрать и запустить приложение (Electrobun)
bun run build        # сборка .app / .exe / AppImage в build/
bun test             # юнит-тесты (провайдеры, OAuth, кольца, сервис, иконка, позиционирование)
bun run typecheck
bun run preview      # UI окна в обычном браузере с мок-данными:
                     # http://localhost:5173/?platform=mac|win|linux&scenario=two|one|empty
bun scripts/make-icons.ts   # пересобрать иконки приложения из растеризатора колец
```

### Про Electrobun

Используется **Electrobun 1.18.1**, последняя версия, где SDK распространяется через npm. Приложение берёт системный WebView (WKWebView / WebView2 / WebKitGTK) без CEF, поэтому бандл получается маленьким. В Electrobun 2.x SDK ставится через Hutch (`npx electrobun init`); переход затронет только `index.ts`, `popover.ts`, `trayController.ts` и `bridge.ts`.

### Известные ограничения

- **Размытие рабочего стола за окном.** Liquid Glass здесь сделан средствами CSS в прозрачном окне: полупрозрачные слои, блик, тени. Настоящее размытие того, что под окном (`NSGlassEffectView` / `NSVisualEffectView` на macOS, Acrylic/Mica на Windows), Electrobun 1.x не предоставляет. Прямой вызов AppKit из Bun небезопасен, потому что Bun работает не в главном потоке. Когда такой API появится, достаточно будет сделать фон `.panel` прозрачнее.
- **Linux.** Многие AppIndicator-реализации не передают обычный клик, поэтому у иконки есть меню «Показать / Обновить / Выйти».
- Автозапуск при входе в систему пока не реализован.
