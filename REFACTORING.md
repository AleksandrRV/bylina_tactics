Ниже — максимально подробная проектная инструкция по разнесению `app/packages/render/src/field-renderer.ts` на логические модули так, чтобы:

- публичный API пакета не изменился;
- поведение отрисовки не изменилось;
- итоговый `field-renderer.ts` стал тонким композиционным корнем и был существенно меньше 1000 строк;
- код был разложен по предметным областям: геометрия, камера, рельеф, укрытия, сущности, эффекты, туман, атмосфера, ввод, проигрывание событий, кинематографические сцены.

> Важное практическое замечание. В исходном `field-renderer.ts` находится несколько тысяч строк пиксельной графики, анимаций и вспомогательных расчётов. В рамках одного ответа невозможно без потерь воспроизвести каждую строку графических подпрограмм. Поэтому ниже дан полный целевой код архитектурного каркаса, итогового `field-renderer.ts` и всех новых файлов, а для крупных графических тел указаны точные имена функций и места, куда их нужно перенести **1:1 без изменений**. Это сознательное требование рефакторинга: графика не должна быть случайно переписана во время структурного переноса.

---

# 1. Целевая архитектура

Текущий файл `field-renderer.ts` совмещает слишком много ответственностей:

1. создание Pixi-приложения;
2. слои и z-order;
3. камеру, масштабирование, панорамирование, pinch;
4. геометрию изометрической сетки;
5. отрисовку рельефа;
6. отрисовку укрытий;
7. отрисовку сущностей;
8. подсветки прицеливания, перемещения, обучения;
9. эффекты, всплывающие числа;
10. туман войны;
11. виньетку, зерно, затемнение;
12. кинематографические сцены;
13. проигрывание боевых событий;
14. пользовательский ввод;
15. служебное состояние.

Целевая структура:

```text
app/packages/render/src/
  field-renderer.ts
  field/
    types.ts
    constants.ts
    math.ts
    geometry.ts
    state.ts
    layers.ts
    camera.ts
    terrain.ts
    cover.ts
    entities.ts
    overlays.ts
    effects.ts
    fog.ts
    atmosphere.ts
    cinematic.ts
    event-player.ts
    input.ts
```

Публичный контракт остаётся прежним. `field-renderer.ts` продолжает экспортировать:

- `RENDER_STATUS`;
- `CELL_SIZE`;
- `CINEMATIC_ACCENT`;
- `CINEMATIC_SCALE_MAX`;
- `CINEMATIC_ZOOM`;
- `CINEMATIC_ZOOM_MS`;
- `RUN_IN_CELLS`;
- `createFieldRenderer`;
- типы `FieldRenderer`, `FieldView`, `CinematicPlan`, `CinematicStep`, `CinematicTarget`.

---

# 2. Порядок выполнения рефакторинга

Рекомендуется делать рефакторинг отдельными маленькими коммитами.

## Шаг 1. Создать папку `field`

```bash
mkdir -p app/packages/render/src/field
```

## Шаг 2. Вынести типы

Создать:

```text
app/packages/render/src/field/types.ts
```

Сюда переносятся:

- `FieldView`;
- `FieldRenderer`;
- `CinematicTarget`;
- `CinematicStep`;
- `CinematicPlan`;
- внутренние типы `DisplayState`, `Fx`, `FloatText`;
- интерфейсы состояния и окружения рендерера.

## Шаг 3. Вынести константы

Создать:

```text
app/packages/render/src/field/constants.ts
```

Сюда переносятся:

- `RENDER_STATUS`;
- `CELL_SIZE`;
- `RISE`;
- `PAD`;
- `FLOAT_MS`;
- `FLOAT_RISE`;
- `MAX_FLOAT_TEXTS`;
- `BOLT_MS_PER_CELL`;
- `CINEMATIC_ZOOM`;
- `CINEMATIC_ZOOM_MS`;
- `CINEMATIC_SCALE_MAX`;
- `CINEMATIC_ACCENT`;
- `RUN_IN_CELLS`;
- `FOG_DRIFT_INTERVAL_MS`;
- прочие локальные константы камеры, тумана, анимаций.

## Шаг 4. Вынести чистую математику

Создать:

```text
app/packages/render/src/field/math.ts
```

Сюда переносятся:

- `clamp`;
- `easeOut`;
- `easeInOut`;
- `shade`;
- `mix`;
- `hashCell`;
- другие чистые вспомогательные функции.

## Шаг 5. Вынести геометрию поля

Создать:

```text
app/packages/render/src/field/geometry.ts
```

Сюда переносятся:

- `faceOf`;
- `centerOf`;
- `visualLevel`;
- `neighborLevel`;
- `tileAt`;
- `cellFromLocal`;
- `worldToScreen`;
- `screenToWorld`;
- `mapPlane`;
- `fitScale`;
- `clampCameraOffset`;
- `trainingGlideOffset`.

## Шаг 6. Вынести состояние рендерера

Создать:

```text
app/packages/render/src/field/state.ts
```

Сюда переносится создание всего изменяемого состояния:

- `display`;
- `lunges`;
- `bumps`;
- `dying`;
- `flashes`;
- `fxs`;
- `floatTexts`;
- `jobs`;
- `pointers`;
- `pinch`;
- `fogSignature`;
- `reducedMotion`;
- `speedScale`;
- `inputLocked`;
- `hiddenEntities`;
- и т.д.

## Шаг 7. Вынести слои сцены

Создать:

```text
app/packages/render/src/field/layers.ts
```

Здесь создаются все контейнеры и графические слои:

- `world`;
- `terrain`;
- `dynamicLayer`;
- `fogBaseLayer`;
- `fogDriftLayer`;
- `fxLayer`;
- `glowLayer`;
- `labelsLayer`;
- `debugLayer`;
- `atmosphere`;
- `darknessG`;
- `vignetteG`;
- `edgeArrowG`;
- `fadeLayer`;
- `accentLayer`.

## Шаг 8. Вынести камеру

Создать:

```text
app/packages/render/src/field/camera.ts
```

Ответственность:

- `fit`;
- `pan`;
- `zoomAt`;
- `focusOn`;
- `glideToTrainingTarget`;
- `centerOnNow`;
- `focusCell`;
- `focusEntity`;
- `driveTrainingFocus`;
- хранение `userMoved`, `homeFramed`, `pendingTrainingFocus`.

## Шаг 9. Вынести рельеф

Создать:

```text
app/packages/render/src/field/terrain.ts
```

Сюда переносятся:

- `drawTile`;
- `paintFringe`;
- `paintStatic`;
- `paintDebug`;
- `biomeLookOf`;
- код откосов, теней, ям, камней, декоративной растительности.

## Шаг 10. Вынести укрытия

Создать:

```text
app/packages/render/src/field/cover.ts
```

Сюда переносятся:

- `drawCover`;
- `drawEdgeCover`;
- `drawCoverDamage`;
- `drawShieldIcon`.

## Шаг 11. Вынести отрисовку сущностей

Создать:

```text
app/packages/render/src/field/entities.ts
```

Сюда переносятся:

- отрисовка фишек;
- тени;
- кольца выбора;
- HP-бары;
- AP-пипсы;
- индикаторы защиты, овервотча, статусов;
- интеграция с `token-art.ts`.

## Шаг 12. Вынести оверлеи

Создать:

```text
app/packages/render/src/field/overlays.ts
```

Сюда переносятся:

- подсветка доступных клеток;
- маршрут;
- область умения;
- зона эвакуации;
- домашние края;
- яблоко;
- линия прицеливания;
- маркеры пересечения луча с укрытиями;
- подсветка защиты;
- обучающий фокус;
- стрелка края экрана.

## Шаг 13. Вынести эффекты и всплывающие числа

Создать:

```text
app/packages/render/src/field/effects.ts
```

Сюда переносятся:

- `fxs`;
- `paintFx`;
- `pushFloat`;
- `paintLabels`;
- windup, bolt, flash, skill, status, poof, extract, shards, pitfall и т.д.

## Шаг 14. Вынести туман войны

Создать:

```text
app/packages/render/src/field/fog.ts
```

Сюда переносятся:

- `computeFogSignature`;
- `paintFogBase`;
- `paintFogDrift`;
- `paintFog`;
- `prevVisibleKeys`.

## Шаг 15. Вынести атмосферу экрана

Создать:

```text
app/packages/render/src/field/atmosphere.ts
```

Сюда переносятся:

- виньетка;
- зерно;
- затемнение Тьмы;
- `fadeScreen`;
- `paintEdgeArrow`;
- `paintCinematicAccent`.

## Шаг 16. Вынести проигрыватель событий

Создать:

```text
app/packages/render/src/field/event-player.ts
```

Сюда переносятся:

- очередь `jobs`;
- `drain`;
- проигрывание `MOVE`, `ATTACK`, `STATUS`, `STAT_CHANGED`, `DEATH`, `SKILL`, `COVER_DESTROYED` и других событий;
- тряска камеры;
- выстрелы;
- ближний бой;
- всплывающие числа.

## Шаг 17. Вынести кинематографические сцены

Создать:

```text
app/packages/render/src/field/cinematic.ts
```

Сюда переносятся:

- `playCinematicPlan`;
- `zoomTo`;
- `runInEntity`;
- `fadeScreen` как часть сценической логики;
- `skipCinematic`;
- `isCinematicPlaying`;
- `finalPointOf`.

## Шаг 18. Вынести ввод

Создать:

```text
app/packages/render/src/field/input.ts
```

Сюда переносятся:

- `pointerdown`;
- `pointermove`;
- `pointerup`;
- `pointerupoutside`;
- `pointercancel`;
- `wheel`;
- `dblclick`;
- `contextmenu`;
- pinch-zoom;
- двойной тап;
- блокировка ввода.

## Шаг 19. Переписать `field-renderer.ts`

Оставить в нём только:

- создание окружения;
- монтаж;
- `update`;
- `play`;
- `pan`;
- `destroy`;
- публичные сеттеры;
- связку подсистем.

## Шаг 20. Прогнать проверки

```bash
pnpm -F render typecheck
pnpm -F render lint
pnpm -F render test
```

Дополнительно проверить циклы:

```bash
pnpm dlx madge --circular app/packages/render/src
```

Проверить размер файла:

```bash
wc -l app/packages/render/src/field-renderer.ts
wc -l app/packages/render/src/field/*.ts
```

Цель:

```text
field-renderer.ts < 1000 строк
```

Фактически после предложенной композиции он получается примерно 350–450 строк.

---

# 3. Полный код итогового файла

## `app/packages/render/src/field-renderer.ts`

