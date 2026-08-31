# Атлас проекта

Предмет ведения: какой документ за что отвечает и где в репозитории лежит нужный код. Игровые правила, формулы и макеты сюда не входят.

## 1. Карта документации

| Документ | Предмет | Не содержит | Когда открывать |
|---|---|---|---|
| [README.md](README.md) | Титул комплекта, версия, инварианты | Дерево репозитория, правила | Узнать статус комплекта |
| [game-design.md](game-design.md) | Замысел, режимы, дружина, противники, изобразительные принципы | Формулы, пакеты, payload, вёрстку | Понять, что за игра |
| [campaign.md](campaign.md) | Пролог кампании: нормативный сценарий восьми миссий онбординга и двух экранов базы, правила периода пролога, технический задел | Алгоритмы боя (game-rules), числовые значения баланса (JSON5) | Проектировать, реализовывать или перебалансировать пролог |
| [game-rules.md](game-rules.md) | Сетка, зрение, бой, движение, состояния | Образы классов, UI, сеть | Менять LOS, урон, путь |
| [content-schema.md](content-schema.md) | Поля JSON5 и смысл | Алгоритмы, модули | Добавлять юнита, умение, миссию |
| [runtime-model.md](runtime-model.md) | `EntityState`, архетипы, системы ядра | Формулы, макеты | Менять поля сущности в бою |
| [network-protocol.md](network-protocol.md) | Команды, события, снимки, preview | Технологию WebRTC, формулы | Менять сетевой формат |
| [architecture.md](architecture.md) | Пакеты, зависимости, путь данных | Версии библиотек, этапы | Добавлять пакет или поток |
| [technology.md](technology.md) | Стек и ограничения платформы | Дерево репо, этапы | Выбирать технологию |
| [ui-design.md](ui-design.md) | Экраны, ввод, отображение уже посчитанного | Допустимость хода | Менять экран или жест |
| [localization.md](localization.md) | Языки, словари, расширение | Макеты, формулы | Добавлять язык или ключ |
| [debug-mode.md](debug-mode.md) | `?debug=1`, оверлей, автопобеда, полигон | Баланс, публикацию | Писать QA-средство |
| [roadmap.md](roadmap.md) | Будущие этапы, бэклог, критерии 1.0.0 | Формулы, макеты | Планировать выпуск |
| [operations.md](operations.md) | Среда, команды, Pages, установка PWA | Архитектуру, правила | Поднять проект или выложить сборку |

Локальные README (`app/README.md`, `app/packages/render/README.md`, `app/apps/signaling-server/README.md`) остаются у пакетов; здесь они только регистрируются.

## 2. Карта репозитория

```
/
├── doc/                         нормативная документация
├── .github/workflows/           ci.yml, deploy-pages.yml
└── app/                         код и сборка (команды pnpm отсюда)
    ├── apps/
    │   ├── game-pwa/            PWA-оболочка, точка входа Vite
    │   └── signaling-server/    ретранслятор WebSocket
    ├── packages/
    │   ├── core/                тактическое ядро (правила только здесь)
    │   ├── campaign/            автомат кампании
    │   ├── content/             JSON5, Zod, загрузка
    │   ├── session/             экраны, роли, сокращение по зрению
    │   ├── net/                 транспорт WebRTC / локальный
    │   ├── signaling/           клиент ретранслятора
    │   ├── storage/             сохранения, worker сериализации
    │   ├── replay/              журнал и воспроизведение повтора
    │   ├── render/              PixiJS, камера, поле
    │   ├── ui/                  React-экраны
    │   ├── i18n/                словари и t()
    │   └── settings/            язык, громкость, debugMode
    ├── eslint.config.mjs                правила проверки кода (0.20.55)
    ├── .prettierrc.json                настройки форматтера: ширина строки 120 (0.20.55)
    └── scripts/
        ├── check-version-consistency.mjs
        ├── set-version.mjs                  единственная точка правки номера версии (0.20.54)
        ├── visual-audit.mjs
        └── resize-action-art.mjs         приведение образов действий к 512×512 (0.20.48)
```

| Путь | Назначение |
|---|---|
| `app/packages/core/src/kernel.ts` | Применение команд, исход боя |
| `app/packages/core/src/combat.ts` | Попадание, урон, умения атаки |
| `app/packages/core/src/los.ts` | Линия наблюдения |
| `app/packages/core/src/types.ts` | `EntityState` и типы матча |
| `app/packages/render/src/` | Отрисовка поля и камера |
| `app/packages/render/src/token-art.ts` | Иллюстрации фишек пролога (0.20.37): Микула, крыса, палка |
| `app/packages/core/src/cutscene.ts` | Типы кинематографических сцен и сопоставление триггера с событием (0.20.37) |
| `app/packages/session/src/index.ts` | Оркестрация сессии, `suspendedCampaign` |
| `app/packages/content/data/` | Баланс: юниты, оружие, умения, миссии |
| `app/packages/content/src/schemas.ts` | Zod-схемы |
| `app/packages/i18n/locales/` | Словари ru/en |
| `app/packages/ui/src/` | Экраны React |
| `app/packages/ui/src/action-art.ts` | Образы действий и умений, карта файлов `public/actions` (0.20.46) |
| `app/packages/ui/src/action-info.ts` | Содержимое окна информации: числа из боевых данных, текст из словарей (0.20.46) |
| `app/packages/ui/src/action-panel.tsx` | Кнопка-миниатюра действия, долгое нажатие, окно информации (0.20.46) |
| `app/packages/ui/src/charge-attack.ts` | Рывок к цели ближнего боя: клетка подхода, маршрут, стоимость (0.20.50) |
| `app/apps/game-pwa/public/actions/` | Иконки действий и умений, 512×512 (0.20.46) |
| `app/scripts/check-version-consistency.mjs` | Единый источник версии: манифест, константы, документация, отсутствие литералов в исходниках (0.20.54) |
| `app/scripts/set-version.mjs` | Установка версии приложения одной командой `pnpm version:set` (0.20.54) |
| `app/packages/ui/tests/harness.tsx` | Общая обвязка DOM-тестов: заглушка поля боя, журнал обращений, монтирование экрана, жесты (0.20.56) |
| `app/eslint.config.mjs` | Правила ESLint: базовый набор, typescript-eslint, react-hooks; форматирование отдано Prettier (0.20.55) |
| `app/.prettierrc.json` | Единое форматирование исходников (0.20.55) |
| `app/scripts/resize-action-art.mjs` | Кадр 512×512 для образов действий (0.20.48) |

## 3. Владелец темы

Одна тема — один файл. Изменили сетевой формат — только `network-protocol.md`. Изменили правило урона — только `game-rules.md`. Изменили экран — только `ui-design.md`. Если правка тянет три документа, сначала уточняют карту, а не копируют абзац.

Числовой баланс не дублируется в Markdown: смысл поля — в `content-schema.md`, значение — в JSON5.
