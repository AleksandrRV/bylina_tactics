## 1. Executive Summary

Зрелость: **8/10**. Это существенно выше типичного pet-project: документация нормативна и не расходится с кодом, ядро действительно изолировано, дисциплина типизации редкая.

**Ключевые сильные стороны**

- **Ядро по-настоящему чистое.** `core/` и `campaign/` — **нулевые** внешние runtime-зависимости и **нулевые** обращения к `document`/`window`/`localStorage`/`fetch`. Инвариант «ядра испытываются в среде без обозревателя» (architecture §5.1) соблюдён фактически, а не на словах.
- **Дисциплина типов.** `strict: true` **плюс `noUncheckedIndexedAccess: true`** (редкость) и **ноль вхождений `any`/`as any`** во всём `src`. 
- **Осознанный детерминизм.** В `kernel.ts` систематические `.sort((a, b) => a.id - b.id)` перед проходами по сущностям, комментарии со ссылками на параграфы спецификации (`§16.1: poison before every other beginning-of-turn system`). Mulberry32 с сохранением `rngState` в снимке.
- **Граф зависимостей соответствует объявленному.** Проверил все 12 пакетов — направление вниз по списку из architecture §2 не нарушено ни разу. Единственное упоминание `@bylina/core` в `content/` оказалось комментарием, не импортом.
- **Тесты как первоклассный артефакт.** 83 файла, отношение тесты:код ≈ 0.62. Ядро — 21 файл, UI — 35, включая DOM-обвязку `ui/tests/harness.tsx`.
- **Формат сохранений спроектирован верно:** `SAVE_FORMAT_VERSION = 2` намеренно независим от `APP_VERSION`, `migrateSave` отклоняет неизвестный будущий формат вместо тихой порчи.

**Ключевые риски**

- **God-функции.** `createFieldRenderer()` — **3152 строки** в одном замыкании с 94 локальными `const` и 17 Pixi-контейнерами; `createTacticsKernel()` — ~1670 строк. Именно поэтому в `render/` всего 5 тестов: замыкание нетестируемо по частям.
- **Ретранслятор уязвим к исчерпанию памяти** (см. Critical-1).
- **Повторы (replay) не воспроизводимы между версиями** — версия пишется, но никогда не проверяется (см. Critical-2).
- **Автосохранение может замолчать навсегда** после одной ошибки Worker (см. Major-1).
- **Документированные инварианты не исполняемы:** направление зависимостей соблюдается вручную, CI его не проверяет.

**Top-3 действия:** (1) `maxPayload` + лимиты на ретрансляторе; (2) независимый `REPLAY_FORMAT_VERSION` с проверкой при загрузке; (3) устранить тихий отказ автосейва.

---

## 2. Critical

### Critical-1. Ретранслятор: неограниченное потребление памяти

`app/apps/signaling-server/src/server.mjs:43` — `new WebSocketServer({ server })` **без `maxPayload`**. Дефолт `ws` — 100 МиБ. Проверка размера стоит внутри обработчика:

```js
socket.on("message", (raw) => {
  if (raw.length > MAX_SIGNAL_BYTES + 1024) return send(socket, {...});
```

К моменту её выполнения кадр уже полностью забуферизован. Заявленный лимит `MAX_SIGNAL_BYTES = 64 * 1024` не защищает ни от чего.

Сопутствующее в том же файле: `MAX_PEERS = 4` ограничивает комнату, но **число комнат и соединений не ограничено** — `rooms` (строка 25) растёт неограниченно; `/rooms` (строка 39) отдаёт **все** комнаты с именами игроков без аутентификации, что даёт и раскрытие, и амплификацию ответа, и возможность занять чужую комнату до `ROOM_FULL`.

```js
// After
const wss = new WebSocketServer({ server, maxPayload: MAX_SIGNAL_BYTES + 1024 });
```

Плюс: лимит соединений на IP, `MAX_ROOMS`, TTL для комнат без сигналов, пагинация `/rooms`. `peerId()` (строка 118) на `Math.random()` стоит заменить на `crypto.randomUUID()` — правка в одну строку.

Оговорка: `RELAY_ALLOW_ORIGIN` и дефолт `*` документированы осознанно, и XSS через имена игроков **не проходит** — `dangerouslySetInnerHTML` в продакшн-коде отсутствует (нашёл только `document.body.innerHTML = ""` в тестах). Это отдельный плюс.

### Critical-2. Повторы расходятся с записанным боем и молча

`packages/replay/src/index.ts:16`:

```ts
export const REPLAY_VERSION = APP_VERSION;
```

Проблема двойная. Во-первых, версия формата приравнена к версии приложения — то есть меняется на каждом патче, при том что для сохранений тут же принято **правильное** решение (`SAVE_FORMAT_VERSION = 2`, «independent from APP_VERSION»). Во-вторых, `journal.version` **не проверяется нигде**: `isReplayJournal` (строка 75) валидирует поле как `typeof === "string"` и всё; grep по всему `app/` даёт только запись и ноль чтений.

Следствие: журнал из 0.20.67 проигрывается ядром 0.20.68. Любое изменение правил боя или порядка обращений к ГПСЧ даёт другой исход **без предупреждения** — пользователь видит «повтор», не соответствующий бою.

Усугубляет то, что `PvpMatchOptions.units: SpawnUnitConfig[]` содержит характеристики юнитов, но оружие и умения — **только идентификаторы** (`weapons: string[]`, `skills?: string[]`). Правка `minDmg` в `weapons/*.json5` ломает все ранее записанные повторы, и журнал этого не фиксирует.

Рекомендация: ввести `REPLAY_FORMAT_VERSION` (число, независимое от `APP_VERSION`) плюс отдельный `rulesVersion`, инкрементируемый при изменении боевых правил или контента, влияющего на исход; при несовпадении показывать «повтор записан другой версией правил» вместо тихого воспроизведения. Как минимум — включить в журнал слепок задействованных `WeaponStats`/`SkillStats`.

---

## 3. Major

**Major-1. Автосейв умолкает навсегда после одной ошибки Worker.** `packages/storage/src/index.ts`, `createSaveSerializer`: `worker.onerror` отклоняет `pending` и очищает карту, но **не помечает worker мёртвым и не переключается на синхронный путь**. Последующие `serialize()` кладут промис в `pending` и не разрешаются никогда — `onmessage` больше не сработает. В `apps/game-pwa/src/App.tsx:284,390` оба вызова оканчиваются `.catch(() => { /* следующий автосейв повторит */ })` — но `.catch` уже не вызовется, «следующий автосейв» тоже повиснет. Итог: тихая потеря прогресса + неограниченный рост `pending`. Фикс: флаг `dead`, откат на `serializeSaveDraft`, таймаут на промис.

**Major-2. `MOVE.path` — массив без ограничения длины.** `packages/net/src/validation.ts:16`. Рядом, в том же файле, `isEventBatchPayload` осознанно ставит `value.length <= 512`, а строки ограничены 32/128 символами — то есть автор о лимитах думал, но `path` пропустил. Недоверенный ведомый может прислать `path` на миллион элементов: `path.every(position)` даст загрузку CPU у ведущего, а команда затем попадёт в `replayDraft.commands`. Фикс: `value.path.length <= 256`.