```ts
/**
 * Поле боя: композиционный корень рендерера.
 *
 * После рефакторинга этот файл больше не хранит всю реализацию.
 * Он только собирает подсистемы:
 * - состояние;
 * - слои;
 * - камеру;
 * - рельеф;
 * - сущности;
 * - оверлеи;
 * - эффекты;
 * - туман;
 * - атмосферу;
 * - события;
 * - кинематографические сцены;
 * - ввод.
 *
 * Публичный контракт сохранён полностью.
 */
import { Application } from "pixi.js";
import type { CellPos, GameEvent } from "@bylina/core";

import {
  CELL_SIZE,
  CINEMATIC_ACCENT,
  CINEMATIC_SCALE_MAX,
  CINEMATIC_ZOOM,
  CINEMATIC_ZOOM_MS,
  RENDER_STATUS,
  RUN_IN_CELLS,
} from "./field/constants.js";

import type {
  CinematicPlan,
  FieldRenderer,
  FieldView,
} from "./field/types.js";

import { createFieldState } from "./field/state.js";
import { createFieldLayers } from "./field/layers.js";
import { createCameraRig } from "./field/camera.js";
import { createTerrainPainter } from "./field/terrain.js";
import { createEntityPainter } from "./field/entities.js";
import { createOverlayPainter } from "./field/overlays.js";
import { createFxSystem } from "./field/effects.js";
import { createFogSystem } from "./field/fog.js";
import { createAtmosphereSystem } from "./field/atmosphere.js";
import { createEventPlayer } from "./field/event-player.js";
import { createCinematicPlayer } from "./field/cinematic.js";
import { attachInput } from "./field/input.js";
import { centerOf, tileAt, visualLevel, worldToScreen } from "./field/geometry.js";

export {
  CELL_SIZE,
  CINEMATIC_ACCENT,
  CINEMATIC_SCALE_MAX,
  CINEMATIC_ZOOM,
  CINEMATIC_ZOOM_MS,
  RENDER_STATUS,
  RUN_IN_CELLS,
};

export type {
  CinematicPlan,
  CinematicStep,
  CinematicTarget,
  FieldRenderer,
  FieldView,
} from "./field/types.js";

export function createFieldRenderer(): FieldRenderer {
  const app = new Application();
  const state = createFieldState();
  const layers = createFieldLayers();

  const env = { app, layers, state };

  const camera = createCameraRig(env);
  const terrain = createTerrainPainter(env);
  const entities = createEntityPainter(env);
  const overlays = createOverlayPainter(env);
  const fx = createFxSystem(env);
  const fog = createFogSystem(env);
  const atmosphere = createAtmosphereSystem(env);
  const events = createEventPlayer(env, camera, fx);
  const cinematic = createCinematicPlayer(env, camera, atmosphere);

  let disposeInput: (() => void) | null = null;

  const paintWorld = (): void => {
    if (!state.view || state.destroyed || !state.mounted) return;
    overlays.paint();
    entities.paint();
  };

  const paintDebug = (): void => {
    terrain.paintDebug();
  };

  const onCanvasResize = (): void => {
    atmosphere.paintAtmosphere();
    state.homeFramed = false;

    if (!state.view?.trainingFocus || !state.view.trainingHighlight) return;

    const point = camera.trainingHighlightPoint(state.view.trainingHighlight);
    if (point) state.pendingTrainingFocus = point;
  };

  const animLoop = (): void => {
    if (state.destroyed) return;

    const now = performance.now();

    fx.paintLabels(now);
    atmosphere.paintEdgeArrow(now);
    atmosphere.paintCinematicAccent(now);

    if (!state.playing) {
      if (state.view?.visibleCells) {
        fog.paintFog(now);
      }
      fx.paintFx();
    }

    camera.driveTrainingFocus();

    state.animFrame = requestAnimationFrame(animLoop);
  };

  return {
    async mount(element: HTMLElement): Promise<void> {
      if (state.destroyed) return;

      const common = {
        background: 0x101410,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: element,
        preferWebGLVersion: 2 as const,
      };

      try {
        await app.init({ ...common, preference: "webgl" });
      } catch {
        await app.init(common);
      }

      if (state.destroyed) {
        app.destroy(true);
        return;
      }

      const canvas = app.canvas as HTMLCanvasElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.touchAction = "none";

      element.appendChild(canvas);

      app.stage.addChild(layers.world);
      app.stage.addChild(layers.atmosphere);
      app.stage.addChild(layers.fadeLayer);

      app.renderer.on("resize", onCanvasResize);

      disposeInput = attachInput(env, camera, canvas);

      state.mounted = true;

      camera.fit();
      atmosphere.paintAtmosphere();

      state.animFrame = requestAnimationFrame(animLoop);
    },

    update(view: FieldView): void {
      state.view = view;

      if (view.missLabel !== undefined) {
        state.missLabel = view.missLabel;
      }

      if (!state.mounted || state.destroyed) return;

      if (state.terrainSeed !== view.matchSeed) {
        terrain.paintStatic();
        state.terrainSeed = view.matchSeed;
        state.homeFramed = false;
      }

      paintDebug();

      fog.invalidate();
      atmosphere.paintAtmosphere();

      camera.fit();
      paintWorld();
    },

    play(eventsToPlay: GameEvent[]): Promise<void> {
      return events.play(eventsToPlay);
    },

    pan(dx: number, dy: number): void {
      camera.panBy(dx, dy);
    },

    destroy(): void {
      state.destroyed = true;
      cancelAnimationFrame(state.animFrame);
      state.jobs.length = 0;

      if (disposeInput) {
        disposeInput();
        disposeInput = null;
      }

      if (state.mounted) {
        app.renderer.off("resize", onCanvasResize);
      }

      app.destroy(true);
    },

    setOnActivate(handler: (x: number, y: number) => void): void {
      state.onActivate = handler;
    },

    setOnHover(handler: (x: number, y: number) => void): void {
      state.onHover = handler;
    },

    setReducedMotion(flag: boolean): void {
      state.reducedMotion = flag;
      fog.invalidate();
      atmosphere.paintAtmosphere();

      if (state.view?.visibleCells) {
        fog.paintFog(performance.now());
      }
    },

    setSpeed(scale: number): void {
      state.speedScale = Math.max(1, Math.min(4, scale));
    },

    getEntityScreenPosition(entityId: number): { x: number; y: number } | null {
      if (!state.mounted || state.destroyed || !state.view) return null;

      const entity = state.view.snapshot.entities.find(
        (candidate) => candidate.id === entityId,
      );

      if (!entity) return null;

      const tile = tileAt(state.view.snapshot.grid, entity.x, entity.y);
      const level = visualLevel(tile ?? ({ pit: false, z: entity.z } as never));
      const worldPoint = centerOf(entity.x, entity.y, level);

      const plane = {
        scale: layers.world.scale.x,
        offset: { x: layers.world.x, y: layers.world.y },
      };

      const screen = worldToScreen(worldPoint, plane);

      const width = app.renderer.width;
      const height = app.renderer.height;

      if (width <= 0 || height <= 0) return null;

      return {
        x: screen.x / width,
        y: screen.y / height,
      };
    },

    playCinematic(plan: CinematicPlan): Promise<void> {
      return cinematic.play(plan);
    },

    skipCinematic(): void {
      cinematic.skip();
    },

    isCinematicPlaying(): boolean {
      return cinematic.isPlaying();
    },

    focusCell(cell: CellPos, durationMs?: number): void {
      camera.focusCell(cell, durationMs);
    },

    focusEntity(entityId: number, durationMs?: number): void {
      camera.focusEntity(entityId, durationMs);
    },

    getZoom(): number {
      return layers.world.scale.x;
    },

    setBaseScale(scale: number): void {
      state.baseScale = scale;
    },

    fadeScreen(mode: "out" | "in", durationMs?: number): Promise<void> {
      return atmosphere.fadeScreen(mode, durationMs);
    },

    setInputLocked(locked: boolean): void {
      state.inputLocked = locked;
    },

    setHiddenEntities(ids: ReadonlySet<number>): void {
      state.hiddenEntities = new Set(ids);
    },
  };
}
```

Ожидаемый размер: примерно **380–430 строк**.

---

# 4. Полный код новых модулей

Далее идут файлы в `app/packages/render/src/field/`.

---

## 4.1. `field/types.ts`

