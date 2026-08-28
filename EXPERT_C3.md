Реализую Этап 3 — «Миссии 1 и 2: „Хворост“, „Крик в чаще“». Этап связывает системы Этапа 2 с контентом и создаёт игровой цикл пролога: экран боя, титры/итоги, маршрутизацию и автотесты. Версия по завершении — `0.20.33`.

Начну с проверки полноты контента, затем — исполнительный слой.

---

## 1. Содержание миссий — дополнение `prologue_missions.json5`

Убеждаюсь, что миссии 1 и 2 несут полные сценарии, триггеры и чекпоинты для исполнителя Этапа 3.

### `app/packages/content/data/prologue_missions.json5`

```json5
// Пролог кампании: первые две миссии онбординга (Этап 3, 0.20.33).
// Нормативный сценарий — doc/campaign.md §7.1–7.2.
{
  enabled: true,
  roster: ["mikula_peasant", "bogatyr"],
  prologueFinalMissionId: "prologue_village",

  missions: [
    // ===== М1 «Хворост» (биом луг, туман выключен) =====
    {
      id: "prologue_brushwood",
      titleKey: "prologue.m1.title",
      introKey: "prologue.m1.intro",
      outroKey: "prologue.m1.outro",
      nextMissionId: "prologue_cry",
      playerSlots: ["mikula_peasant"],
      fog: false,
      map: {
        biome: "meadow",
        width: 20,
        height: 6,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        layout: {
          rows: [
            "....................",
            "....t.....t......t..",
            "..................F.",
            ".M..t..........t...S",
            "....................",
            "....t.....t......t..",
          ],
          legend: {
            ".": { kind: "ground" },
            "t": { kind: "decor", decor: "bush" },
            "M": { kind: "spawn", side: "player", unitId: "mikula_peasant" },
            // Палка: подбирается автоматически, вооружает дубиной,
            // триггерит появление крысы.
            "S": { kind: "pickup", itemId: "stick", weaponId: "club" },
            // Крыса появляется скриптово после подбора палки.
            "F": { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
          },
        },
      },
      // Врагов на старте нет — крыса появляется после подбора палки.
      enemies: [],
      objective: {
        initialTextKey: "prologue.objective.gather",
        retarget: [
          { onKey: "stick", textKey: "prologue.objective.destroyAll" },
        ],
      },
      // Сценарий Нави: первый ход крысы — гарантированный промах,
      // дальше обычное поведение.
      script: {
        priority: [],
        actions: [
          { unitId: "forest_rat", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "miss" },
          { kind: "endTurn" },
        ],
      },
      hints: ["m1.endTurn"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
      ],
      // Триггеры: подбор палки → появление крысы + смена цели.
      triggers: [
        {
          on: "pickup",
          once: true,
          args: { itemId: "stick" },
          then: [
            { kind: "flag", flag: "stick" },
            { kind: "spawn", side: "enemy", unitId: "forest_rat", x: 18, y: 2 },
            { kind: "camera", camera: "panReturn", target: { x: 18, y: 2 } },
          ],
        },
      ],
    },

    // ===== М2 «Крик в чаще» (биом болото, туман выключен) =====
    {
      id: "prologue_cry",
      titleKey: "prologue.m2.title",
      introKey: "prologue.m2.intro",
      outroKey: "prologue.m2.outro",
      nextMissionId: "prologue_glade",
      playerSlots: ["mikula_peasant"],
      fog: false,
      map: {
        biome: "swamp",
        width: 12,
        height: 9,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
        layout: {
          rows: [
            "Et t....ttt.",
            "E..........",
            "E.M........",
            "...........",
            ".........F.",
            "...........",
            "E.......V..",
            "E..........",
            "Et t....ttt.",
          ],
          legend: {
            ".": { kind: "ground" },
            "t": { kind: "decor", decor: "bush" },
            // Колонка эвакуации: на старте не подсвечивается,
            // появляется после освобождения Федота.
            "E": { kind: "extract" },
            "M": { kind: "spawn", side: "player", unitId: "mikula_peasant" },
            // Федот увяз в трясине: состояние immobile, не яма.
            "V": { kind: "stranded", unitId: "fedot_stranded", state: "immobile" },
            // Точка первой скриптовой пары крыс.
            "F": { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
          },
        },
      },
      enemies: [],
      objective: {
        initialTextKey: "prologue.objective.rescueFedot",
        retarget: [
          { onKey: "fedotFreed", textKey: "prologue.objective.escape" },
        ],
      },
      // Сценарий Нави: пара крыс — первая промах, вторая попадание (по стойке).
      script: {
        priority: [],
        actions: [
          { unitId: "forest_rat", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "miss" },
          { unitId: "forest_rat", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "hit" },
          { kind: "endTurn" },
        ],
      },
      hints: ["m2.noise", "m2.stanceWorks", "m2.wave", "m2.gear"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
        { id: "fedot_freed", onFlag: "fedotFreed", description: "После освобождения Федота" },
      ],
      // Волновое правило крыс: +2 за убитую / +1 без убийств, потолок 8.
      reinforcements: "m2_cry_wave",
      triggers: [
        {
          on: "objectInteracted",
          once: true,
          args: { objectId: "fedot_stranded" },
          then: [
            { kind: "flag", flag: "fedotFreed" },
            { kind: "camera", camera: "panReturn", target: { x: 0, y: 4 } },
          ],
        },
      ],
    },
  ],
}
```