**Major-3. Отклонённые команды попадают в журнал повтора.** `packages/session/src/index.ts:906–931`: команда добавляется в `replayDraft.commands` **до** проверки `ownerOk`, после чего возможен ранний `return` с `REJECT`. Журнал загрязняется командами, которые никогда не применялись, и ведомый может неограниченно его раздувать. Переставить запись после успешного `applied.ok`.

**Major-4. `cloneState` — рукописный глубокий клон.** `kernel.ts:96–120`. Сверил построчно с `EntityState`, `MatchState` и `Tile` — **сейчас корректен**, все вложенные поля (`weaponIds`, `skillIds`, `skillCooldowns`, `skillUses`, `poison`, `panic`) копируются. Но инвариант ничем не защищён: добавление нового вложенного поля даст молчаливый alias между снимками — то есть порчу состояния и расхождение повтора, отладить которое крайне дорого. Рекомендация: тест на исчерпывающность (`structuredClone` как эталон сравнения) либо `satisfies`-проверка типа.

**Major-5. `SaveData.match` не валидируется вовсе.** `isSaveData` проверяет `campaign.fighters`, `campaign.missions`, `session.deployment` как массивы, а `match?: MatchState` — никак. Испорченная запись уходит в `restoreMatch` и падает уже внутри ядра. Проект щедро применяет Zod к контенту — граница сохранений (пересекающая версии) заслуживает того же вместо ручных проверок.

**Major-6. `FieldRenderer`: 13 необязательных методов.** `render/src/field-renderer.ts:140–196`. Все возможности режиссуры (`playCinematic?`, `fadeScreen?`, `setHiddenEntities?`, `focusEntity?`, `getCameraScale?` …) объявлены опциональными, из-за чего вызовы выглядят так:

```ts
// prologue-director.ts:119
return (await now().renderer()?.playCinematic?.(plan)) ?? false;
```

Компилятор не гарантирует, что реальный рендерер их реализует, а `?? false` превращает отсутствие метода в «сцену не пропустили» — тихая деградация вместо ошибки. Разделить на `FieldRenderer` + capability-интерфейсы (`CinematicRenderer`, `CameraControl`), сделав методы обязательными в них.

**Major-7. Сеть жёстко ограничена двумя участниками.** `session/src/index.ts:917` — `const guestOwner = 2`. При этом `kernel.ts:122` `nextOwner` намеренно обобщён, и комментарий заявляет: «состязательный режим допускает произвольное число участников (game-design §7)». Ядро готово к N, сессия — нет. Либо привести сессию к N, либо снять обещание из комментария.

---

## 4. Minor

- **Осиротевший комментарий.** `content/src/schemas/modes.ts:55–59` документирует «Запись хода Нави в сценарии обучения», но схема за ним отсутствует — она переехала в `training.ts:7` при разделении схем (0.20.57).
- **Расхождение схемы и типа.** `trainingEnemyScriptSchema` требует `priority` и `actions`, а `core`-интерфейс `TrainingEnemyScript` объявляет оба как `optional?`. Комментарий обещает «конфигурация передаётся исполнителю без преобразования» — совместимость держится на честном слове, литералы enum дублируются в двух файлах.
- **`isCommandPayload` возвращает `boolean`, а не `value is Command`** — отсюда `as Command` в `session/src/index.ts:807`.
- **Дублирование backend-замыкания** `localStorage` (~14 строк) между `createReplayStorage` и `createSaveStorage`.
- **`createReplayStorage` не различает `QuotaExceededError`** и не вызывает `onQuotaExceeded`, в отличие от `createSaveStorage`; `deleteReplay`/`clearReplays` игнорируют результат `write()`.
- **`isSyncPayload`** проверяет форму, но не размеры и не содержимое `match.entities` / `grid.tiles` — при заявленном принципе «validated at every trust boundary».
- **Многократные проходы по `state.entities`** в блоке `END_TURN` (`kernel.ts:1449–1551`) — 5+ проходов с пересозданием массива. Для пошаговой игры не критично, но код читается тяжело.
- **`Object.entries(entity.skillCooldowns)`** (`kernel.ts:1502`) — порядок ключей влияет на порядок событий; для числоподобных идентификаторов умений он изменится.

---

## 5. Автоматизация: где документированный инвариант стоит сделать исполняемым

Это самая выгодная группа рекомендаций, потому что проект уже отлично документирован — не хватает только принудительного контроля.

1. **Границы пакетов в CI.** architecture §2 задаёт строгое направление зависимостей, и сейчас он соблюдён — но только вручную. `dependency-cruiser` или `eslint-plugin-boundaries` превратят таблицу слоёв в правило сборки. Высокая отдача, низкая трудоёмкость.
2. **Типизированный линтинг.** `eslint.config.mjs:41` использует `tseslint.configs.recommended`, а не `recommendedTypeChecked`. В коде много `void promise.then()` и асинхронного проигрывателя событий — `no-floating-promises` и `no-misused-promises` здесь поймали бы реальные дефекты (в частности класс Major-1).
3. **Запрет DOM-глобалей в ядре линтером** — сейчас чистота ядра фактическая, но не гарантированная.
4. **Порог покрытия.** Конфигурации `coverage` нет ни в одном `vitest.config.ts`. Начать с `core/` (там 21 тест-файл — база уже есть), не гонясь за общей цифрой.
5. **CI.** `doc/examples/ci.yml` — качественный трёхзадачный пайплайн (версии / линт+формат / typecheck+тесты+сборка). Но `project-map.md:33` заявляет `.github/workflows/` с `ci.yml` и `deploy-pages.yml`, а в дампе есть только `doc/examples/ci.yml`. Возможно, `.github/` просто отфильтрован пресетом сборщика (исключено 6954 файла) — **проверьте, установлен ли пайплайн фактически**; если это пример, то все проверки держатся на ручном запуске.

---

## 6. Что сохранить обязательно

Чистоту ядра, `noUncheckedIndexedAccess`, нулевой `any`, сортировки ради детерминизма, ссылки на параграфы спецификации в комментариях, принцип «одна тема — один документ» и единый источник версии (`set-version.mjs` + `check-version-consistency.mjs`). Это ровно те решения, которые обычно принимают слишком поздно.

Главный вектор развития — не архитектура (она здорова), а **декомпозиция двух God-функций** и **перевод документированных инвариантов в машинно-проверяемые**.

Готов продолжить: логичнее всего теперь разобрать `field-renderer.ts`, `BattleScreenView.tsx` и `CampaignScreen.tsx` и выдать по ним раздел с примерами before/after и планом инкрементального дробления — либо углубиться в любой из findings выше.

Дерево на месте. Разбираю три оставшихся файла.Важно: часть логики уже вынесена (20+ чистых модулей). Смотрю, что осталось внутри компонента.12 подавлений `exhaustive-deps` — все в одном файле. Смотрю характер.Проверю ключевую гипотезу: возвращает ли `getSnapshot()` новую ссылку на каждом вызове.Это важно. Читаю эффект, который зависит от `snapshot` целиком.Сетка мелкая (12×10–14×10) — это калибрует серьёзность. Последний заход: `CampaignScreen` и цикл рендера.# Ревью «Былина» — продолжение

Разобрал три оставшихся файла. Ниже — новые findings, затем детальные рекомендации с before/after, метрики, roadmap и заключение.

---

## 4-бис. Findings по крупным файлам