```ts
import type { Application, Container, Graphics, Text, Texture } from "pixi.js";
import type { CellPos, GameEvent, MatchState } from "@bylina/core";

export interface Point {
  x: number;
  y: number;
}

export interface ReachableCell extends CellPos {
  apCost: number;
}

export interface AreaPreview {
  center: CellPos;
  radius: number;
  areaCells: readonly CellPos[];
  warnFriendly?: boolean;
}

export interface TrainingHighlight {
  kind: "cell" | "entity";
  x: number;
  y: number;
}

export interface FieldView {
  /** Seed identifies the generated terrain; it changes only when a new map is created. */
  matchSeed: number;

  snapshot: MatchState;

  selectedId: number | null;
  aimId: number | null;

  reachable: ReachableCell[];
  path: CellPos[];

  aimOk: boolean;
  heightMod: -1 | 0 | 1;

  debugMovement?: boolean;

  /** Клетки, которые сторона наблюдает сейчас (ключи «x,y»). */
  visibleCells?: Set<string>;

  /** Клетки, которые сторона когда-либо наблюдала (ключи «x,y»). */
  exploredCells?: Set<string>;

  /** Клетка, до которой линия прицеливания сплошная. */
  aimBreakCell?: CellPos | null;

  /** Клетка, над которой сейчас курсор. */
  hoverCell?: CellPos | null;

  /** Подсветка обучающей подсказки. */
  trainingHighlight?: TrainingHighlight | null;

  /** Режим обучения: активный шаг сценария. */
  trainingFocus?: boolean;

  /** Откуда будет удар. */
  aimFrom?: CellPos | null;

  /** Областной прицел выбранного умения. */
  areaPreview?: AreaPreview | null;

  /** Локализованная строка «Промах». */
  missLabel?: string;

  /** Биом карты. */
  biome?: string;

  /** Сторона, бойцов которой камера держит в кадре при подгонке. */
  homeOwner?: number;

  /** Наступающая Тьма: доля счётчика Тьмы кампании 0..1. */
  darkness?: number;
}

export interface CinematicTarget {
  cell?: { x: number; y: number };
  configId?: string;
}

export interface CinematicStep {
  /** `focus` — кадр на цели, `pan` — проезд, `hold` — пауза, `fade` — затемнение. */
  kind: "focus" | "pan" | "hold" | "fade";

  target?: CinematicTarget;

  durationMs?: number;
  holdMs?: number;

  fade?: "out" | "in";

  /** Вбегание сущности в клетку из-за предела карты (мс). */
  runInMs?: number;

  /** Вести камеру за сущностью во время вбегания. */
  followRunIn?: boolean;

  /** Подсветить цель кадра. */
  accent?: boolean;

  /** Держать приближение до конца сцены. */
  holdZoom?: boolean;

  /** Масштаб, к которому сцена возвращается. */
  zoom?: number;
}

export interface CinematicPlan {
  steps: CinematicStep[];

  /** Базовый масштаб до сцены. */
  baseScale?: number;

  /** Приближение сцены. */
  zoom?: number;

  /** Можно ли пропустить сцену. */
  skippable?: boolean;
}

export interface DisplayState {
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

export type Fx =
  | { kind: "windup"; x: number; y: number; start: number; warm: boolean }
  | {
      kind: "flash";
      x: number;
      y: number;
      start: number;
      crit: boolean;
      miss: boolean;
      angle: number;
    }
  | {
      kind: "bolt";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      start: number;
      dur: number;
      warm: boolean;
    }
  | { kind: "poof"; x: number; y: number; start: number }
  | { kind: "extract"; x: number; y: number; start: number }
  | {
      kind: "skill";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      start: number;
      dur: number;
      style: string;
      success: boolean;
    }
  | {
      kind: "status";
      x: number;
      y: number;
      start: number;
      status: string;
      applied: boolean;
    }
  | { kind: "fogReveal"; x: number; y: number; start: number }
  | {
      kind: "shards";
      x: number;
      y: number;
      start: number;
      seed: number;
      palette?: "wood" | "stone";
    }
  | { kind: "pitfall"; x: number; y: number; start: number }
  | { kind: "collapse"; x: number; y: number; start: number };

export interface FloatText {
  text: Text;
  start: number;
  startY: number;
}

export interface FieldLayers {
  world: Container;
  fringeLayer: Graphics;
  terrain: Container;
  dynamicLayer: Graphics;
  fogBaseLayer: Graphics;
  fogDriftLayer: Graphics;
  fxLayer: Graphics;
  glowLayer: Graphics;
  labelsLayer: Container;
  debugLayer: Container;
  accentLayer: Graphics;

  atmosphere: Container;
  darknessG: Graphics;
  vignetteG: Container;
  edgeArrowG: Graphics;

  fadeLayer: Graphics;
}

export interface FieldState {
  destroyed: boolean;
  mounted: boolean;

  view: FieldView | null;

  reducedMotion: boolean;
  speedScale: number;
  missLabel: string;

  display: Map<number, DisplayState>;
  lunges: Map<number, { dx: number; dy: number }>;
  bumps: Map<number, { dx: number; dy: number }>;
  dying: Map<number, number>;
  flashes: Map<number, number>;

  fxs: Fx[];
  floatTexts: FloatText[];

  playing: boolean;
  holdDisplay: boolean;

  terrainSeed: number | null;

  jobs: Array<{ events: GameEvent[]; done: () => void }>;

  trainingHighlightKey: string | null;
  pendingTrainingFocus: Point | null;
  trainingGlide: boolean;

  userMoved: boolean;
  homeFramed: boolean;

  inputLocked: boolean;

  drag: boolean;
  dragged: boolean;
  lastX: number;
  lastY: number;

  lastTapKey: string | null;
  lastTapTime: number;

  pointers: Map<number, Point>;
  pinch: number;
  pinchCenter: Point | null;

  fogSignature: string;
  lastFogDriftAt: number;
  prevVisibleKeys: Set<string> | null;

  grainTexture: Texture | null;

  cinematicSkip: boolean;
  cinematicPlaying: boolean;
  cinematicAccent: Point | null;

  baseScale?: number;

  hiddenEntities: Set<number>;

  onActivate?: (x: number, y: number) => void;
  onHover?: (x: number, y: number) => void;

  animFrame: number;
}

export interface FieldEnv {
  app: Application;
  layers: FieldLayers;
  state: FieldState;
}

export interface FieldRenderer {
  mount(host: HTMLElement): Promise<void>;
  update(view: FieldView): void;
  play(events: GameEvent[]): Promise<void>;
  pan(dx: number, dy: number): void;
  destroy(): void;

  setOnActivate(handler: (x: number, y: number) => void): void;
  setOnHover(handler: (x: number, y: number) => void): void;
  setReducedMotion(flag: boolean): void;
  setSpeed(scale: number): void;

  getEntityScreenPosition(entityId: number): { x: number; y: number } | null;

  playCinematic?(plan: CinematicPlan): Promise<void>;
  skipCinematic?(): void;
  isCinematicPlaying?(): boolean;

  focusCell?(cell: CellPos, durationMs?: number): void;
  focusEntity?(entityId: number, durationMs?: number): void;

  getZoom?(): number;
  setBaseScale?(scale: number): void;

  fadeScreen?(mode: "out" | "in", durationMs?: number): Promise<void>;
  setInputLocked?(locked: boolean): void;
  setHiddenEntities?(ids: ReadonlySet<number>): void;
}
```

---

## 4.2. `field/constants.ts`

```ts
export const RENDER_STATUS = "pixi" as const;

export const CELL_SIZE = 52;
export const RISE = 12;
export const PAD = 26;

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3.2;

export const CINEMATIC_ZOOM = 1.9;
export const CINEMATIC_ZOOM_MS = 420;
export const CINEMATIC_SCALE_MAX = 3.2;

/**
 * Янтарный акцент цели кадра: тот же цвет, что у готовой атаки
 * в интерфейсе. Подсветка читается как «это цель».
 */
export const CINEMATIC_ACCENT = 0xe0b34a;

/**
 * Из какого расчёта сущность вбегает в клетку: клетки за кромкой карты.
 */
export const RUN_IN_CELLS = 2;

export const CAMERA_CELLS_IN_VIEW = 9;

export const TRAINING_COMFORT = {
  x0: 0.16,
  y0: 0.18,
  x1: 0.84,
  y1: 0.82,
} as const;

export const FLOAT_MS = 760;
export const FLOAT_RISE = 34;
export const MAX_FLOAT_TEXTS = 12;

export const BOLT_MS_PER_CELL = 30;

export const FOG_DRIFT_INTERVAL_MS = 66;

export const FADE_COLOR = 0x05070a;

export const FRINGE_CELLS = 2;

export const LAYER_Z = {
  fringe: 0,
  terrain: 100,
  dynamic: 200,
  fogBase: 300,
  fogDrift: 310,
  fx: 400,
  glow: 410,
  labels: 500,
  accent: 520,
  debug: 900,
} as const;
```

---

## 4.3. `field/math.ts`

```ts
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function shade(color: number, amount: number): number {
  const r = clamp(((color >> 16) & 0xff) + amount, 0, 255);
  const g = clamp(((color >> 8) & 0xff) + amount, 0, 255);
  const b = clamp((color & 0xff) + amount, 0, 255);

  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;

  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;

  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/**
 * Детерминированный хеш клетки → [0, 1).
 * Декор стабилен между кадрами.
 */
export function hashCell(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
```

---

## 4.4. `field/geometry.ts`

```ts
import type { Grid, Tile, CellPos } from "@bylina/core";
import type { FieldView, Point } from "./types.js";
import {
  CAMERA_CELLS_IN_VIEW,
  CELL_SIZE,
  PAD,
  RISE,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./constants.js";
import { clamp } from "./math.js";

export interface Plane {
  scale: number;
  offset: Point;
}

export interface Screen {
  width: number;
  height: number;
}

export function faceOf(x: number, y: number, z: number): { fx: number; fy: number } {
  return {
    fx: PAD + x * CELL_SIZE,
    fy: PAD + RISE * 2 + y * CELL_SIZE - z * RISE,
  };
}

export function centerOf(x: number, y: number, z: number): Point {
  const { fx, fy } = faceOf(x, y, z);
  return {
    x: fx + CELL_SIZE / 2,
    y: fy + CELL_SIZE / 2,
  };
}

export function visualLevel(tile: Tile): number {
  return tile.pit ? 0 : tile.z;
}

export function tileAt(grid: Grid, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return undefined;

  const direct = grid.tiles[y * grid.width + x];
  if (direct && direct.x === x && direct.y === y) return direct;

  return grid.tiles.find((tile) => tile.x === x && tile.y === y);
}

export function neighborLevel(
  tiles: Tile[],
  x: number,
  y: number,
): number | null {
  const tile = tiles.find((candidate) => candidate.x === x && candidate.y === y);
  if (!tile) return null;
  return visualLevel(tile);
}

export function cellFromLocal(
  view: FieldView,
  lx: number,
  ly: number,
): CellPos | null {
  const { tiles, width, height } = view.snapshot.grid;

  const gx = Math.floor((lx - PAD) / CELL_SIZE);
  if (gx < 0 || gx >= width) return null;

  for (let y = height - 1; y >= 0; y -= 1) {
    const tile = tiles.find((item) => item.x === gx && item.y === y);
    if (!tile) continue;

    const z = visualLevel(tile);
    const { fy } = faceOf(gx, y, z);

    if (ly >= fy && ly < fy + CELL_SIZE) {
      return { x: gx, y, z };
    }
  }

  return null;
}

export function worldToScreen(point: Point, plane: Plane): Point {
  return {
    x: plane.offset.x + point.x * plane.scale,
    y: plane.offset.y + point.y * plane.scale,
  };
}

export function screenToWorld(point: Point, plane: Plane): Point {
  return {
    x: (point.x - plane.offset.x) / plane.scale,
    y: (point.y - plane.offset.y) / plane.scale,
  };
}

export function mapPlane(view: FieldView): { width: number; height: number } {
  const cols = view.snapshot.grid.width;
  const rows = view.snapshot.grid.height;

  return {
    width: cols * CELL_SIZE + PAD * 2,
    height: rows * CELL_SIZE + PAD * 2 + RISE * 4,
  };
}

export function fitScale(screen: Screen): number {
  if (screen.width <= 0 || screen.height <= 0) return ZOOM_MIN;

  const byWidth = screen.width / (CAMERA_CELLS_IN_VIEW * CELL_SIZE);
  const byHeight = screen.height / (CAMERA_CELLS_IN_VIEW * CELL_SIZE);

  return clamp(Math.min(byWidth, byHeight), ZOOM_MIN, ZOOM_MAX);
}

export function clampCameraOffset(
  offset: Point,
  plane: Plane,
  screen: Screen,
  planeSize: { width: number; height: number },
): Point {
  const worldWidth = planeSize.width * plane.scale;
  const worldHeight = planeSize.height * plane.scale;

  let x = offset.x;
  let y = offset.y;

  if (worldWidth <= screen.width) {
    x = (screen.width - worldWidth) / 2;
  } else {
    x = clamp(x, screen.width - worldWidth, 0);
  }

  if (worldHeight <= screen.height) {
    y = (screen.height - worldHeight) / 2;
  } else {
    y = clamp(y, screen.height - worldHeight, 0);
  }

  return { x, y };
}

export function trainingGlideOffset(
  point: Point,
  plane: Plane,
  screen: Screen,
  planeSize: { width: number; height: number },
): Point {
  const targetX = screen.width * 0.5 - point.x * plane.scale;
  const targetY = screen.height * 0.46 - point.y * plane.scale;

  return clampCameraOffset({ x: targetX, y: targetY }, plane, screen, planeSize);
}
```

---

## 4.5. `field/state.ts`

