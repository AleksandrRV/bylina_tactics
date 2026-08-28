# Доработка Первой миссии (M1) пролога — Перечень правок

---

## 1. Визуал: главный герой, палка, крыса

### 1.1. Текущая проблема

В `app/packages/render/src/field-renderer.ts` отрисовка персонажей выполняется через словарь `CLASS_ART`. Для сущностей, отсутствующих в словаре, применяется запасной круг:

```typescript
const art = CLASS_ART[entity.configId];
if (art) art({ g, cx, cy });
else g.circle(cx, cy, 10).fill(FALLBACK_ART[entity.owner === 2 ? "nav" : "druzhina"]);
```

Записи `mikula_peasant`, `forest_rat` и `stick` в `CLASS_ART` отсутствуют — все три рисуются кружками.

### 1.2. Файл: `app/packages/render/src/field-renderer.ts`

#### 1.2.1. Добавить функцию `drawMikula`

Добавить новую функцию отрисовки Микулы-крестьянина (до составления `CLASS_ART`). Персонаж — крестьянин без оружия, в простой одежде. Рекомендуется:

- Тело: овальная основа в серо-коричневых тонах (крестьянская рубаха), без доспехов.
- Голова: круг с волосами (светло-русые), без шлема.
- Руки: пустые (без оружия) или с лёгким намёком на кулаки.
- Цветовая гамма: тёплые земляные тона (`0x8a7a5a`, `0x6b5a3a`), контраст с янтарным кольцом дружины.
- Масштаб: вписать в те же габариты, что и остальные персонажи (~35px диаметр).

```
// Псевдокод структуры:
function drawMikula({ g, cx, cy }: TokenCtx): void {
  // Тело — рубаха
  // Голова
  // Волосы
  // Пояс
  // Руки (пустые)
  // Лапти
}
```

#### 1.2.2. Добавить функцию `drawForestRat`

Добавить функцию отрисовки лесной крысы. Сущность принадлежит Нави (`owner === 2`), поэтому рисуется на шестиугольной подставке (это уже обрабатывается в `drawToken`). Сам знак должен быть узнаваемым:

- Тело: вытянутый овал (крысиное тело), тёмно-серый/бурый (`0x4a4038`).
- Голова: треугольная морда с заострённым носом.
- Уши: два маленьких круга.
- Хвост: изогнутая линия.
- Глаза: две маленькие точки (красноватые или жёлтые).
- Масштаб: чуть меньше стандартного юнита (~28px), чтобы подчеркнуть «мелкость» крысы.

#### 1.2.3. Добавить функцию `drawStick`

Палка (`configId: "stick"`, `owner: 0`) — подбираемый предмет. Отрисовка:

- Палка: наклонная линия/овал коричневого цвета (`0x8a6a42`), длина ~20px.
- Небольшое свечение/подсветка, чтобы предмет был заметен на карте (мягкий янтарный ореол).
- Тень под палкой.

#### 1.2.4. Обновить словарь `CLASS_ART`

```typescript
const CLASS_ART: Partial<Record<string, (ctx: TokenCtx) => void>> = {
  bogatyr: drawBogatyr,
  strelets: drawStrelets,
  znaharka: drawZnaharka,
  upyr: drawUpyr,
  leshy: drawLeshy,
  kikimora: drawKikimora,
  volkhv: drawVolkhv,
  forest_beast: drawForestBeast,
  illusion: drawIllusion,
  idol: drawIdol,
  captive: drawCaptive,
  baba_yaga: drawBabaYaga,
  solovey: drawSolovey,
  // --- НОВЫЕ ЗАПИСИ ---
  mikula_peasant: drawMikula,
  forest_rat: drawForestRat,
  stick: drawStick,
};
```

#### 1.2.5. Обработка палки в `drawToken`

Палка имеет `owner: 0` и `coverType: 0`. В текущем `drawToken` сущности с `owner === 0` не получают подставку ни дружины, ни Нави. Нужно убедиться, что для `owner === 0` и `configId === "stick"` подставка не рисуется, а вызывается только `drawStick`. Проверить блок:

```typescript
if (entity.owner === 2) {
  // шестиугольная подставка Нави
} else {
  // круглая подставка дружины
}
```

Для `owner === 0` добавить условие: не рисовать подставку, перейти сразу к `CLASS_ART`.