Сначала важный контекст, который меняет интерпретацию «God-файлов»: **в проекте идёт дисциплинированная программа декомпозиции**, и это видно по коду. Из `BattleScreenView` уже вынесено больше 20 чистых модулей с проставленными версиями фаз: `battle-keyboard.ts` (0.20.59), `battle-selection.ts` (0.20.60), `battle-cell-click.ts` (0.20.63), `battle-command.ts` (0.20.64), `battle-enemy-phase.ts` (0.20.66), `prologue-director.ts` (0.20.67), `battle-match.ts` (0.20.68), плюс хуки `useBattleNetwork`/`useBattleInput`/`useReplayControls`. Плюс `BattleScreen.tsx` — 8 строк с `lazy()`, чтобы PixiJS не попадал в входной чанк. Это правильные решения, принятые в правильном порядке.

Поэтому остаток в 2951 строке — не «нерасчленённый монолит», а **осадок из состояния и JSX**. И проблема там именно в состоянии.

### Major-8. Снимок клонируется в теле рендера — мемоизация не работает

`BattleScreenView.tsx:444`:

```tsx
const snapshot = usesNetSnapshot
  ? (session.getNetSnapshot() ?? EMPTY_SNAPSHOT)
  : session.getBattleSnapshot(viewOwner);
```

Это вычисляется **в теле компонента, на каждом рендере**. Цепочка: `getBattleSnapshot` → `requireTacticsHost().getSnapshotFor(owner)` → `cloneState(state)` плюс ещё один `tiles.map()` для тумана (`kernel.ts:1275–1281`). То есть новый граф объектов при каждом рендере.

Следствие первое: `snapshot.entities` — **новая ссылка всегда**. Значит все зависящие от неё мемоизации не срабатывают ни разу:

```tsx
// BattleScreenView.tsx:546-557
const visibleCells = useMemo(
  () => (usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [kernel, snapshot.turnNumber, snapshot.entities, viewOwner, usesNetSnapshot, session],
);
```

Комментарий рядом объясняет `snapshot.entities` как «признак устаревания» — замысел верный, но реализация его не достигает: признак меняется всегда, поэтому `useMemo` даёт только накладные расходы и ложное впечатление кэширования.

Следствие второе, дороже: тем же способом собран `directiveView` (строки 456–471). Его тело вызывает `session.getBattleFullSnapshot()` (ещё один полный клон), `getBattleReachable()` (**поиск пути**), `getBattleHitPreview()` и `getBattleSkillPreview()`. Поскольку в deps стоит `snapshot`, в режиме обучения **поиск пути и предпросмотры пересчитываются на каждый рендер** — включая рендеры от наведения курсора и открытия окна информации.

Калибровка серьёзности: сетки в контенте небольшие (`prologue_missions.json5` — 12×10 и 14×10, то есть 120–140 клеток), поэтому сам клон стоит единицы микросекунд и катастрофы сегодня нет. Серьёзность здесь в другом: (а) код **вводит в заблуждение** — 12 подавлений `exhaustive-deps` выглядят как осознанная тонкая настройка, тогда как половина из них лечит симптом; (б) поиск пути в горячем пути рендера плохо масштабируется при росте сеток; (в) любая будущая оптимизация через `React.memo` вниз по дереву обречена.

### Major-9. Состояние экрана боя рассыпано по 32 `useState`

`BattleScreenView.tsx`: **32 `useState`, 22 `useEffect`, 11 `useRef`, 0 `useCallback`** и все 12 подавлений `react-hooks/exhaustive-deps` в пакете `ui` — в этом одном файле.

При этом значительная часть состояний — это одна сущность, разрезанная на части: `selectedId`, `action`, `aimId`, `skillTargetPos`, `charge`, `chargeArmed`, `preview` описывают **одно** «текущее намерение игрока» и обязаны меняться согласованно. Разрезанные на семь `useState`, они допускают недостижимые комбинации (наведение на цель при `selectedId === null`, `chargeArmed` без `charge`), и согласованность держится на аккуратности каждого из ~20 обработчиков.

Показательно, что чистый разбор нажатия уже вынесен в `battle-cell-click.ts` и возвращает «намерение без исполнения» — архитектурно верный шаг сделан, но принимающая сторона всё ещё хранит результат семью независимыми ячейками.

### Minor-9. Таймер повтора пересоздаётся на каждой команде

`BattleScreenView.tsx:396–409`:

```tsx
const timer = window.setInterval(() => {
  const index = replayIndex;
  ...
  setReplayIndex(index + 1);
}, 480);
return () => window.clearInterval(timer);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [isReplay, replayJournal, kernel, replayIndex, replayDone]);
```

`replayIndex` стоит и в теле, и в deps: каждый тик меняет индекс → эффект переустанавливается → `setInterval` создаётся заново. Фактически это цепочка таймаутов, притворяющаяся интервалом. Работает, но интервал сбрасывается на каждом шаге (дрожание темпа воспроизведения) и подавление `exhaustive-deps` здесь скрывает не замысел, а обход.

### Major-10. `createFieldRenderer` — 3152 строки, 5 тестовых файлов

`render/src/field-renderer.ts:1086` и далее: одно замыкание с 94 локальными `const`, 17 Pixi-контейнерами и 6 `Map` изменяемого состояния (`display`, `lunges`, `bumps`, `dying`, `flashes`, `pointers`). Ни одна внутренняя функция не экспортируется, поэтому тестировать можно только через `mount()` — и тесты это подтверждают: из 5 файлов в `render/tests/` содержательно покрыты вынесенные наружу `camera.ts`, `fringe.ts`, `token-art.ts`, а сам рендерер — почти нет.

Полезное наблюдение о том, куда двигаться: **вынесенные модули оказались тестируемыми** (`camera.test.ts` — 266 строк, `camera-director.test.ts`, `token-art.test.ts`). То есть проверенный рецепт для этого пакета уже есть, его надо просто продолжить.

Отдельно отмечу как **сильную сторону**: `destroy()` (строки 4163–4185) образцов — снимает `animFrame` через `cancelAnimationFrame`, отписывает все шесть pointer-обработчиков, `resize`, `wheel`/`dblclick`/`contextmenu`, чистит очередь `jobs` и вызывает `app.destroy(true)`, с `try/catch` на случай уже удалённого canvas. Утечек при размонтировании я не нашёл, а для PixiJS-компонента это самая частая ошибка.

### Наблюдение: `CampaignScreen.tsx` в норме

1241 строка, но **10 `useState` и 4 `useEffect`** — плотность состояния втрое ниже, чем в экране боя, подавлений `exhaustive-deps` нет. Это преимущественно JSX и разметка экранов базы. В рефакторинге не нуждается; при желании — только выделение подкомпонентов Кузни/Горницы ради читаемости.

---

## 5. Детальные рекомендации

Приоритет: **P0** — до следующего выпуска, **P1** — 1–2 спринта, **P2** — по мере касания.

### P0-1. Ретранслятор: лимиты. Effort: Low

**Обоснование:** Critical-1. Заявленный `MAX_SIGNAL_BYTES` не действует, потому что проверка стоит после буферизации кадра.

