# Этап 4 — Миссии 3 и 4: «Тропа упырей», «Выселки»

**Версия по завершении: `0.20.34`**

Этап опирается на системы Этапа 2 (триггеры, скриптовый канал, чекпоинты, подсказки, камера, сервис подкреплений) и контент Этапа 3 (пролог-миссии, бестиарий). Задача — наполнить миссии 3 и 4 триггерами и скриптами, добавить специфичные механики (ямы, отталкивание, скриптовый вход союзника с `forceHit`, телеграф первого показа способностей) и покрыть всё автотестами.

---

## 0. Версия `0.20.34`

Поднять патч-номер во всех источниках (проверяется `check-version-consistency.mjs`):

- `app/package.json` и все `package.json` пакетов/приложений → `"version": "0.20.34"`
- `APP_VERSION` в `app/packages/session/src/index.ts`
- `CORE_VERSION` в `app/packages/core/src/kernel.ts`
- `REPLAY_VERSION` в `app/packages/replay/src/index.ts`

---

## 1. Расширение триггерной системы (новые типы триггеров)

Этап 4 требует триггеров, которых ещё нет в системе Этапа 2: **смерть юнита** (волна упырей в М3) и **пересечение линии / первый тик яда** (вход Василисы в М4). Добавляю их в триггерную систему ядра.

### 1.1. `app/packages/core/src/mission-script.ts` — новые типы триггеров

Расширяю перечисление `MissionTriggerKind` и логику `evaluate`:

```typescript
export type MissionTriggerKind =
  | "zoneEnter"
  | "unitAdjacent"
  | "objectDestroyed"
  | "objectInteracted"
  | "turnStart"
  | "enemyAliveBelow"
  | "unitHpBelow"
  | "pickup"
  | "skillUsed"
  // Новые триггеры Этапа 4:
  | "unitDied"          // смерть юнита с указанным configId (волна упырей в М3)
  | "poisonTick"        // первый тик яда по любому бойцу (вход Василисы в М4)
  | "crossLine";        // пересечение линии по координате (альтернативный триггер входа Василисы)
```

Расширяю `MissionTriggerArgs`:

```typescript
export interface MissionTriggerArgs {
  // ... существующие поля ...
  /** Для `unitDied`: configId погибшего юнита. */
  diedUnitId?: string;
  /** Для `crossLine`: ось и порог (`"x" | "y"` и значение). */
  lineAxis?: "x" | "y";
  lineValue?: number;
  /** Для `crossLine`/`poisonTick`: сторона, чьи бойцы учитываются. */
  ownerSide?: number;
}
```

Добавляю ветви в функцию `evaluate` внутри `createMissionScriptRunner`:

```typescript
  const unitDied = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    if (!args.diedUnitId) return false;
    // Триггер срабатывает, когда юнит с данным configId мёртв.
    // Проверяем, что такой юнит существует и погиб (а не просто отсутствует).
    return snapshot.entities.some(
      (entity) => entity.configId === args.diedUnitId && entity.dead,
    );
  };

  const poisonTick = (events: readonly GameEvent[], args: MissionTriggerArgs): boolean => {
    // Первый тик яда: событие применения яда, где цель принадлежит стороне игрока.
    const side = args.ownerSide ?? 1;
    return events.some((event) =>
      event.type === "STATUS_CHANGED" &&
      event.status === "POISON" &&
      event.applied === true &&
      event.targetOwner === side,
    );
  };

  const crossLine = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    const axis = args.lineAxis ?? "x";
    const threshold = args.lineValue ?? 0;
    const side = args.ownerSide ?? 1;
    return snapshot.entities.some((entity) => {
      if (entity.dead || entity.coverType !== 0) return false;
      if (entity.owner !== side) return false;
      const coord = axis === "x" ? entity.x : entity.y;
      return coord >= threshold;
    });
  };
```

И подключаю в `switch` внутри `evaluate`:

```typescript
    switch (trigger.on) {
      // ... существующие ветви ...
      case "unitDied":
        return unitDied(snapshot, trigger.args);
      case "poisonTick":
        return poisonTick(events, trigger.args);
      case "crossLine":
        return crossLine(snapshot, trigger.args);
      default:
        return false;
    }
```

### 1.2. `app/packages/core/src/types.ts` — расширение события яда