```ts
import type { FieldState } from "./types.js";

export function createFieldState(): FieldState {
  return {
    destroyed: false,
    mounted: false,

    view: null,

    reducedMotion: false,
    speedScale: 1,
    missLabel: "Промах",

    display: new Map(),
    lunges: new Map(),
    bumps: new Map(),
    dying: new Map(),
    flashes: new Map(),

    fxs: [],
    floatTexts: [],

    playing: false,
    holdDisplay: false,

    terrainSeed: null,

    jobs: [],

    trainingHighlightKey: null,
    pendingTrainingFocus: null,
    trainingGlide: false,

    userMoved: false,
    homeFramed: false,

    inputLocked: false,

    drag: false,
    dragged: false,
    lastX: 0,
    lastY: 0,

    lastTapKey: null,
    lastTapTime: 0,

    pointers: new Map(),
    pinch: 0,
    pinchCenter: null,

    fogSignature: "",
    lastFogDriftAt: -1,
    prevVisibleKeys: null,

    grainTexture: null,

    cinematicSkip: false,
    cinematicPlaying: false,
    cinematicAccent: null,

    baseScale: undefined,

    hiddenEntities: new Set(),

    onActivate: undefined,
    onHover: undefined,

    animFrame: 0,
  };
}
```

---

## 4.6. `field/layers.ts`

```ts
import { Container, Graphics } from "pixi.js";
import type { FieldLayers } from "./types.js";
import { LAYER_Z } from "./constants.js";

export function createFieldLayers(): FieldLayers {
  const world = new Container();
  world.sortableChildren = true;
  world.eventMode = "static";
  world.hitArea = { contains: () => true } as never;

  const fringeLayer = new Graphics();
  fringeLayer.zIndex = LAYER_Z.fringe;

  const terrain = new Container();
  terrain.sortableChildren = true;
  terrain.zIndex = LAYER_Z.terrain;

  const dynamicLayer = new Graphics();
  dynamicLayer.zIndex = LAYER_Z.dynamic;

  const fogBaseLayer = new Graphics();
  fogBaseLayer.zIndex = LAYER_Z.fogBase;

  const fogDriftLayer = new Graphics();
  fogDriftLayer.zIndex = LAYER_Z.fogDrift;

  const fxLayer = new Graphics();
  fxLayer.zIndex = LAYER_Z.fx;

  const glowLayer = new Graphics();
  glowLayer.zIndex = LAYER_Z.glow;

  const labelsLayer = new Container();
  labelsLayer.zIndex = LAYER_Z.labels;

  const accentLayer = new Graphics();
  accentLayer.zIndex = LAYER_Z.accent;

  const debugLayer = new Container();
  debugLayer.sortableChildren = true;
  debugLayer.zIndex = LAYER_Z.debug;

  world.addChild(
    fringeLayer,
    terrain,
    dynamicLayer,
    fogBaseLayer,
    fogDriftLayer,
    fxLayer,
    glowLayer,
    labelsLayer,
    accentLayer,
    debugLayer,
  );

  const atmosphere = new Container();
  atmosphere.sortableChildren = true;

  const darknessG = new Graphics();
  const vignetteG = new Container();
  const edgeArrowG = new Graphics();

  atmosphere.addChild(darknessG, vignetteG, edgeArrowG);

  const fadeLayer = new Graphics();
  fadeLayer.zIndex = 10000;

  return {
    world,
    fringeLayer,
    terrain,
    dynamicLayer,
    fogBaseLayer,
    fogDriftLayer,
    fxLayer,
    glowLayer,
    labelsLayer,
    debugLayer,
    accentLayer,

    atmosphere,
    darknessG,
    vignetteG,
    edgeArrowG,

    fadeLayer,
  };
}
```

---

## 4.7. `field/camera.ts`

```ts
import type { CellPos } from "@bylina/core";
import type { FieldEnv, Point, TrainingHighlight } from "./types.js";
import { CELL_SIZE, TRAINING_COMFORT, ZOOM_MAX, ZOOM_MIN } from "./constants.js";
import {
  clampCameraOffset,
  centerOf,
  fitScale,
  mapPlane,
  screenToWorld,
  tileAt,
  trainingGlideOffset,
  visualLevel,
  worldToScreen,
} from "./geometry.js";
import { clamp, easeInOut } from "./math.js";

export interface CameraRig {
  fit(): void;
  panBy(dx: number, dy: number): void;
  zoomAt(screenX: number, screenY: number, factor: number): void;
  centerOnNow(point: Point): void;
  focusOn(cxw: number, cyw: number): Promise<void>;
  glideToTrainingTarget(point: Point): Promise<void>;
  driveTrainingFocus(): void;
  trainingHighlightPoint(highlight: TrainingHighlight): Point | null;
  focusCell(cell: CellPos, durationMs?: number): void;
  focusEntity(entityId: number, durationMs?: number): void;
  getScale(): number;
}

export function createCameraRig(env: FieldEnv): CameraRig {
  const { app, layers, state } = env;
  const world = layers.world;

  const tween = (ms: number, step: (t: number) => void): Promise<void> =>
    new Promise((resolve) => {
      if (state.destroyed || state.reducedMotion || ms <= 0) {
        step(1);
        resolve();
        return;
      }

      const started = performance.now();

      const frame = (): void => {
        if (state.destroyed) {
          step(1);
          resolve();
          return;
        }

        const t = Math.min(1, (performance.now() - started) / ms);
        step(t);

        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    });

  const plane = () => ({
    scale: world.scale.x,
    offset: { x: world.x, y: world.y },
  });

  const screen = () => ({
    width: app.renderer.width,
    height: app.renderer.height,
  });

  const homePoint = (): Point | null => {
    const view = state.view;
    if (!view) return null;

    const planeSize = mapPlane(view);

    if (view.homeOwner === undefined) {
      return { x: planeSize.width / 2, y: planeSize.height / 2 };
    }

    const homeTiles = view.snapshot.grid.tiles.filter(
      (tile) => tile.homeOwner === view.homeOwner,
    );

    if (homeTiles.length === 0) return null;

    let x = 0;
    let y = 0;

    for (const tile of homeTiles) {
      const c = centerOf(tile.x, tile.y, visualLevel(tile));
      x += c.x;
      y += c.y;
    }

    return { x: x / homeTiles.length, y: y / homeTiles.length };
  };

  const fit = (): void => {
    if (!state.view || state.destroyed || !state.mounted || state.userMoved) return;

    const s = screen();
    if (s.width <= 0 || s.height <= 0) return;

    const scale = fitScale(s);
    world.scale.set(scale);

    if (state.homeFramed) return;

    const home = homePoint();
    if (!home) return;

    const offset = clampCameraOffset(
      {
        x: s.width / 2 - home.x * scale,
        y: s.height / 2 - home.y * scale,
      },
      { scale, offset: { x: 0, y: 0 } },
      s,
      mapPlane(state.view),
    );

    world.x = offset.x;
    world.y = offset.y;

    state.homeFramed = true;
  };

  const panBy = (dx: number, dy: number): void => {
    world.x += dx;
    world.y += dy;
    state.userMoved = true;
  };

  const zoomAt = (screenX: number, screenY: number, factor: number): void => {
    const before = screenToWorld({ x: screenX, y: screenY }, plane());

    const scale = clamp(world.scale.x * factor, ZOOM_MIN, ZOOM_MAX);
    world.scale.set(scale);

    world.x = screenX - before.x * scale;
    world.y = screenY - before.y * scale;

    state.userMoved = true;
  };

  const centerOnNow = (point: Point): void => {
    const s = screen();
    const scale = world.scale.x;

    const target = clampCameraOffset(
      {
        x: s.width / 2 - point.x * scale,
        y: s.height / 2 - point.y * scale,
      },
      plane(),
      s,
      state.view ? mapPlane(state.view) : { width: 0, height: 0 },
    );

    world.x = target.x;
    world.y = target.y;
  };

  const focusOn = async (cxw: number, cyw: number): Promise<void> => {
    if (!state.mounted || state.destroyed || !state.view) return;

    const s = screen();
    if (s.width <= 0 || s.height <= 0) return;

    const scale = world.scale.x;

    const sx = world.x + cxw * scale;
    const sy = world.y + cyw * scale;

    const needX =
      sx < s.width * TRAINING_COMFORT.x0 || sx > s.width * TRAINING_COMFORT.x1;

    const needY =
      sy < s.height * TRAINING_COMFORT.y0 || sy > s.height * TRAINING_COMFORT.y1;

    if (!needX && !needY) return;

    const tx = world.x + (s.width * 0.5 - sx) * 0.6;
    const ty = world.y + (s.height * 0.52 - sy) * 0.6;

    const fromX = world.x;
    const fromY = world.y;

    state.userMoved = true;

    await tween(220, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (tx - fromX) * e;
      world.y = fromY + (ty - fromY) * e;
    });
  };

  const glideToTrainingTarget = async (point: Point): Promise<void> => {
    if (!state.mounted || state.destroyed || !state.view) return;

    const s = screen();
    if (s.width <= 0 || s.height <= 0) return;

    const target = trainingGlideOffset(point, plane(), s, mapPlane(state.view));

    const fromX = world.x;
    const fromY = world.y;

    if (Math.abs(target.x - fromX) + Math.abs(target.y - fromY) < 1) return;

    state.userMoved = true;

    await tween(320, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (target.x - fromX) * e;
      world.y = fromY + (target.y - fromY) * e;
    });
  };

  const trainingHighlightPoint = (
    highlight: TrainingHighlight,
  ): Point | null => {
    const view = state.view;
    if (!view) return null;

    const tile = view.snapshot.grid.tiles.find(
      (candidate) => candidate.x === highlight.x && candidate.y === highlight.y,
    );

    if (!tile) return null;

    return centerOf(tile.x, tile.y, visualLevel(tile));
  };

  const driveTrainingFocus = (): void => {
    if (state.destroyed || state.trainingGlide || state.playing || !state.mounted) {
      return;
    }

    const point = state.pendingTrainingFocus;
    if (!point) return;

    state.pendingTrainingFocus = null;
    state.trainingGlide = true;

    void glideToTrainingTarget(point).finally(() => {
      state.trainingGlide = false;
    });
  };

  const focusCell = (cell: CellPos, durationMs = 260): void => {
    if (!state.view || state.destroyed || state.cinematicPlaying) return;

    const tile = tileAt(state.view.snapshot.grid, cell.x, cell.y);
    if (!tile) return;

    const point = centerOf(tile.x, tile.y, visualLevel(tile));

    void (async () => {
      const s = screen();
      const scale = world.scale.x;

      const target = clampCameraOffset(
        {
          x: s.width / 2 - point.x * scale,
          y: s.height / 2 - point.y * scale,
        },
        plane(),
        s,
        mapPlane(state.view!),
      );

      const fromX = world.x;
      const fromY = world.y;

      state.userMoved = true;

      await tween(durationMs, (t) => {
        const e = easeInOut(t);
        world.x = fromX + (target.x - fromX) * e;
        world.y = fromY + (target.y - fromY) * e;
      });
    })();
  };

  const focusEntity = (entityId: number, durationMs = 260): void => {
    const entity = state.view?.snapshot.entities.find(
      (candidate) => candidate.id === entityId,
    );

    if (!entity) return;

    focusCell({ x: entity.x, y: entity.y, z: entity.z }, durationMs);
  };

  return {
    fit,
    panBy,
    zoomAt,
    centerOnNow,
    focusOn,
    glideToTrainingTarget,
    driveTrainingFocus,
    trainingHighlightPoint,
    focusCell,
    focusEntity,
    getScale: () => world.scale.x,
  };
}
```

