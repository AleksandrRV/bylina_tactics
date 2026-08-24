# Атлас проекта

Предмет ведения: какой документ за что отвечает и где в репозитории лежит нужный код. Игровые правила, формулы и макеты сюда не входят.

## 1. Карта документации

| Документ | Предмет | Не содержит | Когда открывать |
|---|---|---|---|
| [README.md](README.md) | Титул комплекта, версия, инварианты | Дерево репозитория, правила | Узнать статус комплекта |
| [game-design.md](game-design.md) | Замысел, режимы, дружина, противники, изобразительные принципы | Формулы, пакеты, payload, вёрстку | Понять, что за игра |
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
    └── scripts/
        └── check-version-consistency.mjs
```

| Путь | Назначение |
|---|---|
| `app/packages/core/src/kernel.ts` | Применение команд, исход боя |
| `app/packages/core/src/combat.ts` | Попадание, урон, умения атаки |
| `app/packages/core/src/los.ts` | Линия наблюдения |
| `app/packages/core/src/types.ts` | `EntityState` и типы матча |
| `app/packages/render/src/` | Отрисовка поля и камера |
| `app/packages/session/src/index.ts` | Оркестрация сессии, `suspendedCampaign` |
| `app/packages/content/data/` | Баланс: юниты, оружие, умения, миссии |
| `app/packages/content/src/schemas.ts` | Zod-схемы |
| `app/packages/i18n/locales/` | Словари ru/en |
| `app/packages/ui/src/` | Экраны React |
| `app/scripts/check-version-consistency.mjs` | Единая версия пакетов и констант |

## 3. Владелец темы

Одна тема — один файл. Изменили сетевой формат — только `network-protocol.md`. Изменили правило урона — только `game-rules.md`. Изменили экран — только `ui-design.md`. Если правка тянет три документа, сначала уточняют карту, а не копируют абзац.

Числовой баланс не дублируется в Markdown: смысл поля — в `content-schema.md`, значение — в JSON5.