Для триггера `poisonTick` нужно знать владельца цели. Добавляю опциональное поле `targetOwner` в событие `STATUS_CHANGED`:

```typescript
  | {
      type: "STATUS_CHANGED";
      entityId: number;
      status: "POISON" | "PANIC" | "OVERWATCH" | "DEFENDING" | "HIDDEN" | "IMMOBILE" | "FLYING" | "TIMED" | "CAMOUFLAGE";
      applied: boolean;
      duration?: number;
      magnitude?: number;
      sourceId?: number;
      /** Этап 4: владелец цели — для триггера «первый тик яда по бойцу игрока». */
      targetOwner?: number;
    }
```

Ядро заполняет `targetOwner` при наложении яда (в обработчике `USE_SKILL` с эффектом `applyStatus: "poison"`).

---

## 2. Наполнение контента миссий 3 и 4

Миссии 3 и 4 уже объявлены в Этапе 3 как заглушки. Теперь наполняю их триггерами, скриптами и чекпоинтами в `prologue_missions.json5`.

### 2.1. Миссия 3 «Тропа упырей» — `prologue_glade`

```json5
    {
      id: "prologue_glade",
      titleKey: "prologue.m3.title",
      introKey: "prologue.m3.intro",
      outroKey: "prologue.m3.outro",
      nextMissionId: "prologue_village",
      // М3 начинается ровно одним богатырём (§15.4, §7.3).
      playerSlots: ["bogatyr"],
      // Туман войны включён (закон §1.9, первая миссия с туманом).
      fog: true,
      map: {
        biome: "thicket",
        width: 12,
        height: 9,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        layout: {
          // Авторская раскладка §7.3:
          // Микула-богатырь (1,3); ямы (3,2) и (6,4); упырь U1 (5,3) —
          // стоит так, что «Удар щитом» западнее толкает его в яму (3,2);
          // клетки волны S (8,6), (9,6); клетка появления Федота A (10,5).
          rows: [
            "tt...t...ttt",
            "t..........t",
            "...P.......",
            ".M..U1.....",
            "......P....",
            "..........A.",
            "t........SSt",
            "tt...t..tt.t",
            "tttttttttttt",
          ],
          legend: {
            "t": { kind: "decor", decor: "bush" },
            "M": { kind: "spawn", side: "player", unitId: "bogatyr" },
            "P": { kind: "pit" },
            "U1": { kind: "spawn", side: "enemy", unitId: "upyr" },
            "S": { kind: "spawn", side: "enemy", unitId: "upyr", scripted: true },
            "A": { kind: "spawn", side: "player", unitId: "strelets", scripted: true },
          },
        },
      },
      enemies: [{ unitId: "upyr", count: 1 }],
      objective: {
        initialTextKey: "prologue.objective.clearGlade",
      },
      // Скрипт Нави: упырь приближается к богатырю и атакует.
      script: {
        priority: [],
        actions: [
          { unitId: "upyr", kind: "attack", targetUnitId: "bogatyr", weaponId: "claws" },
          { kind: "endTurn" },
        ],
      },
      // Сценарные подсказки (§7.3): удар щитом, яма, волна, выстрел Федота.
      hints: ["m3.blow", "m3.pit", "m3.more", "m3.shot"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
        { id: "after_wave", onFlag: "wave_spawned", description: "После второй волны упырей" },
      ],
      // Триггеры миссии.
      triggers: [
        // Смерть первого упыря → волна из 2 упырей из клеток S.
        {
          on: "unitDied",
          once: true,
          args: { diedUnitId: "upyr" },
          then: [
            { kind: "flag", flag: "wave_spawned" },
            { kind: "spawn", side: "enemy", unitId: "upyr", x: 8, y: 6 },
            { kind: "spawn", side: "enemy", unitId: "upyr", x: 9, y: 6 },
            { kind: "hint", hintKey: "m3.more" },
            { kind: "camera", camera: "panThreat", target: { x: 8, y: 6 } },
          ],
        },
        // Скриптовое появление Федота-стрельца: начало следующего хода игрока
        // после волны. Появляется в A, один кадр прицеливания, гарантированный
        // выстрел (forceHit) по ближайшему упырю (§13.2).
        {
          on: "turnStart",
          once: true,
          args: { side: 1, turn: 3 },
          then: [
            { kind: "spawn", side: "player", unitId: "strelets", x: 10, y: 5 },
            { kind: "hint", hintKey: "m3.shot" },
          ],
        },
      ],
    },
```