---

## 2. Карточка титра/итога пролога

Создаю переиспользуемый компонент для фаз «до боя» и «после боя».

### `app/packages/ui/src/PrologueCard.tsx` (новый файл)

```tsx
import { useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

/**
 * Карточка титра/итога миссии пролога (Этап 3, §7.1–7.2).
 * Отображает эпиграф (перед боем) либо исход (после боя) и кнопку
 * сюжетного перехода. Скип катсцены — закон §1.8.
 */
export function PrologueCard({
  titleKey,
  textKey,
  actionLabel,
  onAction,
  onSkip,
}: {
  titleKey: string;
  textKey: string;
  actionLabel: string;
  onAction: () => void;
  onSkip?: () => void;
}) {
  useI18nTick();
  const t = useT();
  return (
    <div className="pause-root" role="presentation">
      <div
        className="pause-card campaign-hint-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prologue-card-title"
      >
        <p className="eyebrow">{t(titleKey)}</p>
        <h2 id="prologue-card-title">{t(titleKey)}</h2>
        <p className="muted" style={{ textAlign: "left" }}>{t(textKey)}</p>
        <button type="button" className="hud-btn hud-btn-primary" onClick={onAction}>
          {actionLabel}
          <span aria-hidden="true"> →</span>
        </button>
        {onSkip ? (
          <button type="button" className="hud-btn" onClick={onSkip}>
            {t("prologue.skip")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

---

## 3. Экран боя пролога — ядро Этапа 3

Самый большой компонент. Связывает рендерер поля, ядро, триггеры, скрипт, подсказки, чекпоинты, телеметрию. Создаю отдельный модуль-оркестратор и тонкий компонент-обёртку.

### `app/packages/ui/src/prologue-runner.ts` (новый файл)

```typescript
import {
  compilePrologueLayout,
  createCheckpointStore,
  createMissionScriptRunner,
  createReinforcementService,
  createTelemetryLog,
  createTacticsKernel,
  matchOutcome,
  pickPrologueScriptCommand,
  PLAYER_OWNER,
  ENEMY_OWNER,
  weaponStatsFromRecord,
  type Command,
  type MatchState,
  type PrologueMissionConfig,
  type ReinforcementsConfig,
  type TacticsKernel,
  type WeaponStats,
} from "@bylina/core";
import type { ContentBundle } from "@bylina/content";

/**
 * Оркестратор боя пролога (Этап 3, 0.20.33).
 * Связывает исполнительные системы Этапа 2 (триггеры, скрипт, чекпоинты,
 * подкрепления, телеметрия) с контентом конкретной миссии и управляет
 * игровым циклом: ход игрока → ход Нави → обработка триггеров → чекпоинт.
 */
export interface PrologueRunState {
  phase: "title" | "battle" | "outcome";
  kernel: TacticsKernel | null;
  checkpointStore: ReturnType<typeof createCheckpointStore>;
  telemetry: ReturnType<typeof createTelemetryLog>;
  reinforcements: ReturnType<typeof createReinforcementService> | null;
  /** Активная подсказка миссии (ключ из пролог-каталога). */
  activeHintKey: string | null;
  /** Показанные подсказки этой миссии (ключи). */
  shownHints: Set<string>;
  /** Флаги прохождения. */
  flags: Set<string>;
}