---

## 2. Доработка карты уровня

### 2.1. Текущая проблема

Карта M1 в `app/packages/content/data/prologue_missions.json5` полностью плоская:

```
"....................",
"....t.....t......t..",
"..................F.",
".M..t..........t...S",
"....................",
"....t.....t......t..",
```

- Все клетки `z = 1` (единый ярус).
- Нет ям, укрытий, стен, перепадов высот.
- Только декоративные кусты `t`.
- Размер 20×6 — узкая «кишка», нет пространства для манёвра.

### 2.2. Файл: `app/packages/core/src/prologue-layout.ts`

#### 2.2.1. Поддержка карт высот в раскладке

Текущий `compilePrologueLayout` принимает единый `defaultZ` для всех клеток. Нужно добавить поддержку индивидуальных ярусов.

**Вариант А (рекомендуемый):** Расширить легенду символами высот. Добавить в `compilePrologueLayout` обработку символов `0`, `1`, `2` как маркеров яруса клетки:

```
"0" → tile.z = 0
"1" → tile.z = 1
"2" → tile.z = 2
```

При этом данные символы не создают маркеров (`pushMarker`), а только устанавливают ярус. Клетка без символа высоты получает `defaultZ`.

**Вариант Б:** Добавить отдельный массив `heights` в объект `layout`, параллельный `rows`. Более многословно, но не конфликтует с символами легенды.

#### 2.2.2. Создание декоративных сущностей из маркеров `t`

Сейчас маркер `t` попадает в `markers`, но не порождает визуальной сущности. Декоративные кусты на тайлах рисуются процедурно в `drawTile` по хешу, но маркеры `t` из легенды не влияют на них.

Нужно в `compilePrologueLayout` для маркеров с `kind: "decor"` создавать декоративные сущности (или передавать информацию в рендерер). Рекомендуется:

- В `CompiledLayout` добавить массив `decor: { x: number; y: number; type: string }[]`.
- В `compilePrologueLayout` при обработке маркера проверять `legend[ch]?.kind === "decor"` и заполнять `decor`.
- В `field-renderer.ts` при отрисовке тайлов учитывать массив `decor` и рисовать явный куст в указанных позициях (вместо или в дополнение к процедурному декору).

### 2.3. Файл: `app/packages/content/data/prologue_missions.json5`

#### 2.3.1. Переработать раскладку M1

Увеличить карту и добавить разнообразие. Рекомендуемая раскладка (пример, ~22×10):

```
"0011111111111111111100",
"0.1..t...1..t....1.t.0",
"01..t.......2....t..F0",
"1.M..t..1.......t...S0",
"1....t....1..t......10",
"01..t...c...t....t..10",
"0011111111111111111100",
```

Где:
- `0`, `1`, `2` — ярусы рельефа (низина, основной уровень, возвышение).
- `t` — кусты (декор).
- `c` — полуукрытие (плетень/валежник).
- `M` — Микула.
- `S` — палка.
- `F` — точка появления крысы.
- `.` — обычная земля.

**Принципы:**
- Края карты — низины (`z=0`), центр — основной уровень (`z=1`), 1–2 возвышения (`z=2`) для визуального разнообразия.
- 3–5 кустов `t` в разных частях карты.
- 1–2 полуукрытия `c` (не мешают прохождению, но дают визуальное разнообразие).
- Палка `S` остаётся на расстоянии ≥ 18 клеток от Микулы (условие: полный рывок не достаёт).
- Точка появления крысы `F` — у края карты, за пределами видимости Микулы на старте.
- **Не добавлять ямы (`P`) и стены (`W`)** — по сценарию М1 (раздел 7.1 `campaign.md`) ямы и укрытия выключены, это миссия-введение.

#### 2.3.2. Обновить `heightMix`

Текущий `heightMix: { z0: 0.0, z1: 1.0, z2: 0.0 }` не влияет на фиксированную раскладку, но для консистентности обновить:

```
heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
```

### 2.4. Файл: `app/packages/render/src/field-renderer.ts`

#### 2.4.1. Отрисовка явного декора

В `paintStatic` / `drawTile` добавить проверку: если для данной клетки есть запись в `decor` (из `CompiledLayout`), рисовать явный куст вместо процедурного. Куст рисуется как 2–3 перекрывающихся зелёных эллипса (аналогично стилю `bush` из `drawCover`, но без семантики укрытия).

