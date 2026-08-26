# Средство отображения поля

Предмет ведения: подключение PixiJS v8 к пакету `@bylina/render` и проверка, что сборщик находит библиотеку. Игровые правила в этот файл не входят.

Поле рисует PixiJS (WebGL 2, при отказе — запасной путь инициализации). Интерфейс (`BattleScreen`) вызывает только `createFieldRenderer` и не импортирует `pixi.js`.

---

## 1. Почему пакет указан в двух местах

Vite собирает приложение из `apps/game-pwa` и по alias читает исходники `packages/render/src`. Разбор `import … from "pixi.js"` идёт **из корня приложения**, а не из `node_modules` пакета render.

pnpm по умолчанию кладёт зависимость только в `packages/render/node_modules`. Сборщик её не видит — отсюда прежняя ошибка `Failed to resolve import "pixi.js"`.

Принятое устройство:

| Место | Назначение |
|---|---|
| `packages/render/package.json` | Владелец зависимости: поле обязано знать PixiJS |
| `apps/game-pwa/package.json` | Корень Vite видит тот же пакет |
| `app/.npmrc` → `public-hoist-pattern[]=pixi.js` | Копия в корне рабочих областей |
| `vite.config.ts` → плагин `bylina-pixi-resolve` | Абсолютный путь через `createRequire`, независимо от alias |

Версии в обоих `package.json` совпадают: `^8.8.1`.

---

## 2. Установка после появления или смены PixiJS

Выполнять из каталога `app` (рядом лежит `doc`):

```powershell
cd C:\Users\Aleksandr\Documents\bylina_tactics\app
pnpm install
```

Ожидание: без ошибки в последней строке. Проверка наличия пакета:

```powershell
Test-Path .\node_modules\pixi.js
Test-Path .\packages\render\node_modules\pixi.js
Test-Path .\apps\game-pwa\node_modules\pixi.js
```

Достаточно **одного** `True`. Если все `False` — `pnpm install` не завершился либо выполнялся не из `app`.

Не смешивать с `npm install` в этом репозитории.

---

## 3. Запуск и проверка изображения

```powershell
pnpm typecheck
pnpm --filter @bylina/render test
pnpm dev
```

Открыть адрес из вывода Vite. Меню → **«Быстрый матч»**.

| Шаг | Ожидание |
|---|---|
| Поле | Квадратные клетки без зазоров, ярусы, ямы, стена, укрытие |
| Знаки | Круг — дружина, шестиугольник — Нави (все враждебные) |
| Ход | Подсветка зоны, перемещение, линия прицела |
| Консоль (`F12`) | Нет `Failed to resolve import "pixi.js"` |
| Консоль | Нет необработанного отказа `app.init` |

Остановка: `Ctrl+C`.

---

## 4. Частые отказы

| Наблюдение | Действие |
|---|---|
| `Failed to resolve import "pixi.js"` | Остановить Vite, выполнить `pnpm install` из `app`, снова `pnpm dev` |
| `pixi.js` не найден после установки | Удалить `app/node_modules`, повторить `pnpm install` |
| Поле чёрное, панель есть | Включить аппаратное ускорение обозревателя; обновить вкладку |
| Старый Canvas без Pixi | Убедиться, что в Workspace лежит `packages/render/src/field-renderer.ts` с импортом из `pixi.js` |

---

## 5. Граница ответственности

Ядро не импортирует PixiJS. Смена версии PixiJS — правка двух `package.json`, затем `pnpm install` и таблица раздела 3. Правила боя не меняются.