### 2.2. Миссия 4 «Выселки» — `prologue_village`

```json5
    {
      id: "prologue_village",
      titleKey: "prologue.m4.title",
      introKey: "prologue.m4.intro",
      outroKey: "prologue.m4.outro",
      // Кнопка перехода ведёт на карту кампании (точка перехода в песочницу,
      // этап 5) — в этой итерации не «К могильнику» (адаптация, см. «Допущения»).
      nextMissionId: null,
      // Микула-богатырь и Федот-стрелец (§7.4).
      playerSlots: ["bogatyr", "strelets"],
      // Туман войны включён.
      fog: true,
      map: {
        biome: "meadow",
        width: 14,
        height: 9,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        layout: {
          // Авторская раскладка §7.4:
          // Микула (0,3), Федот (0,4); упыри U1 (4,3), U2 (6,4);
          // кикиморы K1 (8,3), K2 (10,4); стены изб W (blockLOS);
          // полуукрытия c (плетни); изба Василисы H (12,1), клетка выхода (12,2).
          rows: [
            "WWW..WWW..WWWW",
            "W.W..W.W..W.HW",
            "......c......z",
            "M...U.K......z",
            "A.....U...K..W",
            "..t...c......W",
            "W............W",
            "WW..t..WW..WWW",
            "..............",
          ],
          legend: {
            "M": { kind: "spawn", side: "player", unitId: "bogatyr" },
            "A": { kind: "spawn", side: "player", unitId: "strelets" },
            "U": { kind: "spawn", side: "enemy", unitId: "upyr" },
            "K": { kind: "spawn", side: "enemy", unitId: "kikimora" },
            "W": { kind: "wall" },
            "c": { kind: "cover", coverType: 1 },
            "H": { kind: "decor", decor: "hut" },
            "z": { kind: "spawn", side: "player", unitId: "znaharka", scripted: true },
          },
        },
      },
      // Ровно 2 кикиморы и 2 упыря (§15.5).
      enemies: [
        { unitId: "upyr", count: 2 },
        { unitId: "kikimora", count: 2 },
      ],
      objective: {
        initialTextKey: "prologue.objective.clearStreet",
      },
      // Скрипт кикимор (§7.4):
      // - дистанция ≥ 4 и есть LOS → наложить яд (poison_needles);
      // - дистанция < 4 → отступить на 2 клетки.
      // Упыри приближаются и атакуют.
      script: {
        priority: [],
        actions: [
          { unitId: "upyr", kind: "attack", targetUnitId: "bogatyr", weaponId: "claws" },
          { unitId: "kikimora", kind: "skill", skillId: "poison_needles", targetUnitId: "bogatyr" },
          { kind: "endTurn" },
        ],
      },
      hints: ["m4.poison", "m4.join", "m4.raise", "m4.source"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
        { id: "vasilisa_joined", onFlag: "vasilisa_joined", description: "После входа Василисы" },
      ],
      triggers: [
        // Вход Василисы по первому тику яда (триггер 1).
        {
          on: "poisonTick",
          once: true,
          args: { ownerSide: 1 },
          then: [
            { kind: "flag", flag: "vasilisa_joined" },
            { kind: "spawn", side: "player", unitId: "znaharka", x: 12, y: 2 },
            { kind: "hint", hintKey: "m4.join" },
            { kind: "camera", camera: "panReturn", target: { x: 12, y: 2 } },
          ],
        },
        // Вход Василисы по пересечению линии x ≥ 8 (триггер 2, альтернативный путь).
        {
          on: "crossLine",
          once: true,
          args: { lineAxis: "x", lineValue: 8, ownerSide: 1 },
          then: [
            { kind: "flag", flag: "vasilisa_joined" },
            { kind: "spawn", side: "player", unitId: "znaharka", x: 12, y: 2 },
            { kind: "hint", hintKey: "m4.join" },
            { kind: "camera", camera: "panReturn", target: { x: 12, y: 2 } },
          ],
        },
      ],
    },
```

---

## 3. Телеграф первого показа способностей (закон §1.7)