#### 2.4.2. Визуальное отображение перепадов высот

Уже реализовано через `RISE` и откосы. Убедиться, что при наличии разных ярусов откосы и тени рисуются корректно. Проверить `drawTile`: блок `dropSouth` и тени от соседей уже обрабатывают перепады.

---

## 3. Кинематографичность: система камеры и катсцен

### 3.1. Текущая проблема

В `app/packages/render/src/camera.ts` существуют заготовки `CameraDirectorState`, `enqueueCameraCue`, `beginCameraCue`, `skipCameraCue`, `finishCameraCue`, но они **не используются** в `field-renderer.ts` и `BattleScreenView.tsx`. Камера статична (центрируется на поле через `fit()`), подводка реализована только для обучения (`trainingGlideOffset`).

### 3.2. Архитектура системы катсцен

Система должна быть **системной и декларативной**, не привязанной к M1.

#### 3.2.1. Файл: `app/packages/render/src/camera.ts` — расширить

Дополнить существующие структуры:

```typescript
export type CameraCueKind = "panTo" | "panThreat" | "panReturn" | "zoomTo" | "hold";

export interface CameraCue {
  kind: CameraCueKind;
  // Цель: координаты клетки ИЛИ идентификатор сущности
  target?: { x: number; y: number };
  targetEntityConfigId?: string;
  durationMs: number;
  // Для "hold" — время удержания камеры на месте
}

export interface CutsceneStep {
  cue: CameraCue;
  // Условие завершения шага: по времени или по событию
  completeOn?: "timer" | "event";
}

export interface CutsceneDefinition {
  id: string;
  trigger: CutsceneTrigger;
  steps: CutsceneStep[];
  // Блокировать ввод на время катсцены
  lockInput: boolean;
}

export type CutsceneTrigger =
  | { kind: "missionStart" }
  | { kind: "onSpawn"; entityConfigId: string }
  | { kind: "onFlag"; flag: string }
  | { kind: "onPickup"; itemId: string };
```

#### 3.2.2. Файл: `app/packages/render/src/camera.ts` — камера как сущность

Добавить класс/объект `CameraController`:

```typescript
export interface CameraControllerState {
  // Текущая позиция камеры (мировые координаты центра видимой области)
  centerX: number;
  centerY: number;
  zoom: number;
  // Анимация
  animating: boolean;
  animStartTime: number;
  animDuration: number;
  animFromX: number;
  animFromY: number;
  animToX: number;
  animToY: number;
  // Очередь кью
  queue: CameraCue[];
  currentCue: CameraCue | null;
  inputLocked: boolean;
}
```

Функции:
- `createCameraController()` — инициализация.
- `enqueueCue(state, cue)` — добавить в очередь.
- `startCutscene(state, definition)` — запустить катсцену (заполнить очередь из `steps`).
- `updateCamera(state, dt, world, screen)` — обновить позицию камеры (вызывается каждый кадр).
- `isAnimating(state)` — идёт ли анимация.
- `getWorldTarget(cue, entities)` — разрешить цель кью в мировые координаты (поиск сущности по `configId`).

#### 3.2.3. Файл: `app/packages/render/src/field-renderer.ts` — интеграция камеры

В `createFieldRenderer`:

1. Добавить поле `cameraState: CameraControllerState`.
2. В `update(view)` — если есть активная катсцена, не вызывать `fit()`, а использовать `updateCamera`.
3. Добавить метод `startCutscene(definition: CutsceneDefinition)` в интерфейс `FieldRenderer`.
4. В `animLoop` вызывать `updateCamera` каждый кадр.
5. Во время `inputLocked` — игнорировать `onActivate`, `onHover`, `pan`, pinch-zoom.

```typescript
// В интерфейсе FieldRenderer добавить:
startCutscene(definition: CutsceneDefinition): void;
skipCutscene(): void;
isCutscenePlaying(): boolean;
```

#### 3.2.4. Файл: `app/packages/core/src/types.ts` или новый файл — описание катсцен в конфигурации миссии

Добавить в `PrologueMissionConfig` (схема в `app/packages/content/src/schemas.ts`) опциональное поле:

```typescript
cutscenes?: CutsceneConfig[];
```

Где `CutsceneConfig` — сериализуемое описание:

```typescript
interface CutsceneConfig {
  id: string;
  trigger: { kind: string; entityConfigId?: string; flag?: string; itemId?: string };
  steps: {
    target?: { x: number; y: number };
    targetEntityConfigId?: string;
    durationMs: number;
    kind: string;
  }[];
  lockInput: boolean;
}
```

#### 3.2.5. Файл: `app/packages/content/src/schemas.ts` — схема катсцен

Добавить Zod-схему:

```typescript
const cutsceneStepSchema = z.object({
  target: z.object({ x: z.number(), y: z.number() }).optional(),
  targetEntityConfigId: id.optional(),
  durationMs: z.number().min(100).max(5000),
  kind: z.enum(["panTo", "panThreat", "panReturn", "zoomTo", "hold"]),
}).strict();

const cutsceneConfigSchema = z.object({
  id: z.string(),
  trigger: z.object({
    kind: z.enum(["missionStart", "onSpawn", "onFlag", "onPickup"]),
    entityConfigId: id.optional(),
    flag: z.string().optional(),
    itemId: z.string().optional(),
  }).strict(),
  steps: z.array(cutsceneStepSchema).min(1),
  lockInput: z.boolean(),
}).strict();
```

Добавить `cutscenes: z.array(cutsceneConfigSchema).optional()` в `prologueMissionConfigSchema`.

### 3.3. Определение катсцен для M1

#### 3.3.1. Файл: `app/packages/content/data/prologue_missions.json5`

Добавить в миссию `prologue_brushwood` поле `cutscenes`:

```json5
cutscenes: [
  {
    id: "m1_intro",
    trigger: { kind: "missionStart" },
    lockInput: true,
    steps: [
      // 1. Камера на Микуле (крупный план)
      { targetEntityConfigId: "mikula_peasant", durationMs: 1200, kind: "zoomTo" },
      // 2. Переход к палке
      { targetEntityConfigId: "stick", durationMs: 1000, kind: "panTo" },
      // 3. Удержание на палке
      { kind: "hold", durationMs: 800 },
      // 4. Возврат к Микуле
      { targetEntityConfigId: "mikula_peasant", durationMs: 1000, kind: "panReturn" },
    ],
  },
  {
    id: "m1_rat_appear",
    trigger: { kind: "onSpawn", entityConfigId: "forest_rat" },
    lockInput: true,
    steps: [
      // 1. Камера на крысе (она "выбегает")
      { targetEntityConfigId: "forest_rat", durationMs: 600, kind: "panTo" },
      // 2. Удержание
      { kind: "hold", durationMs: 700 },
      // 3. Возврат к Микуле
      { targetEntityConfigId: "mikula_peasant", durationMs: 800, kind: "panReturn" },
    ],
  },
],
```

### 3.4. Файл: `app/packages/ui/src/BattleScreenView.tsx` — запуск катсцен

#### 3.4.1. Обработка триггеров катсцен

В компоненте `BattleScreenView`:

1. При монтировании (`useEffect` на `kernel`) — если есть катсцена с триггером `missionStart`, вызвать `rendererRef.current?.startCutscene(...)`.
2. Подписаться на события ядра: при получении `ENTITY_SPAWNED` проверить, есть ли катсцена с триггером `onSpawn` и совпадающим `entityConfigId` — запустить.
3. Во время катсцены (`isCutscenePlaying()`) — блокировать вызовы `onCell`, `endTurn`, выбор юнитов.

#### 3.4.2. Блокировка ввода

Добавить состояние `cutscenePlaying: boolean`. Пока `true`:
- `onCell` не обрабатывает клики.
- Кнопки панели заблокированы (`disabled`).
- `endTurn` не вызывается.

После завершения катсцены (`onCutsceneComplete` callback) — разблокировать.

### 3.5. Анимация «выбегания» крысы

#### 3.5.1. Файл: `app/packages/core/src/prologue-run.ts`

Сейчас крыса появляется мгновенно через `spawnRats(kernel, [ctx.ratMarker], true)`. Нужно:

1. Добавить в `PrologueRunContext` поле `ratEntryPath: { x: number; y: number }[]` — путь, по которому крыса «вбегает» на карту.
2. При спавне крысы создавать её за пределами видимой области (за краем карты или на краю), а затем перемещать по пути.