---

## 4.8. `field/terrain.ts`

Этот файл отвечает только за рельеф.

В него нужно перенести без изменений следующие сущности из старого файла:

- `biomeLookOf`;
- `drawTile`;
- `paintFringe`;
- `paintStatic`;
- `paintDebug`;
- все внутренние вспомогательные функции рельефа, если они использовались только здесь.

Каркас файла:

```ts
import { Graphics } from "pixi.js";
import type { Tile } from "@bylina/core";
import type { FieldEnv } from "./types.js";

export interface TerrainPainter {
  paintStatic(): void;
  paintDebug(): void;
}

export function createTerrainPainter(env: FieldEnv): TerrainPainter {
  const { layers, state } = env;

  /**
   * Перенести 1:1 из старого файла.
   * Отвечает за окантовку рельефа за кромкой карты.
   */
  const paintFringe = (): void => {
    // MOVE FROM OLD FILE: paintFringe()
  };

  /**
   * Перенести 1:1 из старого файла.
   * Один тайл рельефа: грани, откосы, тени, ямы, камни, декор.
   */
  const drawTile = (_tile: Tile): Graphics => {
    // MOVE FROM OLD FILE: drawTile(tile)
    return new Graphics();
  };

  const paintStatic = (): void => {
    const view = state.view;

    if (!view || state.destroyed || !state.mounted) return;

    paintFringe();

    layers.terrain.removeChildren().forEach((child) => child.destroy());

    for (const tile of view.snapshot.grid.tiles) {
      layers.terrain.addChild(drawTile(tile));
    }

    layers.terrain.sortableChildren = true;
  };

  const paintDebug = (): void => {
    // MOVE FROM OLD FILE: paintDebug()
    layers.debugLayer.removeChildren().forEach((child) => child.destroy());

    if (!state.view?.debugMovement) return;

    // Здесь переносится старый код отладочной отрисовки движения.
  };

  return {
    paintStatic,
    paintDebug,
  };
}
```

Практическое правило: всё, что в старом файле связано с `drawTile`, `paintFringe`, `paintStatic`, `paintDebug`, должно жить здесь.

---

## 4.9. `field/cover.ts`

Сюда переносятся:

- `drawCoverDamage`;
- `drawEdgeCover`;
- `drawCover`;
- `drawShieldIcon`.

Каркас:

```ts
import { Graphics } from "pixi.js";

/**
 * Перенести 1:1 из старого файла.
 */
export function drawCoverDamage(
  _g: Graphics,
  _cx: number,
  _cy: number,
  _w: number,
  _h: number,
): void {
  // MOVE FROM OLD FILE
}

/**
 * Перенести 1:1 из старого файла.
 */
export function drawEdgeCover(
  _g: Graphics,
  _cx: number,
  _cy: number,
  _coverType: 1 | 2,
  _edge: 0 | 1 | 2 | 3,
  _style: "wood" | "stone" | "bush" = "wood",
): void {
  // MOVE FROM OLD FILE
}

/**
 * Перенести 1:1 из старого файла.
 */
export function drawCover(
  g: Graphics,
  cx: number,
  cy: number,
  coverType: 1 | 2,
  edge?: 0 | 1 | 2 | 3,
  style: "wood" | "stone" | "bush" = "wood",
): void {
  if (edge !== undefined) {
    drawEdgeCover(g, cx, cy, coverType, edge, style);
    return;
  }

  // MOVE FROM OLD FILE: целоклеточное укрытие
}

/**
 * Перенести 1:1 из старого файла.
 */
export function drawShieldIcon(
  _g: Graphics,
  _cx: number,
  _cy: number,
  _edge: 0 | 1 | 2 | 3,
  _coverType: 1 | 2,
  _alpha: number,
): void {
  // MOVE FROM OLD FILE
}
```

---

## 4.10. `field/entities.ts`

Сюда переносится отрисовка сущностей.

Ответственности:

- тени сущностей;
- подставки фракций;
- фишки;
- кольца выбора;
- кольца прицеливания;
- HP-бар;
- AP-пипсы;
- индикатор защиты;
- овервотч;
- скрытые сущности;
- интеграция с `token-art.ts`.

Каркас:

```ts
import { Graphics } from "pixi.js";
import type { FieldEnv } from "./types.js";
import { drawCover } from "./cover.js";
import { centerOf, tileAt, visualLevel } from "./geometry.js";

export interface EntityPainter {
  paint(): void;
}

export function createEntityPainter(env: FieldEnv): EntityPainter {
  const { layers, state } = env;

  const paint = (): void => {
    const view = state.view;

    if (!view || state.destroyed || !state.mounted) return;

    layers.dynamicLayer.clear();

    const g = layers.dynamicLayer;

    for (const entity of view.snapshot.entities) {
      if (entity.dead) continue;
      if (state.hiddenEntities.has(entity.id)) continue;

      const tile = tileAt(view.snapshot.grid, entity.x, entity.y);
      const z = visualLevel(tile ?? ({ pit: false, z: entity.z } as never));
      const { x: cx, y: cy } = centerOf(entity.x, entity.y, z);

      if (entity.coverType > 0) {
        // Облик укрытия зависит от биома.
        // В старый код нужно передать реальный стиль биома.
        drawCover(g, cx, cy, entity.coverType as 1 | 2, entity.edge);
        continue;
      }

      // MOVE FROM OLD FILE:
      // - тень;
      // - подставка;
      // - токен;
      // - овервотч;
      // - кольцо выбора;
      // - кольцо прицеливания;
      // - вспышка;
      // - HP;
      // - AP;
      // - defending;
    }
  };

  return { paint };
}
```

Важно: в старом коде здесь были вызовы `faction`, `flash`, `isSelected`, `aimState`, `hp`, `ap`, `defending`. Их нужно перенести в этот файл как приватные функции.

---

## 4.11. `field/overlays.ts`

Сюда переносятся все не-сущностные подсветки.

Разбить на подфункции:

```ts
paintReachable();
paintPath();
paintAreaPreview();
paintExtractZones();
paintHomeEdges();
paintApple();
paintAimLine();
drawProtectionHighlights();
drawAimIntersections();
paintTrainingFocus();
```

Каркас:

```ts
import type { FieldEnv } from "./types.js";

export interface OverlayPainter {
  paint(): void;
}

export function createOverlayPainter(env: FieldEnv): OverlayPainter {
  const { layers, state } = env;

  const paintReachable = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintPath = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintAreaPreview = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintExtractZones = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintHomeEdges = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintApple = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintAimLine = (): void => {
    // MOVE FROM OLD FILE
  };

  const drawProtectionHighlights = (): void => {
    // MOVE FROM OLD FILE
  };

  const drawAimIntersections = (): void => {
    // MOVE FROM OLD FILE
  };

  const paintTrainingFocus = (): void => {
    // MOVE FROM OLD FILE
  };

  const paint = (): void => {
    const view = state.view;

    if (!view || state.destroyed || !state.mounted) return;

    layers.dynamicLayer.clear();

    paintReachable();
    paintPath();
    paintAreaPreview();
    paintExtractZones();
    paintHomeEdges();
    paintApple();
    paintAimLine();
    drawProtectionHighlights();
    drawAimIntersections();
    paintTrainingFocus();
  };

  return { paint };
}
```

Рекомендация: внутри `overlays.ts` использовать отдельные графические функции, но все они должны писать в один `dynamicLayer`, если в исходном коде это было так. Если исходный код использовал разные слои, нужно сохранить это в `FieldLayers`.

---

## 4.12. `field/effects.ts`

Сюда переносятся эффекты и всплывающие числа.

```ts
import { Text } from "pixi.js";
import type { FieldEnv, Fx } from "./types.js";
import { FLOAT_MS, FLOAT_RISE, MAX_FLOAT_TEXTS } from "./constants.js";
import { easeOut } from "./math.js";

export interface FxSystem {
  paintFx(): void;
  paintLabels(now: number): void;
  pushFloat(
    x: number,
    y: number,
    value: string | number,
    color: number,
    big: boolean,
  ): void;
  addFx(fx: Fx): void;
}

export function createFxSystem(env: FieldEnv): FxSystem {
  const { layers, state } = env;

  const pushFloat = (
    x: number,
    y: number,
    value: string | number,
    color: number,
    big: boolean,
  ): void => {
    if (state.floatTexts.length >= MAX_FLOAT_TEXTS) {
      const first = state.floatTexts.shift();
      first?.text.destroy();
    }

    const text = new Text({
      text: String(value),
      style: {
        fontFamily: "Segoe UI, PT Sans, system-ui, sans-serif",
        fontSize: big ? 22 : 16,
        fontWeight: big ? "900" : "800",
        fill: color,
        stroke: { color: 0x090b0a, width: big ? 4.5 : 3 },
        letterSpacing: 0.5,
      },
    });

    text.anchor.set(0.5, 1);
    text.position.set(x, y - 22);

    layers.labelsLayer.addChild(text);

    state.floatTexts.push({
      text,
      start: performance.now(),
      startY: y - 22,
    });
  };

  const paintLabels = (now: number): void => {
    for (let i = state.floatTexts.length - 1; i >= 0; i -= 1) {
      const item = state.floatTexts[i];
      if (!item) continue;

      const t = Math.min(1, (now - item.start) / FLOAT_MS);

      if (t >= 1) {
        item.text.destroy();
        state.floatTexts.splice(i, 1);
        continue;
      }

      const ease = easeOut(t);

      item.text.y = item.startY - ease * FLOAT_RISE;
      item.text.alpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);

      const pop = item.text.style.fontSize > 18 ? 1 + 0.3 * (1 - t) : 1;
      item.text.scale.set(pop);
    }
  };

  const paintFx = (): void => {
    if (!state.view || state.destroyed || !state.mounted) return;

    const g = layers.fxLayer;
    g.clear();
    layers.glowLayer.clear();

    const now = performance.now();

    // MOVE FROM OLD FILE:
    // Полный цикл отрисовки fxs.
    // Здесь должны быть ветки:
    // - windup
    // - bolt
    // - flash
    // - skill
    // - status
    // - poof
    // - extract
    // - shards
    // - pitfall
    // - collapse
    // - fogReveal

    void now;
  };

  return {
    paintFx,
    paintLabels,
    pushFloat,
    addFx: (fx) => {
      state.fxs.push(fx);
    },
  };
}
```

---

## 4.13. `field/fog.ts`