```js
// Before — apps/signaling-server/src/server.mjs:43
const wss = new WebSocketServer({ server });

// After
const MAX_ROOMS = 200;
const MAX_SOCKETS = 400;
const wss = new WebSocketServer({
  server,
  // Кадр крупнее предела отвергается транспортом до буферизации:
  // проверка в обработчике сообщения к этому моменту уже опоздала.
  maxPayload: MAX_SIGNAL_BYTES + 1024,
});

wss.on("connection", (socket) => {
  if (wss.clients.size > MAX_SOCKETS) return socket.close(1013, "OVERLOADED");
  // ...
});

// в joinRoom, перед созданием комнаты:
if (!room && rooms.size >= MAX_ROOMS) {
  send(peer.socket, { type: "ERROR", message: "CAPACITY" });
  peer.socket.close();
  return;
}
```

Плюс замена `peerId()` (строка 118):

```js
// Before
function peerId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
// After
import { randomUUID } from "node:crypto";
function peerId() {
  return randomUUID();
}
```

**Эффект:** снятие вектора исчерпания памяти. **Trade-off:** `MAX_SOCKETS` требует подбора под площадку размещения; вынести в переменные окружения рядом с `RELAY_ALLOW_ORIGIN`.

### P0-2. Версия формата повтора и проверка при загрузке. Effort: Low

**Обоснование:** Critical-2 — повтор молча расходится с записанным боем.

```ts
// Before — packages/replay/src/index.ts:16
export const REPLAY_VERSION = APP_VERSION;

// After
/**
 * Формат журнала независим от версии приложения — та же политика, что у
 * SAVE_FORMAT_VERSION. Инкрементируется при изменении полей журнала.
 */
export const REPLAY_FORMAT_VERSION = 1;
/**
 * Версия правил: инкрементируется при любом изменении боевых алгоритмов
 * или порядка обращений к ГПСЧ. Журнал, записанный другими правилами,
 * воспроизводится иначе, чем шёл бой, — и должен быть отклонён явно.
 */
export const RULES_VERSION = 1;

export interface ReplayJournal {
  formatVersion: number;
  rulesVersion: number;
  /** Версия приложения — только для диагностики, на совместимость не влияет. */
  appVersion: string;
  // ... остальное без изменений
}

export type ReplayCompatibility = "ok" | "otherRules" | "unsupported";

export function replayCompatibility(journal: ReplayJournal): ReplayCompatibility {
  if (journal.formatVersion !== REPLAY_FORMAT_VERSION) return "unsupported";
  if (journal.rulesVersion !== RULES_VERSION) return "otherRules";
  return "ok";
}
```

Точка применения — экран списка повторов: при `"otherRules"` показывать запись, но с пометкой и предупреждением перед воспроизведением; при `"unsupported"` — не воспроизводить.

**Эффект:** пользователь перестаёт видеть «повтор», не соответствующий бою. **Trade-off:** нужна дисциплина инкремента `RULES_VERSION`; её стоит добавить в `check-version-consistency.mjs` как напоминание при изменениях в `core/src/combat.ts`.

### P0-3. Автосейв не должен умолкать. Effort: Low

**Обоснование:** Major-1 — после одной ошибки Worker все последующие промисы не разрешаются никогда.

```ts
// Before — packages/storage/src/index.ts, createSaveSerializer
worker.onerror = () => {
  for (const request of pending.values()) request.reject(new Error("Save worker failed"));
  pending.clear();
};
return {
  serialize: (data) => new Promise<string>((resolve, reject) => { ... }),
  ...
};

// After
let workerAlive = true;
worker.onerror = () => {
  // Рабочий поток потерян: дальше сериализуем в главном потоке, иначе
  // автосохранение молча прекращается до перезагрузки страницы.
  workerAlive = false;
  for (const request of pending.values()) request.reject(new Error("Save worker failed"));
  pending.clear();
};
return {
  serialize: (data) => {
    if (!workerAlive) return Promise.resolve(serializeSaveDraft(data));
    return new Promise<string>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        // Молчание рабочего потока — не повод терять ход.
        resolve(serializeSaveDraft(data));
      }, 4000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (reason) => { clearTimeout(timer); reject(reason); },
      });
      worker.postMessage({ id, data } satisfies WorkerRequest);
    });
  },
  ...
};
```

**Эффект:** тихая потеря прогресса исключена, `pending` не растёт. **Trade-off:** синхронный откат вернёт сериализацию в главный поток, то есть возможен кадровый провал — но это заведомо лучше молчаливой потери сохранения; стоит логировать через `console.warn`.

### P0-4. Предел длины `path`. Effort: Trivial

```ts
// Before — packages/net/src/validation.ts:16
case "MOVE":
  return position(value.to) && (value.path === undefined || (Array.isArray(value.path) && value.path.every(position)));

// After
case "MOVE":
  return (
    position(value.to) &&
    (value.path === undefined ||
      // Предел, как у пакета событий (512): недоверенный ведомый не должен
      // задавать длину работы ведущего.
      (Array.isArray(value.path) && value.path.length <= 256 && value.path.every(position)))
  );
```

Заодно превратить предикат в типизированный, что уберёт `as Command` в `session/src/index.ts:807`:

```ts
export function isCommandPayload(value: unknown): value is Command { ... }
```

### P1-1. Один источник снимка вместо клона на рендер. Effort: Medium

**Обоснование:** Major-8. Это ключевая рекомендация раздела — она убирает и лишнюю работу, и корень половины подавлений `exhaustive-deps`.

Шаг 1 — счётчик ревизий в ядре (ядро уже умеет `subscribe`, счётчик стоит рядом с `refresh`):

```ts
// packages/core/src/kernel.ts
let revision = 0;
const refresh = (): void => {
  revision += 1;
  // ... существующее тело
};
// в возвращаемом объекте:
getRevision: () => revision,
```

Шаг 2 — проброс через сессию (`getBattleRevision`, `subscribeBattle`).

Шаг 3 — в компоненте снимок берётся один раз на изменение боя:

```tsx
// Before — BattleScreenView.tsx:444 (клон при каждом рендере)
const snapshot = usesNetSnapshot
  ? (session.getNetSnapshot() ?? EMPTY_SNAPSHOT)
  : session.getBattleSnapshot(viewOwner);

// After
const revision = useSyncExternalStore(
  useCallback((notify) => session.subscribeBattle(notify), [session]),
  () => session.getBattleRevision(),
);
const snapshot = useMemo(
  () =>
    usesNetSnapshot
      ? (session.getNetSnapshot() ?? EMPTY_SNAPSHOT)
      : session.getBattleSnapshot(viewOwner),
  [revision, usesNetSnapshot, viewOwner, session],
);
```

После этого зависимости соседних мемоизаций становятся честными, и подавления исчезают вместе с комментариями про «признак устаревания»:

```tsx
// Before
const visibleCells = useMemo(
  () => (usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [kernel, snapshot.turnNumber, snapshot.entities, viewOwner, usesNetSnapshot, session],
);

// After — deps полны, правило не подавляется, мемоизация действительно работает
const visibleCells = useMemo(
  () => (usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner)),
  [revision, usesNetSnapshot, viewOwner, session],
);
```

**Эффект:** снимок клонируется один раз на изменение боя вместо каждого рендера; `directiveView` перестаёт запускать поиск пути и предпросмотры при наведении курсора; 4–5 подавлений `exhaustive-deps` уходят вместе с причиной. **Trade-off:** `useSyncExternalStore` требует React 18 (есть) и корректного `getSnapshot` без аллокаций — поэтому возвращается именно число `revision`, а не объект. **Файлы:** `core/src/kernel.ts`, `session/src/index.ts`, `ui/src/BattleScreenView.tsx`, `ui/src/hooks.ts`.