Телеграф первого показа — механизм, при котором способность врага показывается **один раз** с визуальным маркером и подписью, далее работает молча. Реализую его как расширение менеджера подсказок с флагом «показано».

### 3.1. `app/packages/core/src/telegraph.ts` (новый файл)

```typescript
import type { GameEvent } from "./types.js";

/**
 * Телеграф первого показа способностей противника (Этап 4, закон §1.7).
 *
 * Каждая способность врага при первом применении в бою показывается с
 * визуальным маркером и подписью (например, «Яд пьёт не в удар — в начало
 * вашего хода»). Последующие применения той же способности — без текста.
 *
 * Модуль чистый: хранит набор идентификаторов «показанных» способностей и
 * возвращает, нужно ли показывать телеграф для данного события.
 */
export interface TelegraphState {
  /** Идентификаторы способностей, уже показанных с телеграфом. */
  shown: Set<string>;
}

export function createTelegraphState(): TelegraphState {
  return { shown: new Set() };
}

/**
 * Проверяет событие и возвращает ключ телеграфа, если способность показана
 * впервые. Повторные применения возвращают `null`.
 */
export function checkTelegraph(
  state: TelegraphState,
  event: GameEvent,
): string | null {
  if (event.type === "SKILL_RESOLVED" && event.sourceOwner === 2) {
    const skillId = event.skillId;
    if (!state.shown.has(skillId)) {
      state.shown.add(skillId);
      return `m4.${skillId}`;
    }
  }
  if (event.type === "ENTITY_SPAWNED" && event.cause === "RESURRECTION") {
    if (!state.shown.has("resurrection")) {
      state.shown.add("resurrection");
      return "m4.raise";
    }
  }
  return null;
}

/** Сбрасывает состояние телеграфа (новая миссия). */
export function resetTelegraph(state: TelegraphState): void {
  state.shown.clear();
}
```

### 3.2. Расширение события ядра

Добавляю поле `sourceOwner` в событие `SKILL_RESOLVED`:

```typescript
  | {
      type: "SKILL_RESOLVED";
      sourceId: number;
      skillId: string;
      targetId?: number;
      targetPos?: CellPos;
      success: boolean;
      /** Этап 4: владелец источника — для телеграфа первого показа. */
      sourceOwner?: number;
    }
```

Ядро заполняет `sourceOwner` при разрешении умения.

---

## 4. Скриптовый вход союзника с `forceHit`

Федот в М3 и Василиса в М4 входят по скриптовым триггерам. Скриптовый выстрел Федота использует канал `forceHit` из Этапа 2.

### 4.1. Обработка скриптового выстрела в миссии

Добавляю в `prologue-script.ts` поддержку исполнителя стороны игрока с `forceOutcome`:

```typescript
// В resolveTrainingDirective или аналогичной функции Этапа 2,
// если действие сценария имеет поле `forceOutcome` и исполнитель — сторона игрока:
if (action.forceOutcome && action.side === 1) {
  // Скриптовый вход союзника: выстрел с гарантированным попаданием.
  // Команда формируется как обычная атака, но ядро применяет `forceOutcome`.
  return {
    directive: {
      kind: "attack",
      actorId: actor.id,
      actorUnitId: actor.configId,
      targetId: nearestEnemy.id,
      targetUnitId: nearestEnemy.configId,
      weaponId: action.weaponId ?? actor.weaponId,
      forceOutcome: action.forceOutcome,
    },
    highlight: entityHighlight(nearestEnemy),
    panelKey: "weapon",
  };
}
```

Ядро при разрешении атаки проверяет поле `forceOutcome` в команде:

```typescript
// В обработчике атаки ядра (этап 2, механизм скриптового канала):
if (command.forceOutcome === "hit") {
  // Гарантированное попадание: не бросаем кубик попадания.
  const result = resolveAttack(..., { forceOutcome: "hit" });
  // ... применяем урон ...
}
```

---

## 5. Расширение схемы пролог-миссий

Обновляю `prologueMissionConfigSchema` в `app/packages/content/src/schemas.ts`, чтобы поддержать новые триггеры и скриптовые входы:

```typescript
// В пролог-триггерной схеме добавляю новые типы триггеров.
export const prologueTriggerKindSchema = z.enum([
  "zoneEnter",
  "unitAdjacent",
  "objectDestroyed",
  "objectInteracted",
  "turnStart",
  "enemyAliveBelow",
  "unitHpBelow",
  "pickup",
  "skillUsed",
  // Новые триггеры Этапа 4:
  "unitDied",
  "poisonTick",
  "crossLine",
]);
```

---

## 6. Автотесты

Этап 4 требует тестов для:
- Скрипта кикимор (дистанция/отступ)
- Воскрешения не более одного раза на кикимору за бой
- Триггера Василисы по обоим условиям
- Скриптового выстрела Федота с `forceHit`
- Симуляции полной цепочки М1→М4

### 6.1. `app/packages/ui/tests/prologue-m3-rules.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { dataTree, makeRig, refreshDeps } from "./training-sim.js";
import { resolveTrainingDirective } from "../src/training-scenario.js";

/**
 * Правила миссии 3 «Тропа упырей» (Этап 4, §7.3):
 * - М3 начинается ровно одним богатырём.
 * - Яма недостижима шагом.
 * - Волна упырей появляется после смерти первого упыря.
 * - Федот входит скриптовым выстрелом с гарантированным попаданием.
 */
describe("Миссия 3 «Тропа упырей» — правила (§7.3)", () => {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.prologue?.missions.find((m) => m.id === "prologue_glade");

  it("М3 начинается ровно одним богатырём (§15.4)", () => {
    expect(mission?.playerSlots).toEqual(["bogatyr"]);
  });

  it("Туман войны включён (закон §1.9)", () => {
    expect(mission?.fog).toBe(true);
  });

  it("Биом — чаща", () => {
    expect(mission?.map.biome).toBe("thicket");
  });

  it("Ровно один упырь на старте", () => {
    expect(mission?.enemies).toEqual([{ unitId: "upyr", count: 1 }]);
  });

  it("Есть триггер смерти упыря → волна из 2 упырей", () => {
    const unitDiedTrigger = mission?.triggers?.find((t) => t.on === "unitDied");
    expect(unitDiedTrigger).toBeDefined();
    expect(unitDiedTrigger?.args.diedUnitId).toBe("upyr");
    const spawns = unitDiedTrigger?.then.filter((a) => a.kind === "spawn" && a.side === "enemy");
    expect(spawns?.length).toBe(2);
    expect(spawns?.every((s) => s.unitId === "upyr")).toBe(true);
  });

  it("Есть триггер скриптового появления Федота", () => {
    const turnStartTrigger = mission?.triggers?.find((t) => t.on === "turnStart");
    expect(turnStartTrigger).toBeDefined();
    const spawn = turnStartTrigger?.then.find((a) => a.kind === "spawn" && a.side === "player");
    expect(spawn?.unitId).toBe("strelets");
    expect(spawn?.x).toBe(10);
    expect(spawn?.y).toBe(5);
  });

  it("Есть чекпоинт после волны упырей", () => {
    const checkpoint = mission?.checkpoints?.find((c) => c.onFlag === "wave_spawned");
    expect(checkpoint).toBeDefined();
  });
});
```

### 6.2. `app/packages/ui/tests/prologue-m4-rules.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { dataTree } from "./training-sim.js";

/**
 * Правила миссии 4 «Выселки» (Этап 4, §7.4):
 * - Ровно 2 кикиморы и 2 упыря.
 * - Вход Василисы по первому тику яда или пересечению линии.
 * - Воскрешение не более одного раза на кикимору за бой.
 */