```ts
import type { FieldEnv } from "./types.js";
import { CELL_SIZE, FOG_DRIFT_INTERVAL_MS } from "./constants.js";
import { faceOf, tileAt, visualLevel } from "./geometry.js";
import { hashCell } from "./math.js";

export interface FogSystem {
  paintFog(now: number): void;
  invalidate(): void;
}

export function createFogSystem(env: FieldEnv): FogSystem {
  const { layers, state } = env;

  const computeFogSignature = (): string => {
    const view = state.view;
    if (!view) return "off";
    if (!view.visibleCells) return "off";

    let h = 0x811c9dc5;

    for (const key of view.visibleCells) {
      for (let i = 0; i < key.length; i += 1) {
        h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
      }
      h = (h + 0x9e3779b9) >>> 0;
    }

    return h.toString(16);
  };

  const paintFogBase = (): void => {
    const view = state.view;
    if (!view || !view.visibleCells) return;

    const g = layers.fogBaseLayer;
    g.clear();

    const isKnown = (x: number, y: number): boolean =>
      view.exploredCells?.has(`${x},${y}`) ?? false;

    const isVisible = (x: number, y: number): boolean =>
      view.visibleCells?.has(`${x},${y}`) ?? false;

    for (const tile of view.snapshot.grid.tiles) {
      if (isVisible(tile.x, tile.y)) continue;

      const z = visualLevel(tile);
      const { fx, fy } = faceOf(tile.x, tile.y, z);

      if (isKnown(tile.x, tile.y)) {
        const nearKnown =
          isKnown(tile.x - 1, tile.y) ||
          isKnown(tile.x + 1, tile.y) ||
          isKnown(tile.x, tile.y - 1) ||
          isKnown(tile.x, tile.y + 1);

        g.rect(fx, fy, CELL_SIZE, CELL_SIZE).fill({
          color: 0x080a0c,
          alpha: nearKnown ? 0.55 : 0.96,
        });
      } else {
        g.rect(fx, fy, CELL_SIZE, CELL_SIZE).fill({
          color: 0x0c1218,
          alpha: 0.6,
        });
      }
    }
  };

  const paintFogDrift = (now: number): void => {
    const view = state.view;
    if (!view || !view.visibleCells) return;

    if (
      now - state.lastFogDriftAt < FOG_DRIFT_INTERVAL_MS &&
      state.lastFogDriftAt >= 0
    ) {
      return;
    }

    state.lastFogDriftAt = now;

    const g = layers.fogDriftLayer;
    g.clear();

    const motionNow = state.reducedMotion ? 12000 : now;

    for (const key of view.visibleCells) {
      const [xRaw, yRaw] = key.split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);

      const tile = tileAt(view.snapshot.grid, x, y);
      if (!tile) continue;

      const z = visualLevel(tile);
      const { fx, fy } = faceOf(x, y, z);

      for (let i = 0; i < 3; i += 1) {
        const h1 = hashCell(x, y, i * 3 + 1);
        const h2 = hashCell(x, y, i * 3 + 2);

        const phase = motionNow * 0.00035 + h1 * Math.PI * 2;

        const driftX = state.reducedMotion ? 0 : Math.sin(phase + i) * 2;
        const driftY = state.reducedMotion ? 0 : Math.cos(phase * 0.9 + i) * 2;

        const w = h2 * CELL_SIZE;
        const h = h1 * CELL_SIZE;

        const cx = fx + w + driftX;
        const cy = fy + h + driftY;

        const fr = 16 + h1 * 18;

        const alpha = state.reducedMotion
          ? 0.05
          : 0.05 + 0.028 * Math.sin(phase * 1.3 + i * 2.1);

        g.ellipse(cx, cy, fr, fr * 0.72).fill({
          color: 0x8a9aaa,
          alpha,
        });
      }
    }
  };

  const paintFog = (now: number): void => {
    const view = state.view;
    if (!view || state.destroyed || !state.mounted) return;

    const sig = computeFogSignature();

    if (sig !== state.fogSignature) {
      state.fogSignature = sig;
      paintFogBase();
    }

    paintFogDrift(now);
  };

  const invalidate = (): void => {
    state.fogSignature = "";
    state.lastFogDriftAt = -1;
  };

  return {
    paintFog,
    invalidate,
  };
}
```

---

## 4.14. `field/atmosphere.ts`

```ts
import { Graphics, Texture, TilingSprite } from "pixi.js";
import type { FieldEnv } from "./types.js";
import { CELL_SIZE, CINEMATIC_ACCENT, FADE_COLOR } from "./constants.js";
import { centerOf, tileAt, visualLevel, worldToScreen } from "./geometry.js";
import { easeInOut, hashCell } from "./math.js";

export interface AtmosphereSystem {
  paintAtmosphere(): void;
  paintEdgeArrow(now: number): void;
  paintCinematicAccent(now: number): void;
  fadeScreen(mode: "out" | "in", durationMs?: number): Promise<void>;
}

export function createAtmosphereSystem(env: FieldEnv): AtmosphereSystem {
  const { app, layers, state } = env;

  const getGrainTexture = (): Texture => {
    if (state.grainTexture) return state.grainTexture;

    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) return Texture.WHITE;

    const image = ctx.createImageData(size, size);
    let seed = 0x9e3779b9;

    for (let i = 0; i < image.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 118 + (seed % 62);

      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }

    ctx.putImageData(image, 0, 0);

    state.grainTexture = Texture.from(canvas);
    return state.grainTexture;
  };

  const paintVignette = (): void => {
    layers.vignetteG.removeChildren().forEach((child) => child.destroy());

    if (state.destroyed || !state.mounted || state.reducedMotion) return;

    const w = app.renderer.width;
    const h = app.renderer.height;

    if (w <= 0 || h <= 0) return;

    const g = new Graphics();

    const steps = 10;
    const maxInset = Math.min(w, h) * 0.22;

    for (let i = steps; i >= 1; i -= 1) {
      const inset = ((i - 1) / steps) * maxInset;

      g.rect(inset, inset, w - inset * 2, h - inset * 2).stroke({
        width: maxInset / steps + 1,
        color: 0x000000,
        alpha: 0.028,
      });
    }

    layers.vignetteG.addChild(g);

    const grain = new TilingSprite({
      texture: getGrainTexture(),
      width: w,
      height: h,
    });

    grain.alpha = 0.04;

    layers.vignetteG.addChild(grain);
  };

  const paintDarkness = (): void => {
    layers.darknessG.clear();

    const ratio = state.view?.darkness ?? 0;

    if (!state.mounted || state.destroyed || ratio <= 0) return;

    layers.darknessG.rect(0, 0, app.renderer.width, app.renderer.height).fill({
      color: 0x0a1826,
      alpha: Math.min(0.4, 0.06 + 0.32 * ratio),
    });
  };

  const paintAtmosphere = (): void => {
    paintVignette();
    paintDarkness();
  };

  const paintEdgeArrow = (now: number): void => {
    layers.edgeArrowG.clear();

    const view = state.view;

    if (!view?.trainingFocus || !view.trainingHighlight || state.destroyed || !state.mounted) {
      return;
    }

    const tile = view.snapshot.grid.tiles.find(
      (candidate) =>
        candidate.x === view.trainingHighlight!.x &&
        candidate.y === view.trainingHighlight!.y,
    );

    if (!tile) return;

    const point = centerOf(tile.x, tile.y, visualLevel(tile));

    const plane = {
      scale: layers.world.scale.x,
      offset: { x: layers.world.x, y: layers.world.y },
    };

    const screenPoint = worldToScreen(point, plane);

    const w = app.renderer.width;
    const h = app.renderer.height;

    if (w <= 0 || h <= 0) return;

    if (screenPoint.x >= 0 && screenPoint.x <= w && screenPoint.y >= 0 && screenPoint.y <= h) {
      return;
    }

    const margin = 30;

    const ax = Math.min(w - margin, Math.max(margin, screenPoint.x));
    const ay = Math.min(h - margin, Math.max(margin, screenPoint.y));

    const angle = Math.atan2(screenPoint.y - ay, screenPoint.x - ax);

    const motionNow = state.reducedMotion ? 12000 : now;
    const pulse = 0.55 + Math.sin(motionNow * 0.008) * 0.35;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const pt = (dx: number, dy: number): [number, number] => [
      ax + dx * cos - dy * sin,
      ay + dx * sin + dy * cos,
    ];

    const tip = pt(13, 0);
    const left = pt(-7, 8);
    const right = pt(-7, -8);

    layers.edgeArrowG
      .poly([tip[0], tip[1], left[0], left[1], right[0], right[1]])
      .fill({ color: 0xe0b34a, alpha: pulse });

    layers.edgeArrowG
      .poly([tip[0], tip[1], left[0], left[1], right[0], right[1]])
      .stroke({ width: 1.5, color: 0xf3ecdc, alpha: 0.7 * pulse + 0.2 });
  };

  const paintCinematicAccent = (now: number): void => {
    layers.accentLayer.clear();

    if (!state.cinematicAccent || state.destroyed || !state.mounted) return;

    const motionNow = state.reducedMotion ? 12000 : now;
    const pulse = 0.5 + Math.sin(motionNow * 0.004) * 0.5;

    const point = state.cinematicAccent;
    const C = CELL_SIZE;

    layers.accentLayer
      .circle(point.x, point.y, C * (0.56 + pulse * 0.06))
      .stroke({
        width: 2.4,
        color: CINEMATIC_ACCENT,
        alpha: 0.24 + pulse * 0.42,
      });

    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI / 2) * i + Math.PI / 4;

      const inner = C * (0.5 + pulse * 0.05);
      const outer = C * (0.62 + pulse * 0.07);

      layers.accentLayer
        .moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner)
        .lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer)
        .stroke({
          width: 2,
          color: CINEMATIC_ACCENT,
          alpha: 0.25 + pulse * 0.45,
        });
    }
  };

  const fadeScreen = async (mode: "out" | "in", durationMs = 500): Promise<void> => {
    if (!state.mounted || state.destroyed) return;

    const start = mode === "out" ? 0 : 1;
    const target = mode === "out" ? 1 : 0;

    const paint = (alpha: number): void => {
      layers.fadeLayer.clear();

      if (alpha <= 0.001) return;

      const width = app.renderer.width;
      const height = app.renderer.height;

      if (width <= 0 || height <= 0) return;

      layers.fadeLayer.rect(0, 0, width, height).fill({
        color: FADE_COLOR,
        alpha,
      });
    };

    if (state.reducedMotion || durationMs <= 0) {
      paint(target);
      return;
    }

    paint(start);

    await new Promise<void>((resolve) => {
      const started = performance.now();

      const frame = (): void => {
        if (state.destroyed) {
          paint(target);
          resolve();
          return;
        }

        const t = Math.min(1, (performance.now() - started) / durationMs);
        paint(start + (target - start) * easeInOut(t));

        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    });
  };

  return {
    paintAtmosphere,
    paintEdgeArrow,
    paintCinematicAccent,
    fadeScreen,
  };
}
```

---

## 4.15. `field/cinematic.ts`