### P1-2. Намерение игрока — одним объектом. Effort: Medium

**Обоснование:** Major-9. Разбор нажатия уже возвращает намерение (`battle-cell-click.ts`) — осталось так же его и хранить.

```tsx
// Before — семь независимых ячеек, согласуемых вручную
const [selectedId, setSelectedId] = useState<number | null>(null);
const [action, setAction] = useState<{ type: "weapon" | "skill"; id: string } | null>(null);
const [aimId, setAimId] = useState<number | null>(null);
const [skillTargetPos, setSkillTargetPos] = useState<CellPos | null>(null);
const [charge, setCharge] = useState<ChargePlan | null>(null);
const [chargeArmed, setChargeArmed] = useState(false);
const [preview, setPreview] = useState<string | null>(null);

// After — одно состояние, недостижимые комбинации выражены типом
type Intent =
  | { kind: "idle" }
  | { kind: "selected"; actorId: number }
  | { kind: "aiming"; actorId: number; action: BattleAction; targetId: number }
  | { kind: "placing"; actorId: number; action: BattleAction; pos: CellPos | null }
  | { kind: "charging"; actorId: number; plan: ChargePlan; armed: boolean };

const [intent, setIntent] = useState<Intent>({ kind: "idle" });
```

Переход стоит вынести чистой функцией в новый `battle-intent.ts` — по образцу уже существующих `battle-selection.ts` и `battle-cell-click.ts`, с юнит-тестами без DOM:

```ts
// packages/ui/src/battle-intent.ts
export function nextIntent(current: Intent, event: BattleKeyIntent | CellClickIntent): Intent { ... }
```

**Эффект:** «прицеливание без выбранного бойца» и «`chargeArmed` без плана» становятся невыразимыми; ~20 обработчиков перестают синхронизировать семь ячеек. **Trade-off:** заметная разовая правка JSX (`intent.kind === "aiming" && ...` вместо `aimId !== null`); делать одним коммитом, опираясь на существующие DOM-тесты в `ui/tests/` как страховочную сеть. **Приём:** миграцию можно вести инкрементально, оставив прежние `const selectedId = intent.kind === "idle" ? null : intent.actorId` как производные значения — тогда JSX правится вторым шагом.

### P1-3. Таймер повтора — без подавления. Effort: Trivial

```tsx
// After — BattleScreenView.tsx:396
const replayIndexRef = useRef(0);
useEffect(() => {
  if (!isReplay || !replayJournal || replayDone) return;
  const commands = replayJournal.commands;
  const timer = window.setInterval(() => {
    const index = replayIndexRef.current;
    if (index >= commands.length) {
      setReplayDone(true);
      return;
    }
    const command = commands[index];
    if (command) kernel.apply(command);
    replayIndexRef.current = index + 1;
    setReplayIndex(index + 1);
  }, 480);
  return () => window.clearInterval(timer);
}, [isReplay, replayJournal, kernel, replayDone]);
```

Индекс живёт в ref, поэтому интервал создаётся один раз, темп воспроизведения ровный, deps полны и подавление не нужно.

### P1-4. Защита инвариантов тестом, а не вниманием. Effort: Low

**Обоснование:** Major-4 — `cloneState` сейчас корректен, но ничем не защищён.

```ts
// packages/core/tests/clone-state.test.ts
import { describe, expect, it } from "vitest";

describe("cloneState", () => {
  it("не оставляет общих ссылок с исходным состоянием", () => {
    const kernel = createTacticsKernel({ /* партия со всеми необязательными полями */ });
    const state = kernel.getSnapshot();
    const copy = kernel.getSnapshot();

    // structuredClone как эталон: значения равны...
    expect(copy).toEqual(structuredClone(state));

    // ...а ссылки не совпадают ни на одном вложенном уровне.
    const paths = collectObjectPaths(state); // обход всех объектов/массивов
    for (const path of paths) {
      expect(at(copy, path), `общая ссылка: ${path}`).not.toBe(at(state, path));
    }
  });
});
```

Тест обязан строить сущность со **всеми** необязательными полями (`poison`, `panic`, `skillCooldowns`, `skillUses`, `weaponIds`, `skillIds`, `extracted`, `apple`), иначе он пропустит именно тот случай, ради которого написан.

**Эффект:** добавление вложенного поля без обновления `cloneState` роняет тест, а не портит состояние в бою.

### P1-5. Границы модулей — в CI. Effort: Low

**Обоснование:** architecture §2 соблюдён фактически, но не принудительно; это самая выгодная автоматизация в проекте.

```js
// app/.dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: "core-remains-pure",
      comment: "architecture §5.1: ядра испытываются в среде без обозревателя",
      severity: "error",
      from: { path: "^packages/(core|campaign)/src" },
      to: { dependencyTypes: ["npm"], pathNot: "^(typescript|vitest)$" },
    },
    {
      name: "layers-point-down",
      comment: "architecture §2: зависеть можно только вниз по списку слоёв",
      severity: "error",
      from: { path: "^packages/(content|i18n|settings)/src" },
      to: { path: "^packages/(core|campaign|session|ui|render|net|storage|replay)/src" },
    },
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
  ],
};
```

Плюс включить типизированный линтинг — он поймал бы класс дефекта из P0-3:

```js
// Before — app/eslint.config.mjs:41
...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.{ts,tsx}"] })),

// After
...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: ["**/*.{ts,tsx}"] })),
// и в rules:
"@typescript-eslint/no-floating-promises": "error",
"@typescript-eslint/no-misused-promises": "error",
```

**Trade-off:** `recommendedTypeChecked` требует `parserOptions.projectService` и заметно замедляет линт; при 27.7k строк это терпимо, но в CI стоит держать отдельной задачей. Ожидаемо даст пачку предупреждений на существующем коде — вводить в режиме `warn` с последующим повышением, ровно по принятой в проекте логике «фаза 0».

### P2. Мелкие правки одним коммитом

| Что | Где |
|---|---|
| Удалить осиротевший комментарий о записи хода Нави | `content/src/schemas/modes.ts:55–59` |
| Согласовать `priority`/`actions` (обязательны в схеме, опциональны в типе) | `content/src/schemas/training.ts:19` ↔ `core/src/training-ai.ts:46–51` |
| Вынести общее backend-замыкание `localStorage` | `storage/src/index.ts` |
| `onQuotaExceeded` и проверка результата `write()` для повторов | `storage/src/createReplayStorage` |
| Предел размера `match.entities`/`grid.tiles` | `net/src/validation.ts`, `isSyncPayload` |
| Записывать команду в `replayDraft` после `applied.ok` | `session/src/index.ts:906–931` |
| Свести проходы по `state.entities` в блоке `END_TURN` | `core/src/kernel.ts:1449–1551` |

Для устранения дублирования enum между схемой и типом лучший приём — вывести тип из схемы, а в ядре оставить проверку совместимости:

```ts
// packages/core/tests/contract.test.ts — не даст типам разъехаться молча
import type { TrainingEnemyAction } from "../src/training-ai.js";
import type { z } from "zod";
import type { trainingEnemyActionSchema } from "@bylina/content";

type FromSchema = z.infer<typeof trainingEnemyActionSchema>;
// Ошибка компиляции, если схема и тип ядра расходятся:
const _check: TrainingEnemyAction = {} as FromSchema;
```