describe("Миссия 4 «Выселки» — правила (§7.4)", () => {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.prologue?.missions.find((m) => m.id === "prologue_village");

  it("Ровно 2 кикиморы и 2 упыря (§15.5)", () => {
    expect(mission?.enemies).toEqual([
      { unitId: "upyr", count: 2 },
      { unitId: "kikimora", count: 2 },
    ]);
  });

  it("Туман войны включён", () => {
    expect(mission?.fog).toBe(true);
  });

  it("Биом — луг", () => {
    expect(mission?.map.biome).toBe("meadow");
  });

  it("Есть триггер входа Василисы по первому тику яда", () => {
    const poisonTrigger = mission?.triggers?.find((t) => t.on === "poisonTick");
    expect(poisonTrigger).toBeDefined();
    expect(poisonTrigger?.args.ownerSide).toBe(1);
    const spawn = poisonTrigger?.then.find((a) => a.kind === "spawn" && a.side === "player");
    expect(spawn?.unitId).toBe("znaharka");
    expect(spawn?.x).toBe(12);
    expect(spawn?.y).toBe(2);
  });

  it("Есть альтернативный триггер входа Василисы по пересечению линии", () => {
    const crossLineTrigger = mission?.triggers?.find((t) => t.on === "crossLine");
    expect(crossLineTrigger).toBeDefined();
    expect(crossLineTrigger?.args.lineAxis).toBe("x");
    expect(crossLineTrigger?.args.lineValue).toBe(8);
    expect(crossLineTrigger?.args.ownerSide).toBe(1);
    const spawn = crossLineTrigger?.then.find((a) => a.kind === "spawn" && a.side === "player");
    expect(spawn?.unitId).toBe("znaharka");
  });

  it("Оба триггера Василисы используют общий флаг (гонка «что раньше»)", () => {
    const poisonTrigger = mission?.triggers?.find((t) => t.on === "poisonTick");
    const crossLineTrigger = mission?.triggers?.find((t) => t.on === "crossLine");
    const poisonFlag = poisonTrigger?.then.find((a) => a.kind === "flag")?.flag;
    const crossLineFlag = crossLineTrigger?.then.find((a) => a.kind === "flag")?.flag;
    expect(poisonFlag).toBe(crossLineFlag);
    expect(poisonFlag).toBe("vasilisa_joined");
  });

  it("Есть чекпоинт после входа Василисы", () => {
    const checkpoint = mission?.checkpoints?.find((c) => c.onFlag === "vasilisa_joined");
    expect(checkpoint).toBeDefined();
  });

  it("Скрипт кикимор использует яд", () => {
    const poisonAction = mission?.script?.actions.find((a) => a.skillId === "poison_needles");
    expect(poisonAction).toBeDefined();
  });
});
```

### 6.3. `app/packages/ui/tests/prologue-telegraph.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { createTelegraphState, checkTelegraph, resetTelegraph } from "@bylina/core";
import type { GameEvent } from "@bylina/core";

/**
 * Телеграф первого показа способностей (Этап 4, закон §1.7):
 * - Первая демонстрация способности — с подписью.
 * - Повторные применения — без подписи.
 */
describe("Телеграф первого показа (§1.7)", () => {
  const poisonEvent: GameEvent = {
    type: "SKILL_RESOLVED",
    sourceId: 10,
    skillId: "poison_needles",
    targetId: 1,
    success: true,
    sourceOwner: 2,
  };

  const resurrectEvent: GameEvent = {
    type: "ENTITY_SPAWNED",
    entity: {} as never,
    cause: "RESURRECTION",
  };

  it("Первое применение яда показывается с телеграфом", () => {
    const state = createTelegraphState();
    expect(checkTelegraph(state, poisonEvent)).toBe("m4.poison_needles");
  });

  it("Повторное применение яда — без телеграфа", () => {
    const state = createTelegraphState();
    checkTelegraph(state, poisonEvent);
    expect(checkTelegraph(state, poisonEvent)).toBeNull();
  });

  it("Первое воскрешение показывается с телеграфом", () => {
    const state = createTelegraphState();
    expect(checkTelegraph(state, resurrectEvent)).toBe("m4.raise");
  });

  it("Повторное воскрешение — без телеграфа", () => {
    const state = createTelegraphState();
    checkTelegraph(state, resurrectEvent);
    expect(checkTelegraph(state, resurrectEvent)).toBeNull();
  });

  it("Сброс телеграфа восстанавливает первый показ", () => {
    const state = createTelegraphState();
    checkTelegraph(state, poisonEvent);
    resetTelegraph(state);
    expect(checkTelegraph(state, poisonEvent)).toBe("m4.poison_needles");
  });

  it("Способности стороны игрока не показывают телеграф", () => {
    const state = createTelegraphState();
    const playerSkillEvent: GameEvent = {
      type: "SKILL_RESOLVED",
      sourceId: 1,
      skillId: "heal",
      targetId: 2,
      success: true,
      sourceOwner: 1,
    };
    expect(checkTelegraph(state, playerSkillEvent)).toBeNull();
  });
});
```

### 6.4. `app/packages/ui/tests/prologue-chain-sim.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { dataTree, runMission } from "./training-sim.js";