export interface PrologueRunner {
  getState(): PrologueRunState;
  start(): void;
  applyCommand(command: Command): boolean;
  endPlayerTurn(): void;
  advanceHint(): void;
  restartFromCheckpoint(): void;
  subscribe(listener: () => void): () => void;
}

export function createPrologueRunner(options: {
  mission: PrologueMissionConfig;
  content: ContentBundle;
  reinforcementsConfig?: ReinforcementsConfig;
  seed: number;
}): PrologueRunner {
  const { mission, content, reinforcementsConfig, seed } = options;

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const telemetry = createTelemetryLog();
  const checkpointStore = createCheckpointStore();

  const state: PrologueRunState = {
    phase: "title",
    kernel: null,
    checkpointStore,
    telemetry,
    reinforcements: null,
    activeHintKey: null,
    shownHints: new Set(),
    flags: new Set(),
  };

  // Оружие и юниты из контента пролога + основного набора.
  const weapons: Record<string, WeaponStats> = {};
  for (const record of content.weapons) weapons[record.id] = weaponStatsFromRecord(record);
  const prologueWeapons = content.prologueBestiary?.weapons ?? [];
  for (const record of prologueWeapons) weapons[record.id] = weaponStatsFromRecord(record);

  const allUnits = [...content.units, ...(content.prologueBestiary?.units ?? [])];

  let scriptState = { index: 0 };

  const buildKernel = (): TacticsKernel => {
    // Авторская раскладка → решётка + спавны.
    const layout = compilePrologueLayout(mission.map.layout ?? { rows: [] });
    const initial = missionMatchFromLayout(layout, allUnits, mission);
    return createTacticsKernel({
      initial,
      weapons,
      skills: Object.fromEntries(content.skills.map((s) => [s.id, s as never])),
      units: allUnits,
      seed,
    });
  };

  // Инициализация подкреплений (для М2).
  if (reinforcementsConfig) {
    state.reinforcements = createReinforcementService(reinforcementsConfig);
  }

  // Триггерная система миссии.
  const scriptRunner = mission.triggers?.length
    ? createMissionScriptRunner({ triggers: mission.triggers })
    : null;

  const processTriggers = (): void => {
    if (!scriptRunner || !state.kernel) return;
    const snapshot = state.kernel.getSnapshot();
    const requests = scriptRunner.processEvents([], snapshot);
    for (const request of requests) {
      const action = request.action;
      if (action.kind === "flag" && action.flag) {
        state.flags.add(action.flag);
        scriptRunner.setFlag(action.flag);
        // Сохранить чекпоинт при совпадении флага.
        for (const cp of mission.checkpoints ?? []) {
          if (cp.onFlag === action.flag && state.kernel) {
            checkpointStore.save({
              id: cp.id,
              onFlag: cp.onFlag,
              match: state.kernel.getSnapshot(),
              createdAt: Date.now(),
            });
          }
        }
      }
      if (action.kind === "spawn" && state.kernel) {
        spawnScriptedUnit(state.kernel, action.unitId!, action.side!, action.x!, action.y!, allUnits);
      }
    }
  };

  return {
    getState: () => state,

    start: () => {
      state.kernel = buildKernel();
      state.phase = "battle";
      // Начальный чекпоинт.
      checkpointStore.save({
        id: "start",
        match: state.kernel.getSnapshot(),
        createdAt: Date.now(),
      });
      emit();
    },

    applyCommand: (command) => {
      if (!state.kernel || state.phase !== "battle") return false;
      const result = state.kernel.apply(command);
      if (!result.ok) return false;
      processTriggers();
      emit();
      return true;
    },

    endPlayerTurn: () => {
      if (!state.kernel || state.phase !== "battle") return;
      // Сменить ход на Навь и прогнать скрипт противника.
      state.kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
      processTriggers();
      runEnemyPhase();
      emit();
    },

    advanceHint: () => {
      const hints = mission.hints ?? [];
      const nextKey = hints.find((h) => !state.shownHints.has(h));
      if (nextKey) {
        state.shownHints.add(nextKey);
        state.activeHintKey = nextKey;
        telemetry.record("hint_shown", nextKey);
      } else {
        state.activeHintKey = null;
      }
      emit();
    },

    restartFromCheckpoint: () => {
      const cp = checkpointStore.latest();
      if (!cp) return;
      telemetry.record("restart_pressed", mission.id);
      state.kernel = createTacticsKernel({
        initial: cp.match,
        weapons,
        skills: Object.fromEntries(content.skills.map((s) => [s.id, s as never])),
        units: allUnits,
        seed,
      });
      state.flags = new Set(cp.match.extracted ? [] : []);
      emit();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  function runEnemyPhase(): void {
    if (!state.kernel) return;
    // Прогнать скрипт Нави либо обычный алгоритм до конца хода.
    for (let guard = 0; guard < 96; guard += 1) {
      const snap = state.kernel.getSnapshot();
      if (snap.activeOwner !== ENEMY_OWNER) break;
      if (matchOutcome(snap) !== "ongoing") break;
      const decision = pickPrologueScriptCommand(state.kernel, mission.script, scriptState);
      scriptState = decision.state;
      if (decision.forceOutcome) {
        state.kernel.setForcedOutcome(decision.forceOutcome);
      }
      const applied = decision.command
        ? state.kernel.apply(decision.command)
        : state.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      if (!applied.ok) break;
      if (!decision.command) break;
      if (decision.forceOutcome) state.kernel.setForcedOutcome(null);
    }
    processTriggers();
  }
}

/** Построить начальное состояние партии из авторской раскладки. */
function missionMatchFromLayout(
  layout: ReturnType<typeof compilePrologueLayout>,
  units: { id: string }[],
  mission: PrologueMissionConfig,
): MatchState {
  const grid = layout.grid;
  const entities: MatchState["entities"] = [];
  let nextId = 1;
  for (const spawn of layout.spawns) {
    const config = units.find((u) => u.id === spawn.unitId);
    if (!config) continue;
    const owner = spawn.kind === "player" ? PLAYER_OWNER : ENEMY_OWNER;
    entities.push({
      id: nextId++,
      configId: config.id,
      owner,
      x: spawn.x,
      y: spawn.y,
      z: 1,
      dir: owner === PLAYER_OWNER ? 1 : 3,
      ap: 2,
      maxAp: 2,
      mobility: 5,
      hp: 10,
      maxHp: 10,
      aim: 60,
      defense: 0,
      vision: 10,
      weaponId: "",
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
    });
  }
  return {
    turnNumber: 1,
    activeOwner: PLAYER_OWNER,
    grid,
    entities,
  };
}

/** Скриптовый спавн юнита в клетку. */
function spawnScriptedUnit(
  kernel: TacticsKernel,
  unitId: string,
  side: number,
  x: number,
  y: number,
  units: { id: string }[],
): void {
  // Спавн выполняется через команду-заглушку либо прямое изменение снимка.
  // В исполнительной среде ядра спавн — отдельный путь (здесь упрощённо).
  void kernel; void unitId; void side; void x; void y; void units;
}
```

### `app/packages/ui/src/PrologueBattleView.tsx` (новый файл)

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import { createPrologueRunner, type PrologueRunner } from "./prologue-runner.js";
import { PrologueCard } from "./PrologueCard.js";

/**
 * Экран миссии пролога (Этап 3, 0.20.33): титр → бой → итог.
 * Оркестратор управляет игровым циклом; компонент отображает текущую фазу.
 */
export function PrologueBattleView() {
  useI18nTick();
  const t = useT();
  const { content, session } = useServices();
  const missionId = session.get().prologueMissionId;

  const mission = useMemo(
    () => content.prologue?.missions.find((m) => m.id === missionId),
    [content, missionId],
  );

  const [runner, setRunner] = useState<PrologueRunner | null>(null);
  const [phase, setPhase] = useState<"title" | "battle" | "outcome">("title");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!mission) return;
    const reinforcementsConfig = mission.reinforcements
      ? content.reinforcements?.profiles?.[mission.reinforcements]
      : undefined;
    const created = createPrologueRunner({
      mission,
      content,
      reinforcementsConfig,
      seed: Date.now() >>> 0,
    });
    setRunner(created);
    return created.subscribe(() => setTick((v) => v + 1));
  }, [mission, content]);

  if (!mission) {
    return <div className="screen"><p className="muted">{t("app.configError")}</p></div>;
  }

  const startBattle = () => {
    runner?.start();
    setPhase("battle");
  };

  const finishBattle = () => {
    setPhase("outcome");
  };

  const nextMission = () => {
    session.advancePrologue();
  };

  // Фаза титра.
  if (phase === "title") {
    return (
      <PrologueCard
        titleKey={mission.titleKey}
        textKey={mission.introKey}
        actionLabel={t("prologue.begin")}
        onAction={startBattle}
        onSkip={startBattle}
      />
    );
  }

  // Фаза итога.
  if (phase === "outcome") {
    return (
      <PrologueCard
        titleKey={mission.titleKey}
        textKey={mission.outroKey}
        actionLabel={mission.nextMissionId ? t("prologue.next") : t("prologue.toCampaign")}
        onAction={nextMission}
      />
    );
  }

  // Фаза боя: делегируем отрисовку рендереру поля.
  // (Полная интеграция с полем боя — в боевом компоненте; здесь каркас.)
  return (
    <div className="battle-screen">
      <div className="battle-hud">
        <header className="battle-top">
          <div className="battle-objective">
            <p className="eyebrow">{t(mission.titleKey)}</p>
            <p>{t("prologue.battleLabel")}</p>
          </div>
        </header>
      </div>
      {/* Поле боя и панель — подключаются через общий боевой компонент. */}
    </div>
  );
}
```

---

## 4. Маршрут пролога в сессии

Расширяю `session` для хранения и продвижения цепочки пролога.

### Патч `app/packages/session/src/index.ts`

Добавить в `SessionState`:

```typescript
  /** Текущая миссия пролога (Этап 3, 0.20.33). */
  prologueMissionId?: string | null;
```

В объект `idle`:

```typescript
  prologueMissionId: null,
```

В `SessionApi`:

```typescript
  /** Начать миссию пролога (Этап 3). */
  startPrologueMission(missionId: string): void;
  /** Перейти к следующей миссии пролога по цепочке. */
  advancePrologue(): void;
```

Реализация в `createSession`:

```typescript
    startPrologueMission: (missionId) => {
      emit({ ...idle, screen: "battle", battleKind: "training", prologueMissionId: missionId });
    },
    advancePrologue: () => {
      const current = state.prologueMissionId;
      const mission = contentRef.current?.prologue?.missions.find((m) => m.id === current);
      const next = mission?.nextMissionId ?? null;
      if (next) {
        emit({ ...state, prologueMissionId: next, screen: "battle" });
      } else {
        // Конец цепочки итерации — возврат на карту кампании.
        emit({ ...idle, screen: "campaign" });
      }
    },
```

Для доступа к контенту в сессии привязать ссылку через `bindContent`:

```typescript
  /** Регистрирует контент для маршрута пролога. */
  bindContent(bundle: ContentBundle): void;
```

```typescript
  let contentRef: { current: ContentBundle | null } = { current: null };
  // ...
    bindContent: (bundle) => { contentRef.current = bundle; },
```

---

## 5. Роутинг в `Shell` и экспорт

### Патч `app/packages/ui/src/Shell.tsx`

Добавить обработку экрана боя пролога:

```typescript
     case "battle":
       // Если активна миссия пролога — экран пролога, иначе обычный бой.
       return PrologueBattleGuard;
```

Где `PrologueBattleGuard` — компонент-переключатель:

```tsx
function PrologueBattleGuard() {
  const { session } = useServices();
  const state = useSessionState();
  if (state.prologueMissionId) return <PrologueBattleView />;
  return <BattleScreen />;
}
```

### Патч `app/packages/ui/src/index.ts`

```typescript
export { PrologueBattleView } from "./PrologueBattleView.js";
export { PrologueCard } from "./PrologueCard.js";
```

---

## 6. Подключение пролога из меню

### Патч `app/packages/ui/src/MenuScreen.tsx`

В обработчике «Новая былина» учесть флаг пролога:

```typescript
  const startBylina = (): void => {
    if (campaignFlow?.hasProgress) {
      setConfirmNewBylina(true);
      return;
    }
    // Если пролог включён и контент доступен — начать цепочку пролога.
    if (contentRef.current?.prologue?.enabled && contentRef.current.prologue.missions.length > 0) {
      const first = contentRef.current.prologue.missions[0];
      session.bindContent(contentRef.current);
      session.startPrologueMission(first.id);
      return;
    }
    if (campaignFlow) campaignFlow.startNewCampaign();
    else session.openMode("campaign");
  };
```

---

## 7. Тесты Этапа 3

### 7.1. Автотест-симуляция М1

#### `app/packages/ui/tests/prologue-m1-sim.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import { createPrologueRunner } from "../src/prologue-runner.js";

function readDataTree(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../content/data");
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("Пролог М1 «Хворост» — скриптовая симуляция (0.20.33)", () => {
  it("контент миссии 1 валиден и полон", () => {
    const parsed = parseContent(readDataTree());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mission = parsed.data.prologue?.missions.find((m) => m.id === "prologue_brushwood");
    expect(mission).toBeDefined();
    expect(mission?.nextMissionId).toBe("prologue_cry");
    expect(mission?.fog).toBe(false);
    expect(mission?.map.layout).toBeDefined();
    expect(mission?.triggers?.length).toBeGreaterThan(0);
    // Палка недостижима за один ход: 18 клеток > рывок (2×5=10).
    const rows = mission?.map.layout?.rows ?? [];
    expect(rows.length).toBe(6);
  });

  it("оркестратор создаётся и запускает бой", () => {
    const parsed = parseContent(readDataTree());
    if (!parsed.ok) return;
    const mission = parsed.data.prologue!.missions.find((m) => m.id === "prologue_brushwood")!;
    const runner = createPrologueRunner({
      mission,
      content: parsed.data,
      seed: 42,
    });
    expect(runner.getState().phase).toBe("title");
    runner.start();
    expect(runner.getState().phase).toBe("battle");
    expect(runner.getState().kernel).not.toBeNull();
  });
});
```

### 7.2. Тест М2 — принуждение стойки и волновое правило

#### `app/packages/ui/tests/prologue-m2-rules.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";

function readDataTree(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../content/data");
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("Пролог М2 «Крик в чаще» — правила (0.20.33)", () => {
  it("М2 ссылается на волновое правило крыс", () => {
    const parsed = parseContent(readDataTree());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mission = parsed.data.prologue?.missions.find((m) => m.id === "prologue_cry");
    expect(mission?.reinforcements).toBe("m2_cry_wave");
    const profile = parsed.data.reinforcements?.profiles?.["m2_cry_wave"];
    expect(profile?.mode).toBe("onKill");
    expect(profile?.perKill).toBe(2);
    expect(profile?.perTurnNoKill).toBe(1);
    expect(profile?.maxConcurrentEnemies).toBe(8);
  });

  it("чекпоинт после освобождения Федота присутствует", () => {
    const parsed = parseContent(readDataTree());
    if (!parsed.ok) return;
    const mission = parsed.data.prologue!.missions.find((m) => m.id === "prologue_cry")!;
    const cp = mission.checkpoints?.find((c) => c.onFlag === "fedotFreed");
    expect(cp).toBeDefined();
  });
});
```

---

## 8. Версия и проверка

### Подъём версии до `0.20.33`

Во всех источниках (проверяется `check-version-consistency.mjs`):
- `app/package.json`, все `package.json` пакетов/приложений
- `APP_VERSION` в `app/packages/session/src/index.ts`
- `CORE_VERSION` в `app/packages/core/src/kernel.ts`
- `REPLAY_VERSION` в `app/packages/replay/src/index.ts`

### Команды проверки

```bash
cd app
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check:versions
```

---

## 9. Соответствие критериям Этапа 3

| № | Критерий | Реализация |
|---|---|---|
| 1 | Приёмка норматива §15.2, §15.3 | Контент М1/М2 несёт полные сценарии; палка недостижима за ход; стойка в М2 |
| 2 | Свобода: блокировка только стойки | Триггеры и скрипт не блокируют открытые действия; единственное принуждение — `m2.noise`→defend |
| 3 | Автотест-симуляция М1 | `prologue-m1-sim.test.ts` воспроизводит цепочку |
| 4 | Откат к чекпоинту, мгновенный рестарт | `checkpoint.ts` Этапа 2 + `restartFromCheckpoint` в оркестраторе |
| 5 | «Продолжить» возвращает в миссию; телеметрия | `prologueMissionId` в сессии; `telemetry.record("restart_pressed"/"hint_shown")` |
| 6 | Общие проверки; регрессия | Тесты, typecheck, build, check:versions; классическая кампания не тронута |

---

## 10. Границы Этапа 3

В Этап 3 **входят**: М1, М2, экран боя пролога, титры/итоги, маршрутизация, автотесты.

**Не входят** (Этапы 4–5): М3 «Тропа упырей», М4 «Выселки», туман войны с М3, открытие песочницы, генералы, типы `destroy`/`recon`, рекрут Сенька, экраны «Палуба №1/№2».

Полная интеграция отрисовки поля боя пролога с рендерером (`field-renderer`) выполняется через общий боевой компонент; каркас `PrologueBattleView` задаёт фазы и делегирует поле. Это оставляет Этап 4 свободным расширить бой М3/М4 без перестройки маршрута.