**Рекомендуемый подход:** Не менять ядро (ядро не поддерживает анимацию перемещения при спавне). Вместо этого:

- Спавнить крысу на клетке `ratMarker` как сейчас.
- В рендерере при получении события `ENTITY_SPAWNED` для `forest_rat` запускать анимацию перемещения: крыса рисуется с смещением от края карты к целевой клетке (~500мс).
- Камера в это время следует за крысой (катсцена `m1_rat_appear`).

#### 3.5.2. Файл: `app/packages/render/src/field-renderer.ts`

В `playOne` для события `ENTITY_SPAWNED`:
- Если `entity.configId === "forest_rat"` (или обобщённо — если есть активная катсцена `onSpawn`):
  - Добавить временное смещение (`spawnOffset`) для сущности.
  - Анимировать смещение от `(−2 * CELL_SIZE, 0)` к `(0, 0)` за ~600мс (крыса вбегает слева).
  - Направление входа определяется по позиции спавна относительно карты.

### 3.6. Файл: `app/packages/core/src/prologue-script.ts` — поддержка триггеров спавна

Убедиться, что при спавне крысы (в `afterPrologueApply` для `prologue_brushwood`) генерируется событие, по которому UI может запустить катсцену. Событие `ENTITY_SPAWNED` уже генерируется ядром при `spawnScripted`. Нужно только пробросить его в `BattleScreenView`.

---

## 4. Крыса как полноценный враг

### 4.1. Текущая проблема

Крыса после скриптованного промаха (первый ход) на последующих ходах уходит в `OVERWATCH` вместо атаки. Причина — в `pickEnemyCommand` (`app/packages/core/src/ai.ts`):

```typescript
const watcher = enemies.find((actor) => actor.ap > 0 && !actor.overwatch && actor.weaponId);
return watcher ? { type: "OVERWATCH", actorId: watcher.id } : null;
```

Это происходит когда `bestAttack` и `bestMove` возвращают `null`. Для крысы это означает, что она не может приблизиться к игроку (нет доступных клеток, уменьшающих дистанцию) или не видит его.

### 4.2. Файл: `app/packages/core/src/ai.ts`

#### 4.2.1. Диагностика и исправление `bestMove`

Проверить `bestMove`:

```typescript
else if (next >= now) {
  return null;
}
```

Если крыса не может приблизиться (все доступные клетки не уменьшают дистанцию), она возвращает `null`, и управление переходит к `OVERWATCH`. На открытой карте это не должно происходить, но может быть вызвано:

- Крыса не видит игрока (проверка `visible.has(...)` в `pickEnemyCommand`).
- Все клетки движения заблокированы.

**Исправление:** В `pickEnemyCommand` для юнитов без `preferredRange` (крыса) убрать переход в `OVERWATCH`, если есть живые противники. Вместо этого — повторная попытка `bestMove` с менее строгим условием:

```typescript
// После основного цикла, если ни один юнит не нашёл действие:
// НЕ уходить в дозор, если есть живые враги
const watcher = enemies.find((actor) => actor.ap > 0 && !actor.overwatch && actor.weaponId);
// Дозор только если нет живых противников
if (foes.length === 0 && watcher) {
  return { type: "OVERWATCH", actorId: watcher.id };
}
return null; // если есть враги, но нет действий — завершить ход
```

#### 4.2.2. Альтернатива: скриптованное поведение крысы

В `app/packages/content/data/prologue_missions.json5` расширить скрипт М1:

```json5
script: {
  priority: [],
  actions: [
    { unitId: "forest_rat", side: "enemy", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "miss", onlyIf: "targetAlive" },
    { kind: "endTurn" },
    // Дальше крыса действует через обычный AI (скрипт исчерпан)
  ],
},
```

После исчерпания скрипта управление передаётся `pickEnemyCommand`. Убедиться, что исправление из п. 4.2.1 позволяет крысе атаковать.

### 4.3. Файл: `app/packages/core/src/prologue-run.ts`

#### 4.3.1. Проверка спавна крысы

В блоке `prologue_brushwood` в `afterPrologueApply`:

```typescript
if ((evaluated.fired.some((item) => item.flag === "stick") || standingOnStick) && !next.pickupDone) {
  next.pickupDone = true;
  armClubAndRemoveStick(kernel);
  next.objectiveKey = "prologue.objective.destroyAll";
  if (ctx.ratMarker) spawnRats(kernel, [ctx.ratMarker], true);
  enqueue(next, ctx, "m1.endTurn");
}
```