---

## 6. Метрики и наблюдения

**Hotspots сложности**

| Файл | Строк | Замечание |
|---|--:|---|
| `render/src/field-renderer.ts` | 4238 | `createFieldRenderer` — 3152 строки замыкания, 6 изменяемых `Map` |
| `ui/src/BattleScreenView.tsx` | 2951 | 32 `useState`, 22 `useEffect`, 12 подавлений deps |
| `core/src/kernel.ts` | 1884 | `createTacticsKernel` ~1670 строк; `apply` — цепочка `if` |
| `session/src/index.ts` | 1274 | оркестрация ролей, `guestOwner = 2` жёстко |
| `ui/src/CampaignScreen.tsx` | 1241 | в норме: 10 `useState`, 4 `useEffect` |

**Здоровье кодовой базы**

| Показатель | Значение |
|---|---|
| Исходники / тесты | 27 688 / 17 117 строк (0.62) |
| Тестовых файлов | 83 |
| `any` в `src` | **0** |
| `strict` + `noUncheckedIndexedAccess` | да |
| Подавления ESLint во всём `ui/src` | 12 (все в одном файле) |
| Порог покрытия | **отсутствует** |
| Внешние runtime-зависимости ядра | **0** |

**Распределение тестов** выявляет главный пробел: `core` — 21 файл, `ui` — 35, а `content` — 1, `storage` — 1, `replay` — 1, `render` — 5 при 4238 строках. Учитывая, что `storage` и `replay` содержат миграции и границы совместимости (то есть логику, ошибки в которой стоят пользователю прогресса), это самое выгодное место для новых тестов. `apps/game-pwa` — 0 тестов при 549 строках `App.tsx`, содержащих всю логику автосейва.

**Инструменты, которых не хватает:** `dependency-cruiser` (P1-5), `@vitest/coverage-v8` с порогом для `core`/`storage`/`campaign`, `fast-check` для property-based проверки детерминизма ядра (свойство «одинаковый seed и журнал → идентичный конечный снимок» формулируется прямо и защищает Critical-2 системно).

**Зависимости:** состав аккуратен и современен (React 18, PixiJS 8, Zod 3, Vitest 2, TS 5.6), лишнего нет, версии зафиксированы `pnpm-lock.yaml`, `onlyBuiltDependencies` явно ограничивает post-install скрипты `esbuild` и `sharp` — хорошая практика безопасности. Известных CVE по этим версиям не вижу, но проверить актуальность из моих данных не могу — стоит добавить `pnpm audit` в CI. `zod@3` при следующем обновлении потребует внимания: в 4.x менялся API.

---

## 7. Roadmap: подневный план для одного разработчика

Исходные допущения: один разработчик, знающий кодовую базу (автор), полные рабочие дни, 20 рабочих дней = 4 недели. Порядок не произвольный и его стоит соблюдать: сначала внешняя поверхность и потеря данных, затем страховочная сеть, и только потом рефакторинг. Менять местами дни 6–10 и дни 11–20 не нужно — крупные правки состояния без предварительных тестов и проверки границ придётся откатывать.

**Ритуал каждого дня.** Заканчивать день зелёным прогоном:

```bash
cd app && pnpm check:versions && pnpm typecheck && pnpm test && pnpm lint
```

Один день — один коммит (или один PR). Ни один день ниже не оставляет ветку в нерабочем состоянии, поэтому план можно прервать в любой точке.

---

### Неделя 1. Тихие отказы

**День 1. Разведка и CI**

Это единственный день с неизвестным на входе, поэтому он первый.

- Проверить, существует ли фактически `.github/workflows/ci.yml` и `deploy-pages.yml`, или `doc/examples/ci.yml` — только пример. В моём дампе был лишь пример, но 6954 файла отфильтрованы пресетом сборщика, так что вывод неокончательный.
- Если CI не установлен — установить `doc/examples/ci.yml` как есть (он качественный: три задачи, `concurrency`, `--frozen-lockfile`), прогнать на ветке, убедиться в зелёном.
- Добавить `pnpm audit --audit-level=high` в задачу `quality`.
- Завести ветку `hardening/0.21` и черновой чеклист из P0/P1.

**Готово, когда:** пуш в ветку запускает три задачи и они проходят. Без этого весь дальнейший план держится на ручных прогонах.

---

**День 2. Ретранслятор (P0-1)**

- `apps/signaling-server/src/server.mjs`: `maxPayload` в `new WebSocketServer`, `MAX_ROOMS`, `MAX_SOCKETS`, отказ `1013 OVERLOADED`.
- `peerId()` → `randomUUID()` из `node:crypto`.
- Лимиты — в переменные окружения рядом с уже существующей `RELAY_ALLOW_ORIGIN`, с теми же дефолтами.
- Тесты в `apps/signaling-server/tests/relay-server.test.ts`: кадр сверх предела рвёт соединение транспортом; создание комнаты сверх `MAX_ROOMS` даёт `CAPACITY`; соединение сверх `MAX_SOCKETS` закрывается.
- Обновить `apps/signaling-server/README.md` и раздел о ретрансляторе в `doc/operations.md` (владелец темы — там).

**Готово, когда:** тест на превышение кадра падал бы до правки и проходит после.

---

**День 3. Граница команд (P0-4) + мелкие правки сети**

- `net/src/validation.ts`: `value.path.length <= 256`; предикат `isCommandPayload(value): value is Command`; снять `as Command` в `session/src/index.ts:807`.
- Предел размера `match.entities` и `grid.tiles` в `isSyncPayload` — довести до принципа, уже заявленного в комментарии этого файла.
- Перенести запись в `replayDraft.commands` после `applied.ok` (`session/src/index.ts:906–931`), чтобы отклонённые команды не попадали в журнал.
- Тесты в `net/tests/` и `session/tests/`: длинный `path` отвергается; отклонённая команда ведомого в журнал не попадает.

**Готово, когда:** `pnpm typecheck` проходит без приведения типа в сессии.

Полдня освободится — добрать из P2-пакета: осиротевший комментарий `content/src/schemas/modes.ts:55–59`, дедупликация backend-замыкания в `storage/src/index.ts`, `onQuotaExceeded` для повторов.

---

**День 4. Живучесть автосохранения (P0-3)**

- `storage/src/index.ts`, `createSaveSerializer`: флаг `workerAlive`, откат на `serializeSaveDraft`, таймаут 4 с, `console.warn` при откате.
- Тест на мёртвый Worker — самая муторная часть дня: подменить `globalThis.Worker` заглушкой, которая вызывает `onerror` и больше не отвечает, и проверить, что второй вызов `serialize()` **разрешается**, а не висит.
- Тест на таймаут: заглушка молчит — промис всё равно разрешается.

**Готово, когда:** есть тест, который до правки висел бы до таймаута Vitest.

---

**День 5. Формат повтора, часть 1 (P0-2)**

- `replay/src/index.ts`: `REPLAY_FORMAT_VERSION = 1`, `RULES_VERSION = 1`, `appVersion` только для диагностики; `replayCompatibility()`.
- `isReplayJournal` под новую форму.
- Миграция уже записанных журналов: в `localStorage` лежат записи с полем `version: string` и без `formatVersion`. Решить осознанно — считать их `formatVersion: 0` и помечать «записано прежним форматом», либо отбрасывать. Отбрасывать честнее и дешевле; в списке повторов до 20 записей, потеря невелика.
- Тесты в `replay/tests/`.

