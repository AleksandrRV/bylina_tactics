# Запуск, сборка и публикация

Предмет ведения: среда разработки, команды, проверка, GitHub Pages и установка PWA. Правила игры и устройство модулей не входят.

Реализация: `app/` (pnpm), `.github/workflows/deploy-pages.yml`, `app/apps/game-pwa/vite.config.ts` (`BASE_PATH`).

---

## 1. Среда

| Состав | Минимум |
|---|---|
| Система | Windows 10 1903+ x64; также macOS/Linux |
| Обозреватель | Chrome 120+ или Edge 120+ |
| Node.js | 20 LTS (64-bit) |
| pnpm | 9 или 10 (Corepack) |
| Диск | ≥ 1 ГБ свободно |

Права администратора — только на установку Node.js.

### 1.1. Node.js (Windows)

1. Скачать **20 LTS** x64 с [https://nodejs.org/](https://nodejs.org/).
2. Установить с отметкой `PATH`. Открыть **новое** окно PowerShell:

```powershell
node -v
npm -v
```

При отказе «running scripts is disabled»:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 1.2. pnpm

```powershell
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm -v
```

Версия закреплена полем `packageManager` в `app/package.json`. Если Corepack
показывает другую версию, повторите команду выше; это снижает риск отличий
в lockfile и поведении workspace-команд. Если `corepack` недоступен:
`npm install -g pnpm@10.34.5`.

---

## 2. Установка зависимостей

Команды — из каталога `app` (рядом на уровень выше лежит `doc`):

```powershell
cd C:\path\to\bylina\app
pnpm install
```

Не смешивать с `npm install` в этом репозитории.

---

## 3. Команды

| Команда | Назначение |
|---|---|
| `pnpm dev` | Сервер разработки (`http://127.0.0.1:5173/`) |
| `pnpm test` | Автоматические проверки |
| `pnpm typecheck` | Проверка типов |
| `pnpm build` | Производственная сборка PWA |
| `pnpm preview` | Просмотр сборки (`http://127.0.0.1:4173/`) |

Остановка: `Ctrl+C`. Если порт занят — открывать адрес из вывода сборщика.

Проверка версии и окружения:

```powershell
pnpm check:versions
node --version       # должен быть >= 20
pnpm --version       # должен соответствовать packageManager
```

Команду `check:versions` полезно выполнять до `build` и перед публикацией.

---

## 4. Проверка перед работой

После `pnpm install`:

```powershell
pnpm test
pnpm typecheck
pnpm dev
```

Ожидание в обозревателе: загрузка → главное меню; «Быстрый матч» доступен; при сохранённой былине есть акцентная «Продолжить». Автоматические проверки должны пройти до ручной проверки оболочки.

Производственная сборка: остановить `dev`, выполнить `pnpm build` и `pnpm preview`, повторить те же шаги меню и быстрого матча.

---

## 5. Установка как приложения Windows

Собрать и открыть `pnpm preview` либо раздать `app/apps/game-pwa/dist` по `https`. В Chrome/Edge: значок установки или меню «Установить приложение». Запуск — из «Пуск», имя «Былина».

---

## 6. Публикация на GitHub Pages

Рабочий процесс уже в репозитории: `.github/workflows/deploy-pages.yml`. Шаблон в `doc/` не хранится.

Разовая настройка:

1. Pages доступен для публичных репозиториев (или GitHub Pro для частных).
2. **Settings → Pages → Source → GitHub Actions**.
3. Слить в `main` или запустить **Actions → Deploy PWA to GitHub Pages**.
4. Адрес: `https://<владелец>.github.io/<репозиторий>/` (этот репозиторий: `https://aleksandrrv.github.io/bylina_tactics/`).

Workflow: `push` в `main` → pnpm + Node → `pnpm test` → сборка с `BASE_PATH=/<репозиторий>/` → выкладка `app/apps/game-pwa/dist`. Имя репозитория подставляется автоматически.

Локальная проверка той же сборки:

```bash
cd app
BASE_PATH=/bylina_tactics/ pnpm build
# PowerShell: $env:BASE_PATH="/bylina_tactics/"; pnpm build
pnpm preview
```

Открыть `http://localhost:4173/bylina_tactics/`.

---

## 7. Установка на телефон

PWA кэширует оболочку service worker (`vite-plugin-pwa`, `registerType: autoUpdate`). Нужен один заход по HTTPS. Одиночные режимы (быстрый матч, кампания, обучение) работают без сети.

**Android (Chrome):** открыть адрес Pages → дождаться меню → «Установить» в приложении или меню Chrome → значок «Былина». Проверка: авиарежим.

**iPhone / iPad (Safari):** открыть в Safari → «Поделиться» → «На экран Домой». Один запуск с сетью, затем авиарежим. Система может чистить хранилище давно не открытых веб-приложений.

Обновление: после публикации в `main` при первом запуске с сетью. В авиарежиме остаётся прежняя сборка.

---

## 8. Частые отказы

| Наблюдение | Действие |
|---|---|
| `pnpm` / `node` не команда | Повторить §1 в новом окне; проверить `PATH` |
| Политика сценариев PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `EPERM` при install | Закрыть IDE/браузер, удалить `node_modules`, повторить |
| Пустая страница | Console (`F12`); верный адрес `pnpm dev` |
| `Failed to resolve import "pixi.js"` | `pnpm install` из `app`; см. `app/packages/render/README.md` |
| Чёрное поле, панель есть | Включить аппаратное ускорение (WebGL) |
| Язык сбросился | Не инкогнито; не блокировать `localStorage` |
| Pages 404 | Source = GitHub Actions; дождаться зелёного workflow |
| Нет стилей/портретов на Pages | Сборка без `BASE_PATH` — публиковать только через workflow |
| Chrome не предлагает установку | Нужен HTTPS и дождаться кэша |
| На iPhone нет пункта установки | Открыть в Safari |
| Авиарежим — белый экран | Сначала полностью загрузить меню по сети |

Отладочные кнопки боя описаны в `debug-mode.md`, не здесь.