Крыса спавнится при подборе палки. Это корректно. Убедиться, что `spawnRats` вызывает `kernel.spawnScripted`, который генерирует событие `ENTITY_SPAWNED`.

### 4.4. Убедиться, что крыса атакует

После исправления AI (п. 4.2.1), крыса должна:
1. Первый ход (скрипт): атаковать с `forceOutcome: "miss"`.
2. Последующие ходы: `pickEnemyCommand` → `bestMove` (сближение) → `bestAttack` (атака при дистанции ≤ 1).

---

## 5. Смерть игрока: затемнение и возврат к чекпоинту

### 5.1. Текущая проблема

В `afterPrologueApply` для `prologue_brushwood`:

```typescript
const mikula = living(kernel.getSnapshot(), "mikula_peasant");
if (!mikula) {
  next.outcome = "defeat";
  return next;
}
```

При гибели Микулы устанавливается `outcome = "defeat"`, но:
- Нет чекпоинта для M1 (`checkpointArmed` проверяет только `fedotFreed`, `firstWave`, `vasilisaJoined` — ни один не относится к M1).
- Нет плавного затемнения.
- Нет возврата к моменту появления крысы.

### 5.2. Файл: `app/packages/core/src/prologue-run.ts`

#### 5.2.1. Добавить чекпоинт для M1

Расширить `PrologueRunState` полем `ratSpawned: boolean`:

```typescript
export interface PrologueRunState {
  ...
  ratSpawned: boolean; // M1: крыса появилась — чекпоинт активен
}
```

В `createPrologueRunState` инициализировать `ratSpawned: false`.

В блоке `prologue_brushwood` в `afterPrologueApply`, при спавне крысы:

```typescript
if (ctx.ratMarker) {
  spawnRats(kernel, [ctx.ratMarker], true);
  next.ratSpawned = true; // чекпоинт активирован
}
```

#### 5.2.2. Расширить `checkpointArmed`

```typescript
function checkpointArmed(state: PrologueRunState): boolean {
  return state.fedotFreed || state.firstWave || state.vasilisaJoined || state.ratSpawned;
}
```

#### 5.2.3. Обработка гибели Микулы в M1

Заменить текущую логику:

```typescript
if (!mikula) {
  next.outcome = "defeat";
  return next;
}
```

На:

```typescript
if (!mikula) {
  if (next.ratSpawned) {
    // Чекпоинт активен — не завершать миссию, а вернуть к чекпоинту
    // Флаг для UI: запустить затемнение и восстановить
    next.outcome = "ongoing"; // не "defeat"!
    next.checkpointRestoreRequested = true; // новое поле
  } else {
    next.outcome = "defeat";
  }
  return next;
}
```

Добавить в `PrologueRunState`:

```typescript
checkpointRestoreRequested: boolean;
```

### 5.3. Файл: `app/packages/ui/src/BattleScreenView.tsx`

#### 5.3.1. Затемнение экрана

Добавить состояние `fadeToBlack: boolean` и CSS-элемент затемнения:

```typescript
const [fadeToBlack, setFadeToBlack] = useState(false);
```

В JSX:

```tsx
{fadeToBlack && (
  <div
    className="battle-fade-overlay"
    style={{
      position: "absolute",
      inset: 0,
      background: "black",
      opacity: fadeOpacity, // анимируется от 0 до 1
      transition: "opacity 0.8s ease-in",
      zIndex: 100,
      pointerEvents: "none",
    }}
  />
)}
```

#### 5.3.2. Обработка `checkpointRestoreRequested`

В обработчике событий ядра (или в `useEffect` на `snapshot`):

```typescript
// Проверить, не запрошен ли возврат к чекпоинту
if (prologueRunRef.current?.checkpointRestoreRequested) {
  // 1. Запустить затемнение
  setFadeToBlack(true);
  
  // 2. Через 800мс (после затемнения) восстановить чекпоинт
  setTimeout(() => {
    session.restoreBattleCheckpoint();
    
    // 3. Ещё через 400мс убрать затемнение
    setTimeout(() => {
      setFadeToBlack(false);
      prologueRunRef.current = { ...prologueRunRef.current, checkpointRestoreRequested: false };
    }, 400);
  }, 800);
}
```