**Готово, когда:** старый журнал не воспроизводится молча ни при каком раскладе.

---

### Неделя 2. Страховочная сеть

**День 6. Формат повтора, часть 2 — интерфейс**

- Экран списка повторов: пометка «другие правила» для `otherRules`, отказ с объяснением для `unsupported`.
- Ключи в `i18n/locales/ru` и `en`; прогнать `pnpm check:i18n` (в пакете уже есть `scripts/check-dictionaries.mjs`).
- Дописать в `check-version-consistency.mjs` напоминание: изменения в `core/src/combat.ts`, `los.ts`, `rng.ts` требуют решения по `RULES_VERSION`. Не автоматический запрет, а заметный вывод в консоль.
- `doc/roadmap.md` и `doc/debug-mode.md` §3.3 — привести в соответствие.

**Готово, когда:** повтор, записанный другими правилами, виден в списке и не запускается без предупреждения.

---

**День 7. Границы модулей в CI (P1-5, часть 1)**

- `app/.dependency-cruiser.cjs`: правила `core-remains-pure`, `layers-point-down` по всем пяти слоям из architecture §2, `no-cycles`.
- Скрипт `check:boundaries`, отдельный шаг в задаче `lint` CI.
- Убедиться, что на текущем коде правила зелёные (по моей проверке — да, граф соответствует объявленному), и что искусственное нарушение их роняет.

**Готово, когда:** импорт `@bylina/ui` в `core/src` роняет CI.

---

**День 8. Типизированный линтинг (P1-5, часть 2)**

- `recommendedTypeChecked` + `projectService`, `no-floating-promises` и `no-misused-promises` в режиме `warn`.
- Прогнать, оценить объём. Ожидаемо будет пачка предупреждений вокруг `void promise.then()` — разбирать не сегодня, только зафиксировать список.
- Линт в CI держать отдельной задачей: типизированный проход заметно медленнее.
- Отметить в `eslint.config.mjs` комментарием как «фаза 1» — по уже принятой в проекте логике.

**Готово, когда:** предупреждения видны, сборка не падает, список известен.

---

**День 9. Тест исчерпывающности `cloneState` (P1-4, часть 1)**

- `core/tests/clone-state.test.ts`: партия со **всеми** необязательными полями — `poison`, `panic`, `skillCooldowns`, `skillUses`, `weaponIds`, `skillIds`, `immobileTurns`, `timedLife`, `extracted`, `apple`, `objective`, `edge`. Без полного набора тест пропустит ровно тот случай, ради которого написан.
- Обход графа, сверка значений через `structuredClone` и проверка отсутствия общих ссылок на каждом уровне.
- Проверка глушением: временно убрать `poison: entity.poison ? { ...entity.poison } : undefined` из `cloneState` — тест обязан упасть.

**Готово, когда:** глушение любой строки `cloneState` роняет тест.

---

**День 10. Тесты хранения и детерминизма (P1-4, часть 2)**

- `storage/tests/`: миграция 1 → 2; отказ на неизвестном будущем формате; `QuotaExceededError` не прерывает игру; **валидация `SaveData.match`** — сейчас не проверяется вовсе (Major-5). Здесь же решить, вводить ли Zod-схему для `SaveData`; в проекте Zod уже применяется к контенту, и граница сохранений заслуживает того же.
- Property-based тест детерминизма ядра: `fast-check`, свойство «одинаковый seed и последовательность команд → идентичный конечный снимок». Это системная защита Critical-2, работающая и в будущем.

**Готово, когда:** испорченный `match` в сохранении отклоняется чисто, а не падает внутри ядра.

---

### Неделя 3. Единый источник снимка

Самая содержательная правка плана. Три дня, потому что затрагивает три пакета и снимает корень половины подавлений `exhaustive-deps`.

**День 11. Ревизия в ядре и сессии (P1-1, часть 1)**

- `core/src/kernel.ts`: счётчик `revision`, инкремент в `refresh`, `getRevision()` в интерфейсе `TacticsKernel`.
- `session/src/index.ts`: `getBattleRevision()`, `subscribeBattle()`.
- Тест: `revision` растёт на каждом успешном `apply` и **не растёт** на запросах предпросмотра (`getHitPreview`, `getSkillPreview`, `getPath`) — это прямо следует из architecture §3.7 «запросы предпросмотра не изменяют состояние».

**Готово, когда:** ядро и сессия отдают ревизию, тесты пакетов `core` и `session` зелёные. UI ещё не тронут.

---

**День 12. Перевод экрана боя на ревизию (P1-1, часть 2)**

- `BattleScreenView.tsx:444`: снимок через `useSyncExternalStore` + `useMemo` по `revision`.
- Перевести на `revision` мемоизации `visibleCells`, `exploredCells` (546–557), `directiveView` (456–471) и эффекты на строках 471, 503–504, 602, 667.
- Снять подавления `exhaustive-deps`, ставшие ненужными. Остальные — оставить и разобрать поштучно завтра.

**Готово, когда:** `ui/tests/` (35 файлов, включая `prologue-chain`, `boot-saved`, `prologue-m2`) зелёные без правки самих тестов. Если тест пришлось менять — разобраться, почему поведение изменилось, а не подгонять ожидание.

---

**День 13. Проверка эффекта и остаток подавлений**

- Замер: сколько раз `cloneState` вызывается за типовой ход до и после. Простой счётчик в ядре плюс `performance.mark` вокруг рендера. Ожидание — снимок один раз на изменение боя вместо каждого рендера, и главное — `directiveView` больше не запускает поиск пути на наведение курсора.
- Разобрать оставшиеся подавления `exhaustive-deps` поштучно: каждое либо снимается, либо получает комментарий, объясняющий именно этот случай (а не общий «признак устаревания», который после P1-1 неверен).
- День 13 — резервный: если день 12 затянулся, работа переносится сюда.

**Готово, когда:** число подавлений в `ui/src` известно, каждое обосновано, замер зафиксирован в описании коммита.

---

**День 14. Таймер повтора и остаток P2**

- P1-3: индекс в `ref`, интервал создаётся один раз, deps полны, подавление снято (`BattleScreenView.tsx:396–409`).
- Контрактный тест схемы против типа ядра (`priority`/`actions` обязательны в схеме, опциональны в типе — Major-9 из первого раздела): `core/tests/contract.test.ts` с проверкой на этапе компиляции.
- Свести многократные проходы по `state.entities` в блоке `END_TURN` (`kernel.ts:1449–1551`) — **аккуратно, сохраняя сортировки по `id`**; порядок событий здесь влияет на детерминизм повтора. Property-based тест дня 10 прикрывает эту правку, поэтому она стоит после него, а не до.
- `deleteReplay`/`clearReplays` — проверять результат `write()`.

**Готово, когда:** property-based тест детерминизма зелёный после правки `END_TURN`.

---

**День 15. Выпуск и разбор долга**

- `pnpm version:set minor` → 0.21.0.
- Проверить `check:versions` и `audit:visual`.
- Прогнать сборку, установить PWA, пройти пролог целиком руками: сохранение и продолжение былины, запись и воспроизведение повтора, сетевой бой с ведомым на втором устройстве.
- Обновить `doc/roadmap.md`: что закрыто, что перенесено.
- Повысить `no-floating-promises` до `error`, если список дня 8 разобран; иначе оставить `warn` и внести в бэклог явно.