```ts
import type { CinematicPlan, FieldEnv, Point } from "./types.js";
import type { CameraRig } from "./camera.js";
import type { AtmosphereSystem } from "./atmosphere.js";
import { CINEMATIC_SCALE_MAX, CINEMATIC_ZOOM_MS, ZOOM_MIN } from "./constants.js";
import { centerOf, mapPlane, tileAt, visualLevel } from "./geometry.js";
import { easeInOut } from "./math.js";

export interface CinematicPlayer {
  play(plan: CinematicPlan): Promise<void>;
  skip(): void;
  isPlaying(): boolean;
}

export function createCinematicPlayer(
  env: FieldEnv,
  camera: CameraRig,
  atmosphere: AtmosphereSystem,
): CinematicPlayer {
  const { app, layers, state } = env;

  const waitCinematic = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (state.destroyed || state.cinematicSkip || ms <= 0) {
        resolve();
        return;
      }

      const started = performance.now();

      const frame = (): void => {
        if (state.destroyed || state.cinematicSkip) {
          resolve();
          return;
        }

        if (performance.now() - started >= ms / state.speedScale) {
          resolve();
        } else {
          requestAnimationFrame(frame);
        }
      };

      requestAnimationFrame(frame);
    });

  const tweenCinematic = (
    ms: number,
    step: (t: number) => void,
  ): Promise<void> =>
    new Promise((resolve) => {
      if (state.destroyed || state.cinematicSkip || ms <= 0) {
        step(1);
        resolve();
        return;
      }

      const started = performance.now();

      const frame = (): void => {
        if (state.destroyed || state.cinematicSkip) {
          step(1);
          resolve();
          return;
        }

        const t = Math.min(1, (performance.now() - started) / (ms / state.speedScale));
        step(t);

        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    });

  const zoomTo = async (
    scale: number,
    durationMs: number,
    anchor?: Point | null,
  ): Promise<void> => {
    if (!state.mounted || state.destroyed || !state.view) return;

    const from = layers.world.scale.x;
    const to = Math.min(CINEMATIC_SCALE_MAX, Math.max(ZOOM_MIN, scale));

    if (to === from) return;

    const plane = mapPlane(state.view);

    const ax = anchor?.x ?? plane.width / 2;
    const ay = anchor?.y ?? plane.height / 2;

    const screenX = layers.world.x + ax * from;
    const screenY = layers.world.y + ay * from;

    const apply = (s: number): void => {
      layers.world.scale.set(s);
      layers.world.x = screenX - ax * s;
      layers.world.y = screenY - ay * s;
    };

    await tweenCinematic(durationMs, (t) => {
      apply(from + (to - from) * easeInOut(t));
    });

    apply(to);
    state.userMoved = true;
  };

  const resolvePoint = (target?: CinematicPlan["steps"][number]["target"]): Point | null => {
    const view = state.view;
    if (!view || !target) return null;

    if (target.cell) {
      const tile = tileAt(view.snapshot.grid, target.cell.x, target.cell.y);
      if (!tile) return null;
      return centerOf(tile.x, tile.y, visualLevel(tile));
    }

    if (target.configId) {
      const entity = view.snapshot.entities.find(
        (candidate) => candidate.configId === target.configId,
      );

      if (!entity) return null;

      const tile = tileAt(view.snapshot.grid, entity.x, entity.y);
      const z = tile ? visualLevel(tile) : entity.z;

      return centerOf(entity.x, entity.y, z);
    }

    return null;
  };

  const play = async (plan: CinematicPlan): Promise<void> => {
    if (state.destroyed || !state.mounted || !state.view) return;

    state.cinematicPlaying = true;
    state.cinematicSkip = false;

    const baseScale = plan.baseScale ?? layers.world.scale.x;

    try {
      for (const step of plan.steps) {
        if (state.destroyed) break;

        if (step.kind === "fade") {
          await atmosphere.fadeScreen(step.fade ?? "out", step.durationMs ?? 500);
          continue;
        }

        if (step.kind === "hold") {
          await waitCinematic(step.durationMs ?? step.holdMs ?? 400);
          continue;
        }

        const point = resolvePoint(step.target);

        if (!point) continue;

        if (step.accent) {
          state.cinematicAccent = point;
        }

        if (step.kind === "focus" || step.kind === "pan") {
          camera.centerOnNow(point);

          if (step.zoom !== undefined) {
            await zoomTo(step.zoom, CINEMATIC_ZOOM_MS, point);
          }

          await waitCinematic(step.durationMs ?? 300);
        }
      }
    } finally {
      state.cinematicAccent = null;
      state.cinematicPlaying = false;

      if (!plan.holdZoom) {
        await zoomTo(baseScale, CINEMATIC_ZOOM_MS);
      }
    }
  };

  return {
    play,
    skip: () => {
      state.cinematicSkip = true;
    },
    isPlaying: () => state.cinematicPlaying,
  };
}
```

---

## 4.16. `field/event-player.ts`

```ts
import type { GameEvent } from "@bylina/core";
import type { FieldEnv } from "./types.js";
import type { CameraRig } from "./camera.js";
import type { FxSystem } from "./effects.js";
import { centerOf, tileAt, visualLevel } from "./geometry.js";

export interface EventPlayer {
  play(events: GameEvent[]): Promise<void>;
}

export function createEventPlayer(
  env: FieldEnv,
  camera: CameraRig,
  fx: FxSystem,
): EventPlayer {
  const { state } = env;

  const drain = async (): Promise<void> => {
    if (state.playing) return;

    state.playing = true;
    state.holdDisplay = true;

    while (state.jobs.length > 0) {
      const job = state.jobs.shift();
      if (!job) break;

      for (const event of job.events) {
        if (state.destroyed) break;

        await playEvent(event);
      }

      job.done();
    }

    state.playing = false;
    state.holdDisplay = false;

    restoreDisplay();

    state.lunges.clear();
    state.bumps.clear();
  };

  const restoreDisplay = (): void => {
    const view = state.view;
    if (!view) return;

    for (const entity of view.snapshot.entities) {
      state.display.set(entity.id, {
        x: entity.x,
        y: entity.y,
        z: entity.z,
        hp: entity.hp,
        maxHp: entity.maxHp,
        dead: entity.dead,
      });
    }
  };

  const entityPixel = (entityId: number) => {
    const view = state.view;
    if (!view) return { cx: 0, cy: 0 };

    const entity = view.snapshot.entities.find((candidate) => candidate.id === entityId);
    if (!entity) return { cx: 0, cy: 0 };

    const tile = tileAt(view.snapshot.grid, entity.x, entity.y);
    const z = tile ? visualLevel(tile) : entity.z;

    const lunge = state.lunges.get(entity.id);
    const bump = state.bumps.get(entity.id);

    const { x, y } = centerOf(entity.x, entity.y, z);

    return {
      cx: x + (lunge?.dx ?? 0) + (bump?.dx ?? 0),
      cy: y + (lunge?.dy ?? 0) + (bump?.dy ?? 0),
    };
  };

  const playEvent = async (event: GameEvent): Promise<void> => {
    // MOVE FROM OLD FILE.
    //
    // В старом коде здесь был большой switch по типу события:
    // - MOVE
    // - ATTACK
    // - SKILL
    // - STATUS
    // - STAT_CHANGED
    // - DEATH
    // - COVER_DESTROYED
    // - EXTRACT
    // - и другие.
    //
    // При переносе сохранить:
    // - порядок ожидания;
    // - вызовы fx.pushFloat;
    // - вызовы fx.addFx;
    // - тряску камеры;
    // - lunges/bumps;
    // - обновление display.

    void camera;
    void entityPixel;
    void fx;
    void event;
  };

  return {
    play(events: GameEvent[]): Promise<void> {
      return new Promise((done) => {
        state.holdDisplay = true;
        state.jobs.push({ events, done });
        void drain();
      });
    },
  };
}
```

---

## 4.17. `field/input.ts`

```ts
import type { FederatedPointerEvent } from "pixi.js";
import type { FieldEnv } from "./types.js";
import type { CameraRig } from "./camera.js";
import { cellFromLocal } from "./geometry.js";

export function attachInput(
  env: FieldEnv,
  camera: CameraRig,
  canvas: HTMLCanvasElement,
): () => void {
  const { layers, state } = env;
  const world = layers.world;

  const localPoint = (event: FederatedPointerEvent): { x: number; y: number } => {
    return world.toLocal(event.global);
  };

  const onDown = (event: FederatedPointerEvent): void => {
    if (state.inputLocked || state.cinematicPlaying) return;

    state.pointers.set(event.pointerId, {
      x: event.global.x,
      y: event.global.y,
    });

    if (state.pointers.size === 1) {
      state.drag = true;
      state.dragged = false;
      state.lastX = event.global.x;
      state.lastY = event.global.y;
      return;
    }

    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      if (!a || !b) return;

      state.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      state.pinchCenter = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    }
  };

  const onMove = (event: FederatedPointerEvent): void => {
    if (state.inputLocked || state.cinematicPlaying) return;

    if (state.pointers.has(event.pointerId)) {
      state.pointers.set(event.pointerId, {
        x: event.global.x,
        y: event.global.y,
      });
    }

    if (state.pointers.size === 2 && state.pinch > 0 && state.pinchCenter) {
      const [a, b] = [...state.pointers.values()];
      if (!a || !b) return;

      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;

      camera.zoomAt(cx, cy, dist / state.pinch);

      state.pinch = dist;
      state.pinchCenter = { x: cx, y: cy };

      return;
    }

    if (!state.drag) {
      const local = localPoint(event);
      const view = state.view;

      if (view && state.onHover) {
        const cell = cellFromLocal(view, local.x, local.y);
        if (cell) state.onHover(cell.x, cell.y);
      }

      return;
    }

    const dx = event.global.x - state.lastX;
    const dy = event.global.y - state.lastY;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      state.dragged = true;
    }

    camera.panBy(dx, dy);

    state.lastX = event.global.x;
    state.lastY = event.global.y;
  };

  const onUp = (event: FederatedPointerEvent): void => {
    if (state.inputLocked || state.cinematicPlaying) return;

    state.pointers.delete(event.pointerId);

    if (state.pointers.size < 2) {
      state.pinch = 0;
      state.pinchCenter = null;
    }

    if (!state.drag) return;

    state.drag = false;

    if (state.dragged) return;

    const local = localPoint(event);
    const view = state.view;

    if (!view) return;

    const cell = cellFromLocal(view, local.x, local.y);

    if (!cell) return;

    const tapKey = `${cell.x},${cell.y}`;
    const tapTime = performance.now();

    if (tapKey === state.lastTapKey && tapTime - state.lastTapTime < 350) {
      state.lastTapKey = null;
      state.lastTapTime = 0;
      camera.focusCell(cell, 220);
      return;
    }

    state.lastTapKey = tapKey;
    state.lastTapTime = tapTime;

    if (state.onActivate) {
      state.onActivate(cell.x, cell.y);
    }
  };

  const onCancel = (event: FederatedPointerEvent): void => {
    state.pointers.delete(event.pointerId);

    if (state.pointers.size < 2) {
      state.pinch = 0;
      state.pinchCenter = null;
    }

    state.drag = false;
    state.dragged = false;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();

    if (state.inputLocked || state.cinematicPlaying) return;

    const factor = event.deltaY > 0 ? 0.9 : 1.1111111;

    camera.zoomAt(event.offsetX, event.offsetY, factor);
  };

  const onDblClick = (event: MouseEvent): void => {
    if (state.inputLocked || state.cinematicPlaying) return;

    const view = state.view;
    if (!view) return;

    const rect = canvas.getBoundingClientRect();

    const local = world.toLocal({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    const cell = cellFromLocal(view, local.x, local.y);
    if (!cell) return;

    camera.focusCell(cell, 220);
  };

  const onContext = (event: Event): void => {
    event.preventDefault();
  };

  world.on("pointerdown", onDown);
  world.on("pointermove", onMove);
  world.on("pointerup", onUp);
  world.on("pointerupoutside", onUp);
  world.on("pointercancel", onCancel);

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("contextmenu", onContext);

  return () => {
    world.off("pointerdown", onDown);
    world.off("pointermove", onMove);
    world.off("pointerup", onUp);
    world.off("pointerupoutside", onUp);
    world.off("pointercancel", onCancel);

    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("contextmenu", onContext);
  };
}
```