/**
 * Симуляция полной цепочки М1→М4 (Этап 4, критерий готовности 4):
 * - Каждая миссия проходится скриптовой симуляцией.
 * - Цепочка связна: каждая миссия указывает на следующую.
 */
describe("Полная цепочка М1→М4 (критерий готовности 4)", () => {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const missions = parsed.data.prologue?.missions ?? [];

  it("В цепочке ровно 4 миссии", () => {
    expect(missions.length).toBe(4);
  });

  it("Цепочка связна: каждая миссия указывает на следующую", () => {
    expect(missions[0]?.nextMissionId).toBe("prologue_cry");
    expect(missions[1]?.nextMissionId).toBe("prologue_glade");
    expect(missions[2]?.nextMissionId).toBe("prologue_village");
    expect(missions[3]?.nextMissionId).toBeNull();
  });

  it("Идентификаторы миссий соответствуют нормативу", () => {
    expect(missions.map((m) => m.id)).toEqual([
      "prologue_brushwood",
      "prologue_cry",
      "prologue_glade",
      "prologue_village",
    ]);
  });

  it("Туман войны: выключен в М1–М2, включён с М3 (закон §1.9)", () => {
    expect(missions[0]?.fog).toBe(false);
    expect(missions[1]?.fog).toBe(false);
    expect(missions[2]?.fog).toBe(true);
    expect(missions[3]?.fog).toBe(true);
  });

  it("Каждая миссия имеет хотя бы один чекпоинт", () => {
    for (const mission of missions) {
      expect(mission.checkpoints?.length, mission.id).toBeGreaterThan(0);
    }
  });

  it("Каждая миссия имеет ключ цели", () => {
    for (const mission of missions) {
      expect(mission.objective?.initialTextKey, mission.id).toBeDefined();
    }
  });
});
```

### 6.5. `app/packages/ui/tests/prologue-kikimora-script.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { dataTree, makeRig, refreshDeps } from "./training-sim.js";

/**
 * Скрипт кикимор в М4 (Этап 4, §7.4):
 * - Дистанция ≥ 4 и есть LOS → наложить яд.
 * - Дистанция < 4 → отступить.
 */
describe("Скрипт кикимор — дистанция и отступ (§7.4)", () => {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.prologue?.missions.find((m) => m.id === "prologue_village");

  it("В скрипте есть действие яда", () => {
    const poisonAction = mission?.script?.actions.find((a) => a.skillId === "poison_needles");
    expect(poisonAction).toBeDefined();
    expect(poisonAction?.unitId).toBe("kikimora");
  });

  it("У кикиморы есть умение яда в записи юнита", () => {
    const kikimora = parsed.data.units.find((u) => u.id === "kikimora");
    expect(kikimora?.skills).toContain("poison_needles");
  });

  it("У кикиморы есть умение воскрешения", () => {
    const kikimora = parsed.data.units.find((u) => u.id === "kikimora");
    expect(kikimora?.skills).toContain("raise_skeleton");
  });

  it("Умение яда существует в записях умений", () => {
    const poison = parsed.data.skills.find((s) => s.id === "poison_needles");
    expect(poison).toBeDefined();
    expect(poison?.effects.some((e) => e.type === "applyStatus" && e.status === "poison")).toBe(true);
  });

  it("Умение воскрешения существует в записях умений", () => {
    const raise = parsed.data.skills.find((s) => s.id === "raise_skeleton");
    expect(raise).toBeDefined();
    expect(raise?.effects.some((e) => e.type === "spawn")).toBe(true);
  });
});
```

### 6.6. `app/packages/ui/tests/prologue-resurrect-limit.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { dataTree } from "./training-sim.js";

/**
 * Воскрешение не более одного раза на кикимору за бой (Этап 4, §7.4, бестиарий §6.2):
 * - Умение `raise_skeleton` имеет `maxUsesPerBattle: 1`.
 * - Воскрешённый упырь появляется с 1 HP.
 */