**Готово, когда:** выпуск установлен и проверен на живом устройстве, а не только в CI.

---

### Неделя 4. Намерение игрока

**День 16. Проектирование `battle-intent.ts` (P1-2, часть 1)**

- Тип `Intent` как размеченное объединение (`idle` / `selected` / `aiming` / `placing` / `charging`), покрывающее семь текущих `useState`: `selectedId`, `action`, `aimId`, `skillTargetPos`, `charge`, `chargeArmed`, `preview`.
- Чистая функция `nextIntent(current, event)` — по образцу уже существующих `battle-selection.ts` и `battle-cell-click.ts`.
- Тесты **до** интеграции: `ui/tests/battle-intent.test.ts`, без DOM. Здесь же явно проверить недостижимость комбинаций «прицеливание без выбранного бойца» и «`chargeArmed` без плана».

**Готово, когда:** модуль и тесты есть, `BattleScreenView` ещё не тронут. Это важно: сегодняшний коммит самостоятелен.

---

**День 17. Интеграция за производными значениями**

- Ввести `const [intent, setIntent] = useState<Intent>({ kind: "idle" })` и **оставить прежние имена как производные**:

```tsx
const selectedId = intent.kind === "idle" ? null : intent.actorId;
const aimId = intent.kind === "aiming" ? intent.targetId : null;
```

- Перевести обработчики на `setIntent`/`nextIntent`, не касаясь JSX.

**Готово, когда:** JSX не изменён ни на строку, `ui/tests/` зелёные. Приём даёт откат в одну ревизию, если что-то поехало.

---

**День 18. Снятие производных**

- Заменить производные на прямые проверки `intent.kind` в JSX, удалить семь старых `useState`.
- Пересчитать плотность состояния: было 32 `useState`, ожидается 26–27.

**Готово, когда:** производных значений не осталось, DOM-тесты зелёные.

---

**День 19. Первый слой из `field-renderer.ts`**

Начало долгой работы, которую **не нужно делать разом**. Проверенный в этом пакете рецепт уже есть: вынесенные `camera.ts`, `fringe.ts`, `token-art.ts` оказались тестируемыми (`camera.test.ts` — 266 строк), тогда как само замыкание на 3152 строки — нет.

- Вынести один слой — всплывающий текст (`FloatText`, `FLOAT_MS`, `FLOAT_RISE`, `MAX_FLOAT_TEXTS`, ~строки 968–976 и связанное рисование). Он самый обособленный: своё состояние, свой жизненный цикл, нет связи с камерой и туманом.
- `render/src/float-text.ts` + тест на вытеснение самого старого при переполнении `MAX_FLOAT_TEXTS`.

**Готово, когда:** слой вынесен, покрыт тестом, `createFieldRenderer` короче на сопоставимый объём.

---

**День 20. Решение по числу участников и планирование**

- Закрыть Major-7 решением, а не кодом: `session/src/index.ts:917` жёстко задаёт `guestOwner = 2`, тогда как `kernel.ts:122` `nextOwner` обобщён и его комментарий обещает произвольное число участников. Дешёвый честный вариант — снять обещание из комментария ядра и зафиксировать ограничение в `doc/network-protocol.md`. Обобщение сессии до N — отдельная работа на недели, и её место в бэклоге, а не здесь.
- Составить план следующего месяца по остатку: слои `field-renderer.ts` (туман, кинематографические сцены, рисование фишек), декомпозиция `apply` в `kernel.ts` на обработчики команд, порог покрытия для `core`/`storage`/`campaign`.
- Внести в `doc/` правило процесса: инвариант, записанный в документации, обязан иметь проверку в CI. Три первых уже есть (границы, чистота ядра, версии) — зафиксировать это как норму.

**Готово, когда:** расхождение кода и заявленного намерения устранено в одну сторону, бэклог на месяц вперёд записан.

---

### Что остаётся за пределами 20 дней

Не поддаётся подневному планированию и не должно: работа идёт слоями, каждый слой окупается сразу.

| Работа | Оценка | Приём |
|---|---|---|
| `field-renderer.ts` → оркестровка слоёв ~500 строк | 3–6 недель, по слою за раз | Рецепт дня 19, повторяемый |
| `apply` в `kernel.ts` → обработчики команд | 1–2 недели | Только под прикрытием property-based теста детерминизма |
| Порог покрытия `core`/`storage`/`campaign` | 3–5 дней | Начать с `storage` и `replay`: там по 1 тестовому файлу при логике миграций |
| Снимок правил и контента в журнале повтора | 1 неделя | Делает старые записи воспроизводимыми, а не только корректно отклоняемыми |
| Обобщение сессии до N участников | 2–3 недели | Только если решение дня 20 было в эту сторону |

Итог четырёх недель: закрыты все Critical и P0, обе версии формата гарантируют совместимость, границы модулей и чистота ядра проверяются машиной, состояние экрана боя перестало допускать недостижимые комбинации, и начата декомпозиция рендерера по рецепту, который в этом пакете уже сработал.

---

## 8. Заключение

Это заметно более зрелая кодовая база, чем обычно приходит на ревью. Три вещи стоит признать прямо: ядро **действительно** изолировано (проверил импорты и глобали — не декларация, а факт), типизация строже, чем у большинства production-проектов (`noUncheckedIndexedAccess` при нулевом `any`), а документация нормативна и не разошлась с кодом — редчайший случай, обычно на этом месте главный раздел findings.

Отдельно отмечу то, что легко не заметить: **рефакторинг здесь уже идёт, и идёт правильно**. Двадцать чистых модулей, вынесенных из экрана боя, разделение схем по областям, `lazy()` для PixiJS, `harness.tsx` для DOM-тестов, скрипт согласованности версий — это последовательная программа с проставленными фазами. Мои рекомендации по декомпозиции — не смена курса, а продолжение уже выбранного, с указанием, где остаток плотнее всего.

Настоящие риски лежат не в архитектуре, а в **тихих отказах**: ретранслятор с недействующим лимитом кадра, повтор, который расходится с боем и молчит, автосейв, замолкающий навсегда после одной ошибки Worker. Все три объединяет то, что пользователь узнаёт о поломке последним и без объяснения. Каждая правится за десятки строк — почему они и стоят первыми.

**Сохранить обязательно:** чистоту ядра и запрет на её нарушение; сортировки ради детерминизма; ссылки на параграфы спецификации в комментариях (`§16.1: poison before every other beginning-of-turn system` — это лучшая документация решений, чем отдельный ADR); независимость `SAVE_FORMAT_VERSION` от версии приложения; `destroy()` в рендерере как эталон работы с ресурсами; принцип «одна тема — один документ».

Главный вывод в одну фразу: **архитектура здорова, программа декомпозиции верна — нужно закрыть тихие отказы и перевести уже соблюдаемые инварианты из области внимания в область автоматической проверки.**

Готов углубиться в любой раздел: разобрать `field-renderer.ts` послойно с конкретным планом вынесения, написать тесты из P1-4 целиком, спроектировать `battle-intent.ts` с полным набором переходов или пройти `kernel.ts` построчно на предмет боевых правил против `game-rules.md`.