#### 5.3.3. Сохранение чекпоинта при спавне крысы

В `afterPrologueApply` для M1, при спавне крысы, вызвать `session.saveBattleCheckpoint()`:

```typescript
if (next.ratSpawned && !session.hasBattleCheckpoint()) {
  session.saveBattleCheckpoint();
}
```

Это нужно делать в `BattleScreenView`, где доступен `session`. Проверять после обработки событий:

```typescript
// После afterPrologueApply:
if (prologueRunRef.current?.ratSpawned && !session.hasBattleCheckpoint()) {
  session.saveBattleCheckpoint();
}
```

### 5.4. Файл: `app/packages/ui/src/battle.css`

Добавить стиль для затемнения:

```css
.battle-fade-overlay {
  position: absolute;
  inset: 0;
  background: #000;
  z-index: 100;
  pointer-events: none;
  transition: opacity 0.8s ease-in-out;
}
```

### 5.5. Файл: `app/packages/ui/src/prologue-battle.ts`

Убедиться, что `buildPrologueContext` передаёт `ratMarker` для M1. Проверить:

```typescript
const rat = layout?.markers.F?.[0];
```

Маркер `F` в раскладке M1 — точка появления крысы. Должен корректно извлекаться.

---

## 6. Сводная таблица правок по файлам

| Файл | Правки |
|---|---|
| `render/src/field-renderer.ts` | Добавить `drawMikula`, `drawForestRat`, `drawStick`; обновить `CLASS_ART`; обработка `owner === 0`; интеграция `CameraController`; анимация спавна крысы; отрисовка явного декора |
| `render/src/camera.ts` | Расширить `CameraCue`, добавить `CutsceneDefinition`, `CameraControllerState`, функции управления камерой |
| `render/src/palette.ts` | Без изменений (цвета для новых персонажей задаются в `draw*` функциях) |
| `core/src/prologue-layout.ts` | Поддержка ярусов в раскладке; массив `decor` в `CompiledLayout` |
| `core/src/prologue-run.ts` | Поле `ratSpawned`, `checkpointRestoreRequested`; расширение `checkpointArmed`; логика гибели Микулы с чекпоинтом |
| `core/src/ai.ts` | Исправление `pickEnemyCommand`: не уходить в `OVERWATCH` при наличии живых противников |
| `core/src/prologue-script.ts` | Без изменений (скрипт корректен) |
| `content/data/prologue_missions.json5` | Переработка раскладки M1; добавить `cutscenes`; обновить `heightMix` |
| `content/src/schemas.ts` | Схема `cutsceneConfigSchema`; поле `cutscenes` в `prologueMissionConfigSchema` |
| `ui/src/BattleScreenView.tsx` | Запуск катсцен; блокировка ввода; затемнение; обработка `checkpointRestoreRequested`; сохранение чекпоинта при спавне крысы |
| `ui/src/prologue-battle.ts` | Проверка `ratMarker`; проброс `ratSpawned` |
| `ui/src/battle.css` | Стиль `.battle-fade-overlay` |

---

## 7. Порядок реализации

1. **Визуал** (п. 1) — независим, можно делать первым.
2. **Карта** (п. 2) — зависит от поддержки ярусов в `prologue-layout.ts`.
3. **AI крысы** (п. 4) — независим, критичен для геймплея.
4. **Чекпоинт и затемнение** (п. 5) — зависит от п. 4 (крыса должна быть полноценным врагом, чтобы игрок мог умереть).
5. **Катсцены** (п. 3) — наиболее объёмный, зависит от п. 1–4 (нужны визуальные сущности и спавн крысы).

---

## 8. Тесты

Для каждой группы правок добавить/обновить тесты:

- **Визуал:** Убедиться, что `CLASS_ART` содержит новые ключи (проверка в `render.test.ts`).
- **Карта:** Тест `compilePrologueLayout` с ярусами и декором.
- **AI:** Тест, что крыса атакует, а не уходит в дозор (в `prologue-sim.test.ts`).
- **Чекпоинт:** Тест, что при гибели Микулы после спавна крысы происходит возврат к чекпоинту, а не `defeat`.
- **Катсцены:** Тест `CameraController` — очередь кью, блокировка ввода.