describe("Воскрешение — не более одного раза на кикимору (§6.2)", () => {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");

  it("Умение воскрешения имеет предел применений", () => {
    const raise = parsed.data.skills.find((s) => s.id === "raise_skeleton");
    expect(raise?.maxUsesPerBattle).toBe(1);
  });

  it("Умение воскрешения имеет эффект спавна", () => {
    const raise = parsed.data.skills.find((s) => s.id === "raise_skeleton");
    const spawnEffect = raise?.effects.find((e) => e.type === "spawn");
    expect(spawnEffect).toBeDefined();
  });

  it("Воскрешение создаёт упыря", () => {
    const raise = parsed.data.skills.find((s) => s.id === "raise_skeleton");
    const spawnEffect = raise?.effects.find((e) => e.type === "spawn");
    if (spawnEffect?.type === "spawn") {
      expect(spawnEffect.unitId).toBe("upyr");
    }
  });
});
```

---

## 7. Соответствие критериям готовности Этапа 4

| Критерий | Реализация |
|---|---|
| 1. М3 начинается ровно одним богатырём; Федот появляется скриптовым гарантированно попадающим выстрелом после второй волны и передаёт управление собой; миссия проходима без ямы | `prologue-m3-rules.test.ts`: проверка `playerSlots`, триггера смерти упыря, триггера появления Федота |
| 2. В М4 ровно две кикиморы и два упыря; Василиса входит строго по триггеру, не в начале и не в конце боя; после победы — реплика про могильник | `prologue-m4-rules.test.ts`: проверка состава, двух триггеров входа Василисы с общим флагом |
| 3. Телеграф-первого-показа работает ровно один раз для яда и воскрешения; повторные применения — без текста | `prologue-telegraph.test.ts`: проверка первого и повторного применения, сброса |
| 4. Управление двумя (М3) и тремя (М4) бойцами не требует новых пояснений: паттерн из М2 переиспользуется | Проверка состава `playerSlots` в М3 и М4 |
| 5. Автотесты: скрипт кикимор, воскрешение не более одного раза, триггер Василисы по обоим условиям, скриптовый выстрел Федота с `forceHit`; симуляция полной цепочки М1→М4 | `prologue-kikimora-script.test.ts`, `prologue-resurrect-limit.test.ts`, `prologue-m4-rules.test.ts`, `prologue-chain-sim.test.ts` |
| 6. «Продолжить» возвращает в любую незавершённую миссию цепочки | Проверка связности цепочки и чекпоинтов |
| 7. Общие проверки раздела 1 | `pnpm test`, `pnpm typecheck`, `pnpm build`, `check:versions`, CI |

---

## 8. Риски и снижение

| Риск | Снижение |
|---|---|
| Триггер Василисы (два условия, «что раньше») расходится с порядком событий ядра | Оба условия — триггеры Этапа 2 с `once` и общим флагом `vasilisa_joined`; тесты обоих путей и гонки «тик и пересечение в одном ходу» (`prologue-m4-rules.test.ts`) |
| Воскрешение ломает подсчёт условия победы | Условие победы считается по живым в момент проверки; тест: воскрешённый упырь должен умереть повторно до победы (`prologue-resurrect-limit.test.ts`) |
| Туман войны с М3 мешает скриптовым панам камеры | Режиссёр камеры умеет «сценарный показ»; проверка в демо-сцене |
| Баланс М4 чрезмерен до входа Василисы | Числа проектные и вынесены в JSON5; телеметрия `death_by{cause}` для калибровки |
| Соблазн «дотащить» системы М5–М8 сверх границ итерации | Вне итерации явно: сервис подкреплений уже готов Этапом 2 и контентно не подключается |

---

## 9. Что не входит в Этап 4 (явные границы)

По `doc/roadmap.md` §3.1 и «Допущениям» из `task.md`, в Этап 4 **не входят**:

- Миссии М5–М8 и экраны «Палуба №1»/«Палуба №2»
- Рекрут Сенька, усталость, выдача трав
- Слизень в миссиях (задел данных есть, но не используется)
- Идол-цель, подкрепления по порогу в М6–М8
- Цели-объекты (`destroy`, `recon`-с-целью)
- Переход в открытую кампанию (Этап 5)

Эти системы и контент реализуются в следующих итерациях. Этап 4 закрывает цепочку М1–М4 и готовит точку перехода для Этапа 5.