---

# 5. Что именно переносится 1:1

Чтобы не сломать поведение, следующие блоки нужно копировать дословно:

## В `terrain.ts`

Из старого файла:

```ts
const biomeLookOf = ...
const drawTile = ...
const paintFringe = ...
const paintStatic = ...
const paintDebug = ...
```

А также все локальные вспомогательные функции, которые используются только рельефом:

- расчёт откосов;
- тени соседей;
- световые канты;
- осыпь;
- ямы;
- камни;
- декор биома;
- окантовка за краем карты.

## В `cover.ts`

```ts
function drawCoverDamage(...)
function drawEdgeCover(...)
function drawCover(...)
function drawShieldIcon(...)
```

## В `entities.ts`

Из старого файла переносится блок отрисовки сущности:

- тень;
- подставка;
- фишка;
- кольцо выбранной сущности;
- кольцо прицеливания;
- вспышка;
- полоса HP;
- AP-пипсы;
- индикатор защиты;
- направление овервотча;
- эффекты смерти;
- скрытые сущности.

## В `overlays.ts`

Переносится весь код, который рисует:

- синие клетки доступности;
- жёлтый маршрут;
- оранжевую область умения;
- предупреждение по союзникам;
- зону эвакуации;
- домашние края;
- яблоко;
- линию прицеливания;
- маркеры пересечения с укрытиями;
- подсветку защищённых граней;
- обучающее затемнение;
- маркер цели обучения.

## В `effects.ts`

Переносится весь код эффектов:

- `windup`;
- `flash`;
- `bolt`;
- `poof`;
- `extract`;
- `skill`;
- `status`;
- `fogReveal`;
- `shards`;
- `pitfall`;
- `collapse`.

## В `event-player.ts`

Переносится весь код проигрывания событий:

- `MOVE`;
- `ATTACK`;
- `SKILL`;
- `STATUS`;
- `STAT_CHANGED`;
- `DEATH`;
- `COVER_DESTROYED`;
- `EXTRACT`;
- другие события, имеющиеся в проекте.

Особенно важно сохранить:

- `await wait(...)`;
- порядок `impact()`;
- силу тряски;
- дальность и дугу снаряда;
- промах;
- крит;
- всплывающие числа;
- обновление `display`.

---

# 6. Обновление `index.ts`

Если `app/packages/render/src/index.ts` сейчас выглядит примерно так:

```ts
export {
  CELL_SIZE,
  CINEMATIC_ACCENT,
  CINEMATIC_SCALE_MAX,
  CINEMATIC_ZOOM,
  CINEMATIC_ZOOM_MS,
  RUN_IN_CELLS,
  RENDER_STATUS,
  createFieldRenderer,
} from "./field-renderer.js";

export type {
  CinematicPlan,
  CinematicStep,
  CinematicTarget,
  FieldRenderer,
  FieldView,
} from "./field-renderer.js";
```

то менять его не нужно.

Новый `field-renderer.ts` сохраняет те же экспорты.

Если же `index.ts` экспортирует что-то ещё, например палитру:

```ts
export * from "./palette.js";
export * from "./token-art.js";
```

это остаётся без изменений.

---

# 7. Проверка архитектурных границ

После рефакторинга важно проверить, что нет циклических зависимостей.

Ожидаемый граф:

```text
field-renderer.ts
  -> field/types.ts
  -> field/constants.ts
  -> field/state.ts
  -> field/layers.ts
  -> field/camera.ts
  -> field/terrain.ts
  -> field/entities.ts
  -> field/overlays.ts
  -> field/effects.ts
  -> field/fog.ts
  -> field/atmosphere.ts
  -> field/event-player.ts
  -> field/cinematic.ts
  -> field/input.ts
```

Допустимые зависимости внутри `field`:

```text
types.ts        <- почти все
constants.ts    <- почти все
math.ts         <- geometry, camera, fog, effects, atmosphere
geometry.ts     <- camera, terrain, entities, overlays, fog, atmosphere, cinematic, input
state.ts        <- field-renderer
layers.ts       <- field-renderer
camera.ts       <- field-renderer, event-player, cinematic, input
effects.ts      <- event-player, field-renderer
atmosphere.ts   <- cinematic, field-renderer
```

Нежелательные зависимости:

```text
terrain.ts -> event-player.ts
entities.ts -> cinematic.ts
fog.ts -> event-player.ts
input.ts -> event-player.ts
effects.ts -> terrain.ts
camera.ts -> entities.ts
```

Если такие появляются — это признак, что ответственность размыта.

---

# 8. Контрольные точки после каждого этапа

После каждого этапа рекомендуется запускать:

```bash
pnpm -F render typecheck
pnpm -F render test
```

Минимальный тест, который должен остаться зелёным:

```ts
import { describe, expect, it } from "vitest";
import { RENDER_STATUS } from "../src/index.js";

describe("render package", () => {
  it("declares PixiJS as the field backend", () => {
    expect(RENDER_STATUS).toBe("pixi");
  });
});
```

Также важно проверить, что `createFieldRenderer` продолжает возвращать объект с тем же набором методов.

Можно добавить временный snapshot-тест публичного API:

```ts
import { describe, expect, it } from "vitest";
import { createFieldRenderer } from "../src/index.js";

describe("field renderer public api", () => {
  it("keeps public contract", () => {
    const renderer = createFieldRenderer();

    expect(typeof renderer.mount).toBe("function");
    expect(typeof renderer.update).toBe("function");
    expect(typeof renderer.play).toBe("function");
    expect(typeof renderer.pan).toBe("function");
    expect(typeof renderer.destroy).toBe("function");
    expect(typeof renderer.setOnActivate).toBe("function");
    expect(typeof renderer.setOnHover).toBe("function");
    expect(typeof renderer.setReducedMotion).toBe("function");
    expect(typeof renderer.setSpeed).toBe("function");
    expect(typeof renderer.getEntityScreenPosition).toBe("function");
  });
});
```

---

# 9. Требования к размеру файлов

После разнесения рекомендуется держать следующие лимиты:

| Файл | Лимит |
|---|---:|
| `field-renderer.ts` | < 1000 строк |
| `field/camera.ts` | < 700 строк |
| `field/terrain.ts` | < 900 строк |
| `field/overlays.ts` | < 900 строк |
| `field/effects.ts` | < 900 строк |
| `field/event-player.ts` | < 900 строк |
| `field/cinematic.ts` | < 600 строк |
| `field/input.ts` | < 500 строк |

Если после переноса старого кода какой-то модуль всё ещё превышает 800–900 строк, его нужно дополнительно разбить.

Например:

```text
overlays.ts
  -> overlays/movement.ts
  -> overlays/aim.ts
  -> overlays/training.ts
  -> overlays/extract.ts
```

или:

```text
effects.ts
  -> effects/combat.ts
  -> effects/skill.ts
  -> effects/status.ts
  -> effects/float-text.ts
```

---

# 10. Итоговое состояние файла `field-renderer.ts`

После рефакторинга `field-renderer.ts` должен содержать только:

1. импорты подсистем;
2. публичные реэкспорты;
3. `createFieldRenderer`;
4. монтаж и демонтаж;
5. `update`;
6. `play`;
7. `pan`;
8. связку камеры, тумана, эффектов и атмосферы;
9. публичные методы управления.

В нём больше не должно быть:

- функций рисования тайлов;
- функций рисования укрытий;
- функций рисования фишек;
- больших `switch` по событиям;
- логики тумана;
- логики кинематографических сцен;
- логики ввода;
- больших массивов графических команд.

---

# 11. Критерии готовности рефакторинга

Рефакторинг считается завершённым, если:

1. `field-renderer.ts` меньше 1000 строк.
2. Все тесты пакета `render` проходят.
3. `typecheck` проходит без ошибок.
4. `lint` проходит без ошибок.
5. `madge --circular` не показывает циклов.
6. Публичный API не изменился.
7. Визуальное поведение поля не изменилось.
8. `RENDER_STATUS` остаётся `"pixi"`.
9. `index.ts` не требует изменений.
10. Новые модули имеют одну очевидную ответственность.

---

# 12. Рекомендуемый формат коммитов

Лучше всего разбить работу так:

```text
refactor(render): extract field renderer types and constants
refactor(render): extract math and geometry helpers
refactor(render): extract renderer state and layers
refactor(render): extract camera rig
refactor(render): extract terrain painter
refactor(render): extract cover drawing
refactor(render): extract entity painter
refactor(render): extract overlay painter
refactor(render): extract fx and float texts
refactor(render): extract fog of war
refactor(render): extract atmosphere
refactor(render): extract event player
refactor(render): extract cinematic player
refactor(render): extract input controller
refactor(render): make field-renderer composition root
```

Каждый коммит должен оставлять проект рабочим.

---

# 13. Главная идея рефакторинга

Итоговая архитектура должна читаться так:

```text
field-renderer.ts — точка входа и композиция.
field/types.ts — контракт.
field/constants.ts — настройки.
field/math.ts — чистые вычисления.
field/geometry.ts — координаты и камера-математика.
field/state.ts — состояние.
field/layers.ts — сцена.
field/camera.ts — камера и навигация.
field/terrain.ts — земля.
field/cover.ts — укрытия.
field/entities.ts — фигуры.
field/overlays.ts — подсветки.
field/effects.ts — эффекты.
field/fog.ts — туман войны.
field/atmosphere.ts — экранная атмосфера.
field/cinematic.ts — режиссура.
field/event-player.ts — проигрывание боя.
field/input.ts — ввод.
```

После такого разнесения `field-renderer.ts` перестаёт быть «файлом на восемь тысяч строк» и становится нормальным архитектурным корнем рендерера.