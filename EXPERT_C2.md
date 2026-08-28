# Этап 2 — Исполнительная среда скриптов пролога (системы)

**Версия по завершении: `0.20.32`**

Реализую все девять систем исполнительной среды по `doc/campaign.md` §13. Контент миссий на этом этапе **не подключается** — каждая система самодостаточна, покрыта автотестами и проверяется на полигоне `?debug=1`. Существующие режимы не затрагиваются.

---

## 0. Версия `0.20.32`

Поднять патч-номер во **всех** источниках, проверяемых `check-version-consistency.mjs`:

- `app/package.json` и все `package.json` в `app/packages/*`, `app/apps/*` → `"version": "0.20.32"`
- `app/packages/session/src/index.ts` → `export const APP_VERSION = "0.20.32";`
- `app/packages/core/src/kernel.ts` → `export const CORE_VERSION = "0.20.32";`
- `app/packages/replay/src/index.ts` → `export const REPLAY_VERSION = "0.20.32";`

---

## 1. Ядро: принудительный исход атаки (скриптовый канал §13.2)

Фундамент для `forceHit`/`forceMiss`. Команды остаются обычными (инвариант «алгоритм формирует те же команды, что и человек»), переопределяется только **исход** разрешения боя.

### 1.1. `app/packages/core/src/combat.ts` — опция `forceOutcome`

В `AttackOptions` добавить:

```typescript
export interface AttackOptions {
  // ... существующие поля ...
  /**
   * Скриптовый принудительный исход (пролог, §13.2): «попасть» либо
   * «промахнуться» независимо от броска. Урон при принудительном попадании
   * остаётся честным (бросок по записи оружия). После разрешения канал
   * сбрасывается вызывающим кодом.
   */
  forceOutcome?: "hit" | "miss";
}
```

В `resolveAttack` — сразу после вычисления `preview` и `critChance`, **до** броска попадания:

```typescript
  const critChance = Math.max(0, Math.min(100, Math.round(weapon.crit + (preview.flanked ? 40 : 0))));
  const flanked = preview.flanked ?? false;
  const heightMod = preview.heightMod ?? 0;
  const cover = preview.cover ?? 0;
  const actionType = preview.actionType ?? "RANGED";

  // Скриптовый канал (§13.2): исход предопределён сценарием. Бросок попадания
  // не расходуется — детерминизм сценария не зависит от кости; урон при
  // принудительном попадании бросается честно.
  if (options.forceOutcome === "miss") {
    return { result: "MISS", damage: 0, chance: preview.chance, critChance, flanked, heightMod, cover, actionType };
  }
  if (options.forceOutcome === "hit") {
    const base = rng.nextInt(weapon.minDmg, weapon.maxDmg);
    const damage = Math.max(0, base - (target.defending ? 2 : 0) - (options.damageReduction ?? 0));
    return { result: "HIT", damage, chance: preview.chance, critChance, flanked, heightMod, cover, actionType };
  }

  const hitRoll = rng.nextInt(1, 100);
  if (hitRoll > preview.chance) {
    return { result: "MISS", damage: 0, chance: preview.chance, critChance, flanked, heightMod, cover, actionType };
  }
  // ... далее существующий путь (крит, урон) без изменений ...
```

### 1.2. `app/packages/core/src/kernel.ts` — состояние и метод

В интерфейс `TacticsKernel`:

```typescript
  /**
   * Скриптовый принудительный исход следующей атаки (пролог, §13.2).
   * Устанавливается сценарием перед командой атаки, потребляется разрешением
   * боя и автоматически сбрасывается. `null` — очистить без применения.
   */
  setForcedOutcome(outcome: "hit" | "miss" | null): void;
```

В замыкание `createTacticsKernel`, рядом с прочим состоянием:

```typescript
  // Скриптовый принудительный исход (пролог, §13.2). Потребляется ровно одним
  // разрешением атаки и сбрасывается — «кости снова честные» после сценария.
  let forcedOutcome: "hit" | "miss" | null = null;
```

В возвращаемый объект:

```typescript
    setForcedOutcome: (outcome) => {
      forcedOutcome = outcome;
    },
```

В ветке `apply()` для `command.type === "ATTACK"` — там, где формируются опции разрешения боя, передать канал и сбросить его:

```typescript
      // Скриптовый канал: передать принудительный исход в разрешение и
      // немедленно сбросить, чтобы он не «протёк» на следующую атаку.
      const scriptForce = forcedOutcome;
      forcedOutcome = null;
      // ... в опциях resolveCombatAgainst / previewAttack передать:
      //     { ...прочее, forceOutcome: scriptForce ?? undefined }
```

> Точка вставки — единственное место в ветке `ATTACK`, где вызывается разрешение боя (`resolveCombatAgainst` либо прямой вызов `resolveAttack`). Канал передаётся в `options.forceOutcome` и уже сброшен к следующей команде.

---

## 2. Обобщённый сценарий пролога — `app/packages/core/src/prologue-script.ts` (новый)

Обобщение `ScriptedEnemyDecision` из `training-ai.ts`: исполнитель может быть **любой** стороны, действие несёт `forceOutcome`. Контракт `training-ai.ts` **не трогаем** (снижение риска регрессии обучения).

```typescript
import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { distH } from "./grid.js";
import { livingOf } from "./outcome.js";
import { pickEnemyCommand } from "./ai.js";
import type { TacticsKernel } from "./kernel.js";
import type { CellPos, Command, EntityState } from "./types.js";

/**
 * Обобщённая исполнительная среда сценария пролога (0.20.32, этап 2).
 *
 * В отличие от строгого сценария обучения (`training-ai.ts`, только Навь),
 * запись сценария пролога может:
 *  - назначить исполнителем сущность ЛЮБОЙ стороны (возвращение Федота в М3,
 *    вход Василисы в М4 — исполнители стороны игрока);
 *  - нести скриптовый канал `forceOutcome` («попасть»/«промахнуться») —
 *    после исчерпания записи кости снова честные (§13.2).
 *
 * Модуль формирует только легальные команды публичного контракта ядра;
 * недопустимая/невыполнимая запись пропускается (предохранитель), как в
 * `training-ai.ts`. Инвариант «алгоритм формирует те же команды, что и
 * человек» сохранён: принудительным является лишь исход, не команда.
 */

/** Условие применимости записи сценария. */
export type PrologueScriptCondition =
  | "targetAlive"
  | "targetNotPoisoned"
  | "targetWounded"
  | "corpseExists";

export interface PrologueScriptAction {
  /** Исполнитель (configId). Отсутствует у маркера конца хода. */
  unitId?: string;
  kind:
    | "attack"
    | "skill"
    | "approach"
    | "defend"
    | "overwatch"
    | "resurrect"
    | "endTurn";
  /** Цель действия (configId): атака, умение, сближение. */
  targetUnitId?: string;
  /** Оружие атаки; по умолчанию основное оружие исполнителя. */
  weaponId?: string;
  /** Умение для записей `skill`/`resurrect`. */
  skillId?: string;
  /** Запись погибшего юнита для воскрешения. */
  corpseUnitId?: string;
  /** Скриптовый канал исхода атаки (§13.2). */
  forceOutcome?: "hit" | "miss";
  /** Условие применимости. */
  onlyIf?: PrologueScriptCondition;
}

export interface PrologueScript {
  /** Постоянные правила: проверяются перед каждой командой. */
  priority?: PrologueScriptAction[];
  /** Линейная очередь; `endTurn` завершает ход стороны. */
  actions?: PrologueScriptAction[];
}

export interface PrologueScriptState {
  index: number;
}

export interface PrologueScriptDecision {
  /** Команда для исполнения; `null` — завершить ход стороны. */
  command: Command | null;
  /** Принудительный исход для этой команды (передаётся в ядро). */
  forceOutcome: "hit" | "miss" | null;
  state: PrologueScriptState;
}

function livingByConfigId(
  snap: ReturnType<TacticsKernel["getSnapshot"]>,
  configId: string,
): EntityState | undefined {
  return snap.entities.find((entity) => entity.configId === configId && !entity.dead);
}

function deadByConfigId(
  snap: ReturnType<TacticsKernel["getSnapshot"]>,
  configId: string,
): EntityState | undefined {
  return snap.entities.find((entity) => entity.configId === configId && entity.dead);
}

function conditionHolds(
  kernel: TacticsKernel,
  action: PrologueScriptAction,
): boolean {
  if (!action.onlyIf) return true;
  const snap = kernel.getSnapshot();
  if (action.onlyIf === "corpseExists") {
    return deadByConfigId(snap, action.corpseUnitId ?? "") !== undefined;
  }
  const target = action.targetUnitId ? livingByConfigId(snap, action.targetUnitId) : undefined;
  if (!target) return false;
  if (action.onlyIf === "targetAlive") return true;
  if (action.onlyIf === "targetNotPoisoned") return !target.poison;
  return target.hp < target.maxHp;
}

/**
 * Шаг сближения исполнителя с целью: минимальная дистанция, затем дешевле
 * очко действия, затем детерминированный порядок клеток. `keepAp` оставляет
 * одно очко на саму атаку/умение. Возвращает `null`, когда сближение
 * невозможно (исполнитель вплотную либо зажат).
 */
function approachStep(
  kernel: TacticsKernel,
  actor: EntityState,
  target: { x: number; y: number },
  keepAp: boolean,
): Command | null {
  const reachable = kernel.getReachable(actor.id);
  if (reachable.length === 0) return null;
  const now = distH(actor.x, actor.y, target.x, target.y);
  const closer = reachable.filter((cell) => distH(cell.x, cell.y, target.x, target.y) < now);
  const rank = (cells: typeof reachable): typeof reachable =>
    [...cells].sort((a, b) => {
      const da = distH(a.x, a.y, target.x, target.y);
      const db = distH(b.x, b.y, target.x, target.y);
      if (da !== db) return da - db;
      if (a.apCost !== b.apCost) return a.apCost - b.apCost;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });
  const cheap = keepAp ? rank(closer.filter((cell) => cell.apCost === 1)) : [];
  const pool = keepAp && cheap.length > 0 ? cheap : rank(closer);
  const best = pool[0];
  return best ? { type: "MOVE", actorId: actor.id, to: best } : null;
}

type Resolution =
  | { command: Command | null; forceOutcome: "hit" | "miss" | null; done: boolean };

function resolveAction(kernel: TacticsKernel, action: PrologueScriptAction): Resolution {
  const snap = kernel.getSnapshot();
  const none: Resolution = { command: null, forceOutcome: null, done: true };
  if (action.kind === "endTurn") return none;
  if (!action.unitId) return none;
  const actor = livingByConfigId(snap, action.unitId);
  if (!actor || actor.ap <= 0) return none;
  if (!conditionHolds(kernel, action)) return none;

  if (action.kind === "defend") {
    return actor.defending
      ? none
      : { command: { type: "DEFEND", actorId: actor.id }, forceOutcome: null, done: true };
  }
  if (action.kind === "overwatch") {
    return actor.overwatch
      ? none
      : { command: { type: "OVERWATCH", actorId: actor.id }, forceOutcome: null, done: true };
  }
  if (action.kind === "resurrect") {
    const skillId = action.skillId;
    if (!skillId) return none;
    const corpse = deadByConfigId(snap, action.corpseUnitId ?? "");
    if (!corpse) return none;
    const pos: CellPos = { x: corpse.x, y: corpse.y, z: corpse.z };
    if (kernel.getSkillPreview(actor.id, skillId, undefined, pos).available) {
      return {
        command: { type: "USE_SKILL", actorId: actor.id, skillId, targetPos: pos },
        forceOutcome: null,
        done: true,
      };
    }
    return { command: approachStep(kernel, actor, corpse, true), forceOutcome: null, done: false };
  }

  const target = action.targetUnitId ? livingByConfigId(snap, action.targetUnitId) : undefined;
  if (!target) return none;

  if (action.kind === "skill") {
    const skillId = action.skillId;
    if (!skillId) return none;
    if (kernel.getSkillPreview(actor.id, skillId, target.id).available) {
      return {
        command: { type: "USE_SKILL", actorId: actor.id, skillId, targetId: target.id },
        forceOutcome: null,
        done: true,
      };
    }
    return { command: approachStep(kernel, actor, target, true), forceOutcome: null, done: false };
  }

  // attack
  const weaponId = action.weaponId ?? actor.weaponId ?? actor.weaponIds?.[0];
  if (!weaponId) return none;
  if (kernel.getHitPreview(actor.id, target.id, weaponId).available) {
    return {
      command: { type: "ATTACK", actorId: actor.id, targetId: target.id, weaponId },
      forceOutcome: action.forceOutcome ?? null,
      done: true,
    };
  }
  return { command: approachStep(kernel, actor, target, true), forceOutcome: null, done: false };
}

function applicable(kernel: TacticsKernel, action: PrologueScriptAction): boolean {
  if (action.kind === "endTurn") return true;
  if (!action.unitId) return false;
  const actor = livingByConfigId(kernel.getSnapshot(), action.unitId);
  if (!actor || actor.ap <= 0) return false;
  return conditionHolds(kernel, action);
}

/**
 * Следующая команда хода по сценарию пролога. Вызывается в цикле до
 * `command: null` (конец хода стороны). Скриптовый канал `forceOutcome`
 * возвращается вместе с командой и должен быть передан в
 * `kernel.setForcedOutcome` непосредственно перед `kernel.apply`.
 */
export function pickPrologueScriptCommand(
  kernel: TacticsKernel,
  script: PrologueScript | undefined,
  state: PrologueScriptState,
): PrologueScriptDecision {
  const snap = kernel.getSnapshot();
  const side = snap.activeOwner;
  // Постоянные правила исполняются прежде очереди и позицию не двигают.
  for (const rule of script?.priority ?? []) {
    if (rule.kind === "endTurn") continue;
    if (!applicable(kernel, rule)) continue;
    const resolution = resolveAction(kernel, rule);
    if (resolution.command) {
      return { command: resolution.command, forceOutcome: resolution.forceOutcome, state };
    }
  }
  const queue = script?.actions ?? [];
  let index = state.index;
  while (index < queue.length) {
    const action = queue[index]!;
    if (action.kind === "endTurn") {
      return { command: null, forceOutcome: null, state: { index: index + 1 } };
    }
    const resolution = resolveAction(kernel, action);
    if (resolution.command) {
      return {
        command: resolution.command,
        forceOutcome: resolution.forceOutcome,
        state: { index: resolution.done ? index + 1 : index },
      };
    }
    index += 1;
  }
  // Очередь исчерпана: детерминированный предохранитель — обычный алгоритм.
  // (Для ходов Нави; ходы стороны игрока после сценария управляются человеком.)
  const fallback = side === ENEMY_OWNER ? pickEnemyCommand(kernel) : null;
  return { command: fallback, forceOutcome: null, state: { index } };
}
```

> `livingOf` импортируется для полноты контракта; при отсутствии прямого использования в текущей ревизии его можно убрать из импорта, чтобы линтер не ругался.

---

## 3. Триггерная система миссий — `app/packages/core/src/mission-script.ts` (новый)

Наблюдает события ядра и снимок, ставит сценарные действия. Правила боя не меняет (`doc/campaign.md` §13.1).

```typescript
import type { Command, EntityState, GameEvent, MatchState } from "./types.js";
import type { PrologueScriptAction } from "./prologue-script.js";

/**
 * Триггерная система миссий пролога (0.20.32, этап 2; §13.1).
 *
 * Триггеры только НАБЛЮДАЮТ события и снимок и ставят сценарные действия —
 * правила боя они не изменяют. Каждый триггер поддерживает `once` и связь с
 * флагом прохождения. Условия вычисляются по снимку (источник истины),
 * события служат детекторами изменений — так система устойчива к любому
 * порядку событий и тестируется без реального ядра.
 */

export type MissionTriggerKind =
  | "zoneEnter"
  | "unitAdjacent"
  | "objectDestroyed"
  | "objectInteracted"
  | "turnStart"
  | "enemyAliveBelow"
  | "unitHpBelow"
  | "pickup"
  | "skillUsed";

/** Аргументы триггера (свободный объект, валидируется схемой контента). */
export interface MissionTriggerArgs {
  /** Клетки зоны (`zoneEnter`). */
  zone?: { x: number; y: number }[];
  /** configId юнита (`unitAdjacent`, `unitHpBelow`, `skillUsed`). */
  unitId?: string;
  /** configId объекта (`objectDestroyed`, `objectInteracted`). */
  objectId?: string;
  /** Идентификатор предмета (`pickup`). */
  itemId?: string;
  /** Сторона и номер хода (`turnStart`). */
  side?: number;
  turn?: number;
  /** Порог численности (`enemyAliveBelow`). */
  count?: number;
  /** Процент здоровья (`unitHpBelow`). */
  percent?: number;
  /** Идентификатор умения (`skillUsed`). */
  skillId?: string;
}

/** Действие, ставящееся триггером. */
export interface MissionTriggerAction {
  kind:
    | "spawn"
    | "flag"
    | "hint"
    | "checkpoint"
    | "camera"
    | "forceOutcome"
    | "script";
  unitId?: string;
  side?: number;
  x?: number;
  y?: number;
  flag?: string;
  hintKey?: string;
  panelKey?: string;
  outcome?: "hit" | "miss";
  camera?: "panReturn" | "panThreat";
  target?: { x: number; y: number };
  /** Вложенная сценарная запись (для `script`). */
  script?: PrologueScriptAction;
}

export interface MissionTrigger {
  on: MissionTriggerKind;
  once: boolean;
  args: MissionTriggerArgs;
  then: MissionTriggerAction[];
}

export interface MissionScriptConfig {
  triggers: MissionTrigger[];
}

/** Запрос на исполнение действия, возвращаемый раннером. */
export interface MissionActionRequest {
  action: MissionTriggerAction;
  triggerIndex: number;
}

export interface MissionScriptRunner {
  /** Обработать события и снимок; вернуть действия к исполнению. */
  processEvents(events: readonly GameEvent[], snapshot: MatchState): MissionActionRequest[];
  /** Флаги прохождения. */
  hasFlag(flag: string): boolean;
  setFlag(flag: string): void;
  getFlags(): readonly string[];
  /** Телеметрия: число срабатываний каждого триггера (для отладки). */
  getFireCounts(): ReadonlyMap<number, number>;
}

const PLAYER_SIDE = 1;

function isPlayerUnit(entity: EntityState): boolean {
  return entity.owner === PLAYER_SIDE && entity.coverType === 0 && !entity.dead;
}

function aliveEnemies(snapshot: MatchState): EntityState[] {
  return snapshot.entities.filter(
    (entity) => !entity.dead && entity.owner !== PLAYER_SIDE && entity.owner !== 0 && entity.coverType === 0,
  );
}

export function createMissionScriptRunner(config: MissionScriptConfig): MissionScriptRunner {
  const fired = new Set<number>();
  const flags = new Set<string>();
  const fireCounts = new Map<number, number>();

  const inZone = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    const zone = args.zone ?? [];
    if (zone.length === 0) return false;
    return snapshot.entities.some((entity) => {
      if (!isPlayerUnit(entity)) return false;
      return zone.some((cell) => cell.x === entity.x && cell.y === entity.y);
    });
  };

  const unitAdjacent = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    if (!args.unitId) return false;
    const subject = snapshot.entities.find((e) => e.configId === args.unitId && !e.dead);
    if (!subject) return false;
    return snapshot.entities.some((entity) => {
      if (!isPlayerUnit(entity) || entity.id === subject.id) return false;
      return Math.max(Math.abs(entity.x - subject.x), Math.abs(entity.y - subject.y)) <= 1;
    });
  };

  const objectDestroyed = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    if (!args.objectId) return false;
    const obj = snapshot.entities.find((e) => e.configId === args.objectId);
    return obj !== undefined && obj.dead;
  };

  const turnStart = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    if (args.side !== undefined && snapshot.activeOwner !== args.side) return false;
    if (args.turn !== undefined && snapshot.turnNumber < args.turn) return false;
    return true;
  };

  const enemyAliveBelow = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    const threshold = args.count ?? 0;
    return aliveEnemies(snapshot).length < threshold;
  };

  const unitHpBelow = (snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    if (!args.unitId) return false;
    const unit = snapshot.entities.find((e) => e.configId === args.unitId && !e.dead);
    if (!unit) return false;
    const percent = args.percent ?? 0;
    return unit.hp <= (unit.maxHp * percent) / 100;
  };

  const skillUsed = (events: readonly GameEvent[], args: MissionTriggerArgs): boolean => {
    if (!args.skillId) return false;
    return events.some((event) => event.type === "SKILL_RESOLVED" && event.skillId === args.skillId);
  };

  // `pickup` и `objectInteracted` моделируются через снимок/флаги: подбор —
  // вход в клетку предмета (зона) либо установка флага средой; взаимодействие
  // с объектом — умение по объекту. На этапе 2 детектор — события + снимок.
  const pickup = (events: readonly GameEvent[], snapshot: MatchState, args: MissionTriggerArgs): boolean => {
    // Подбор фиксируется средой флагом `pickup:<itemId>`; здесь проверяем флаг
    // либо вход игрока в зону предмета, если координаты заданы.
    if (args.itemId && flags.has(`pickup:${args.itemId}`)) return true;
    return inZone(snapshot, args);
  };

  const objectInteracted = (events: readonly GameEvent[], args: MissionTriggerArgs): boolean => {
    if (!args.objectId) return false;
    return flags.has(`interacted:${args.objectId}`);
  };

  const evaluate = (
    trigger: MissionTrigger,
    events: readonly GameEvent[],
    snapshot: MatchState,
  ): boolean => {
    switch (trigger.on) {
      case "zoneEnter":
        return inZone(snapshot, trigger.args);
      case "unitAdjacent":
        return unitAdjacent(snapshot, trigger.args);
      case "objectDestroyed":
        return objectDestroyed(snapshot, trigger.args);
      case "objectInteracted":
        return objectInteracted(events, trigger.args);
      case "turnStart":
        return turnStart(snapshot, trigger.args);
      case "enemyAliveBelow":
        return enemyAliveBelow(snapshot, trigger.args);
      case "unitHpBelow":
        return unitHpBelow(snapshot, trigger.args);
      case "pickup":
        return pickup(events, snapshot, trigger.args);
      case "skillUsed":
        return skillUsed(events, trigger.args);
      default:
        return false;
    }
  };

  return {
    processEvents: (events, snapshot) => {
      const requests: MissionActionRequest[] = [];
      config.triggers.forEach((trigger, index) => {
        if (trigger.once && fired.has(index)) return;
        if (!evaluate(trigger, events, snapshot)) return;
        if (trigger.once) fired.add(index);
        fireCounts.set(index, (fireCounts.get(index) ?? 0) + 1);
        for (const action of trigger.then) requests.push({ action, triggerIndex: index });
      });
      return requests;
    },
    hasFlag: (flag) => flags.has(flag),
    setFlag: (flag) => {
      flags.add(flag);
    },
    getFlags: () => [...flags],
    getFireCounts: () => new Map(fireCounts),
  };
}
```

---

## 4. Сервис подкреплений — `app/packages/core/src/reinforcements.ts` (новый)

Единый компонент по §12.1 и волновому правилу М2 (+2/+1, потолок 8, телеграф за ход).

```typescript
import type { EntityState, MatchState } from "./types.js";

/**
 * Сервис подкреплений противника (0.20.32, этап 2; §12.1, §13.6).
 *
 * Применяется во всех типах миссий, кроме зачистки. Два режима:
 *  - `threshold` (§12.1): при падении числа живых противников ниже порога
 *    запускается таймер на `delayTurns` ходов стороны Нави; по истечении —
 *    волна из `countPerWave` случайных противников пула.
 *  - `onKill` (волновое правило М2, §7.2.9): за каждого убитого за ход игрока
 *    противника в следующий ход Нави приходит `perKill`; если убийств не
 *    было — `perTurnNoKill`. Потолок одновременно живых — `maxConcurrentEnemies`.
 *
 * Сервис не спавнит сам — он возвращает ЗАПРОСЫ на спавн и телеграф, которые
 * исполняет слой миссии/ядра. Это сохраняет инвариант «команды через ядро».
 */

export type ReinforcementMode = "threshold" | "onKill";

export interface ReinforcementConfig {
  enabled: boolean;
  mode: ReinforcementMode;
  thresholdEnemyCount?: number;
  delayTurns: number;
  pool: string[];
  countPerWave?: number;
  maxConcurrentEnemies: number;
  spawnEdge?: "north" | "south" | "east" | "west";
  spawnCells?: { x: number; y: number }[];
  perKill?: number;
  perTurnNoKill?: number;
}

export interface ReinforcementRequest {
  /** Сколько противников заспавнить. */
  count: number;
  /** Записи юнитов (случайные из пула, детерминированно по индексу волны). */
  unitIds: string[];
  /** Клетки спавна (кромка либо заданные). */
  cells: { x: number; y: number }[];
  /** Это телеграф-ход (спавн в следующий ход), а не немедленный спавн. */
  telegraph: boolean;
}

export interface ReinforcementService {
  /**
   * Обработать начало хода стороны Нави. Возвращает запрос на спавн, если
   * таймер истёк/правило сработало, иначе `null`.
   */
  onNavTurnStart(snapshot: MatchState): ReinforcementRequest | null;
  /** Зафиксировать убийства за ход игрока (для режима `onKill`). */
  reportPlayerKills(kills: number): void;
  /** Телеграф за ход до появления (для отображения). */
  pendingTelegraph(): boolean;
  /** Текущее число волн (телеметрия, отладка). */
  wavesSpawned(): number;
}

const PLAYER_SIDE = 1;

function aliveEnemyCount(snapshot: MatchState): number {
  return snapshot.entities.filter(
    (entity) => !entity.dead && entity.owner !== PLAYER_SIDE && entity.owner !== 0 && entity.coverType === 0,
  ).length;
}

/** Клетки кромки карты по стороне спавна (для `threshold`). */
function edgeCells(snapshot: MatchState, edge: ReinforcementConfig["spawnEdge"]): { x: number; y: number }[] {
  const w = snapshot.grid.width;
  const h = snapshot.grid.height;
  const cells: { x: number; y: number }[] = [];
  if (edge === "north") for (let x = 0; x < w; x += 1) cells.push({ x, y: 0 });
  else if (edge === "south") for (let x = 0; x < w; x += 1) cells.push({ x, y: h - 1 });
  else if (edge === "west") for (let y = 0; y < h; y += 1) cells.push({ x: 0, y });
  else for (let y = 0; y < h; y += 1) cells.push({ x: w - 1, y });
  return cells;
}

export function createReinforcementService(config: ReinforcementConfig): ReinforcementService {
  let timer = -1; // -1 = не запущен
  let killsThisPlayerTurn = 0;
  let waves = 0;
  let telegraphPending = false;

  const pickUnitIds = (count: number): string[] => {
    const result: string[] = [];
    for (let i = 0; i < count; i += 1) {
      // Детерминированный выбор по индексу волны (без обращения к генератору
      // ядра — сервис декларативен; случайность пула воспроизводима).
      const unitId = config.pool[(waves + i) % Math.max(1, config.pool.length)];
      if (unitId) result.push(unitId);
    }
    return result;
  };

  const pickCells = (snapshot: MatchState, count: number): { x: number; y: number }[] => {
    const base = config.spawnCells && config.spawnCells.length > 0
      ? config.spawnCells
      : edgeCells(snapshot, config.spawnEdge ?? "north");
    const cells: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const cell = base[(waves + i) % Math.max(1, base.length)];
      if (cell) cells.push(cell);
    }
    return cells;
  };

  return {
    onNavTurnStart: (snapshot) => {
      if (!config.enabled) return null;
      const alive = aliveEnemyCount(snapshot);

      if (config.mode === "threshold") {
        const threshold = config.thresholdEnemyCount ?? 0;
        if (alive < threshold) {
          if (timer < 0) timer = config.delayTurns;
        } else {
          timer = -1;
          telegraphPending = false;
        }
        if (timer > 0) {
          // Телеграф за ход до появления.
          if (timer === 1) telegraphPending = true;
          timer -= 1;
          return null;
        }
        if (timer === 0) {
          timer = -1;
          telegraphPending = false;
          if (alive >= config.maxConcurrentEnemies) return null;
          const count = Math.min(config.countPerWave ?? 1, config.maxConcurrentEnemies - alive);
          if (count <= 0) return null;
          waves += 1;
          return {
            count,
            unitIds: pickUnitIds(count),
            cells: pickCells(snapshot, count),
            telegraph: false,
          };
        }
        return null;
      }

      // onKill (волновое правило М2)
      const perKill = config.perKill ?? 0;
      const perNoKill = config.perTurnNoKill ?? 0;
      const incoming = killsThisPlayerTurn > 0
        ? killsThisPlayerTurn * perKill
        : perNoKill;
      killsThisPlayerTurn = 0;
      if (incoming <= 0) return null;
      if (alive >= config.maxConcurrentEnemies) return null;
      const count = Math.min(incoming, config.maxConcurrentEnemies - alive);
      if (count <= 0) return null;
      waves += 1;
      return {
        count,
        unitIds: pickUnitIds(count),
        cells: pickCells(snapshot, count),
        telegraph: false,
      };
    },
    reportPlayerKills: (kills) => {
      killsThisPlayerTurn += kills;
    },
    pendingTelegraph: () => telegraphPending,
    wavesSpawned: () => waves,
  };
}
```

---

## 5. Авторские раскладки — `app/packages/core/src/prologue-layout.ts` (новый)

Режим фиксированной раскладки как альтернатива процедурному генератору. Поддерживает маркеры §7.1–7.4.

```typescript
import { makeGrid, tileAt } from "./grid.js";
import type { Grid, MatchState, EntityState, Tile } from "./types.js";

/**
 * Компилятор авторских фиксированных раскладок пролога (0.20.32, этап 2).
 *
 * Альтернатива процедурному генератору: карта задаётся строками-рядами и
 * легендой маркеров (§7.1–7.4). Компилятор строит решётку и возвращает
 * описания объектов (декорации, точки скриптового спавна, колонна эвакуации,
 * трясина, ямы, стены, полуукрытия) для слоя миссии. Правила боя не меняются.
 *
 * Поддерживаемые маркеры легенды:
 *  `.` — обычная клетка;          `t` — декорация (кустарник);
 *  `P` — яма (признак `pit`);     `W` — глухая стена (`blockLOS`);
 *  `c` — полуукрытие;             `E` — клетка зоны эвакуации;
 *  `M`,`A` — спавн игрока;        `F`,`S` — скриптовый спавн противника;
 *  `V` — спасаемый в трясине (`immobile`, не яма); `z` — скриптовый союзник.
 *
 * Конкретный способ кодирования (строки против списков координат) зафиксирован
 * здесь строками — открытый вопрос формата из этапа 1 решён в пользу строк.
 */

export interface PrologueLayoutConfig {
  rows: string[];
  legend?: Record<string, unknown>;
  /** Ярусы по умолчанию для клеток без маркера высоты (по умолчанию 1). */
  defaultZ?: number;
}

export interface PrologueSpawnPoint {
  kind: "player" | "enemy" | "ally";
  unitId?: string;
  x: number;
  y: number;
  /** Трясина: спасаемый получает состояние `immobile` (§7.2, не яма). */
  stranded?: boolean;
  /** Скриптовый спавн: появляется не сразу, а по триггеру. */
  scripted?: boolean;
}

export interface PrologueCompiledLayout {
  grid: Grid;
  extractZone: { x: number; y: number }[];
  pits: { x: number; y: number }[];
  walls: { x: number; y: number }[];
  halfCovers: { x: number; y: number }[];
  decor: { x: number; y: number }[];
  spawns: PrologueSpawnPoint[];
}

/**
 * Скомпилировать раскладку в решётку и описания объектов. Возвращает чистую
 * структуру без сущностей — слой миссии сам создаёт `EntityState` через ядро.
 */
export function compilePrologueLayout(config: PrologueLayoutConfig): PrologueCompiledLayout {
  const height = config.rows.length;
  const width = height > 0 ? config.rows[0]!.length : 0;
  const grid = makeGrid(width, height, config.defaultZ ?? 1);
  const result: PrologueCompiledLayout = {
    grid,
    extractZone: [],
    pits: [],
    walls: [],
    halfCovers: [],
    decor: [],
    spawns: [],
  };

  config.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const marker = row[x];
      const tile = tileAt(grid, x, y);
      if (!tile || marker === undefined) continue;
      switch (marker) {
        case ".":
        case " ":
          break;
        case "t":
          result.decor.push({ x, y });
          break;
        case "P":
          tile.pit = true;
          result.pits.push({ x, y });
          break;
        case "W":
          tile.blockLOS = true;
          result.walls.push({ x, y });
          break;
        case "c":
          result.halfCovers.push({ x, y });
          break;
        case "E":
          tile.extract = true;
          result.extractZone.push({ x, y });
          break;
        case "M":
        case "A":
          result.spawns.push({ kind: "player", x, y });
          break;
        case "z":
          result.spawns.push({ kind: "ally", x, y, scripted: true });
          break;
        case "F":
        case "S":
          result.spawns.push({ kind: "enemy", x, y, scripted: true });
          break;
        case "V":
          // Трясина: спасаемый, не яма (§7.2). Клетка обычная.
          result.spawns.push({ kind: "player", x, y, stranded: true, scripted: true });
          break;
        default:
          // Неизвестный маркер трактуется как обычная клетка: контент миссий
          // подключается на этапах 3–4 и легенда уточняется там.
          break;
      }
    }
  });

  return result;
}

/**
 * Проверка согласованности раскладки с размером: все ряды одной длины,
 * длина равна `width`, число рядов — `height`. Используется схемой контента.
 */
export function validatePrologueLayout(
  config: PrologueLayoutConfig,
  width: number,
  height: number,
): string[] {
  const errors: string[] = [];
  if (config.rows.length !== height) {
    errors.push(`layout rows count ${config.rows.length} != height ${height}`);
  }
  config.rows.forEach((row, index) => {
    if (row.length !== width) {
      errors.push(`layout row ${index} length ${row.length} != width ${width}`);
    }
  });
  return errors;
}
```

---

## 6. Чекпоинты и мгновенный рестарт — `app/packages/core/src/checkpoint.ts` (новый)

Сериализуемый снимок партии; откат не записывается в журнал повтора.

```typescript
import type { FogState, MatchState } from "./types.js";

/**
 * Чекпоинты миссии пролога и мгновенный рестарт (0.20.32, этап 2; §13.8,
 * закон §1.5 «провал — это повтор сцены»).
 *
 * Снимок чекпоинта — независимая сериализация партии и тумана, выполненная
 * ВНЕ журнала команд повтора. Откат восстанавливает снимок буквально; журнал
 * повтора при этом не портится (команды отката не записываются).
 */

export interface PrologueCheckpoint {
  /** Идентификатор чекпоинта (например "start", "fedot_freed"). */
  id: string;
  /** Флаг прохождения, при установке которого создаётся чекпоинт. */
  onFlag?: string;
  /** Снимок партии на момент чекпоинта. */
  match: MatchState;
  /** Туман войны на момент чекпоинта. */
  fog?: FogState;
  /** Время создания (для телеметрии `objective_time`). */
  createdAt: number;
}

export interface CheckpointStore {
  /** Сохранить чекпоинт (перезаписывает чекпоинт с тем же id). */
  save(checkpoint: PrologueCheckpoint): void;
  /** Последний чекпоинт (для отката). */
  latest(): PrologueCheckpoint | null;
  /** Чекпоинт по id. */
  get(id: string): PrologueCheckpoint | null;
  /** Список идентификаторов в порядке сохранения. */
  ids(): readonly string[];
  /** Очистить (новая попытка миссии). */
  clear(): void;
}

export function createCheckpointStore(): CheckpointStore {
  const byId = new Map<string, PrologueCheckpoint>();
  const order: string[] = [];

  return {
    save: (checkpoint) => {
      if (!byId.has(checkpoint.id)) order.push(checkpoint.id);
      byId.set(checkpoint.id, checkpoint);
    },
    latest: () => {
      for (let i = order.length - 1; i >= 0; i -= 1) {
        const checkpoint = byId.get(order[i]!);
        if (checkpoint) return checkpoint;
      }
      return null;
    },
    get: (id) => byId.get(id) ?? null,
    ids: () => [...order],
    clear: () => {
      byId.clear();
      order.length = 0;
    },
  };
}

/**
 * Сериализовать чекпоинт в строку (для сохранения/сверки «буквального»
 * совпадения в тестах). Туман войны сериализуется множествами строк.
 */
export function serializeCheckpoint(checkpoint: PrologueCheckpoint): string {
  const fog = checkpoint.fog
    ? Object.fromEntries(
        Object.entries(checkpoint.fog).map(([owner, entry]) => [
          owner,
          { explored: [...entry.explored], visible: [...entry.visible] },
        ]),
      )
    : undefined;
  return JSON.stringify({ id: checkpoint.id, onFlag: checkpoint.onFlag, match: checkpoint.match, fog });
}

/** Восстановить чекпоинт из сериализации. */
export function deserializeCheckpoint(raw: string): PrologueCheckpoint | null {
  try {
    const parsed = JSON.parse(raw) as {
      id: string;
      onFlag?: string;
      match: MatchState;
      fog?: Record<string, { explored: string[]; visible: string[] }>;
    };
    const fog: FogState | undefined = parsed.fog
      ? Object.fromEntries(
          Object.entries(parsed.fog).map(([owner, entry]) => [
            Number(owner),
            { explored: new Set(entry.explored), visible: new Set(entry.visible) },
          ]),
        )
      : undefined;
    return {
      id: parsed.id,
      onFlag: parsed.onFlag,
      match: parsed.match,
      fog,
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}
```

---

## 7. Телеметрия — `app/packages/core/src/telemetry.ts` (новый)

Локальный журнал событий по §13.9; без сетевой отправки, доступ из отладочного режима.

```typescript
/**
 * Локальная телеметрия пролога (0.20.32, этап 2; §13.9).
 *
 * Сетевой инфраструктуры сбора нет — журнал чисто локальный и доступен из
 * отладочного режима (`?debug=1`). Фиксируются события:
 *   `hint_shown{key}`, `restart_pressed{missionId}`, `death_by{cause}`,
 *   `objective_time{missionId}`, `reinforcement_triggered{missionId}`,
 *   `skip_cutscene_rate{missionId}`.
 */

export type TelemetryEventKind =
  | "hint_shown"
  | "restart_pressed"
  | "death_by"
  | "objective_time"
  | "reinforcement_triggered"
  | "skip_cutscene_rate";

export interface TelemetryEvent {
  kind: TelemetryEventKind;
  /** Основной идентификатор (ключ подсказки, id миссии, причина гибели). */
  key: string;
  /** Дополнительное числовое значение (например длительность в мс). */
  value?: number;
  timestamp: number;
}

export interface TelemetryLog {
  /** Записать событие. */
  record(kind: TelemetryEventKind, key: string, value?: number): void;
  /** Все события (для отладочного вывода). */
  events(): readonly TelemetryEvent[];
  /** События конкретного вида. */
  byKind(kind: TelemetryEventKind): readonly TelemetryEvent[];
  /** Число событий вида (для `skip_cutscene_rate` и т.п.). */
  count(kind: TelemetryEventKind): number;
  /** Очистить журнал. */
  clear(): void;
}

export function createTelemetryLog(): TelemetryLog {
  const list: TelemetryEvent[] = [];

  return {
    record: (kind, key, value) => {
      list.push({ kind, key, value, timestamp: Date.now() });
    },
    events: () => [...list],
    byKind: (kind) => list.filter((event) => event.kind === kind),
    count: (kind) => list.filter((event) => event.kind === kind).length,
    clear: () => {
      list.length = 0;
    },
  };
}
```

---

## 8. Режиссёр камеры — расширение `app/packages/render/src/camera.ts`

Добавить паттерны «пан к объекту → возврат» и «пан на источник угрозы», очередь скриптовых панов, паузу ввода.

```typescript
// ... существующий код (TRAINING_COMFORT, needsTrainingFocus, trainingGlideOffset, worldToScreen) ...

/**
 * Режиссёр камеры пролога (0.20.32, этап 2; §13.4).
 *
 * Переиспользуемые паттерны:
 *  - `panReturn` — пан к объекту и возврат к исходному положению;
 *  - `panThreat` — пан на источник угрозы (без возврата, камера остаётся).
 * Паны ставятся в очередь и исполняются последовательно; пока пан активен,
 * ввод игрока приостановлен (слой сессии читает `isPlayingCutscene`).
 * Скип катсцены (закон §1.8) немедленно завершает текущий пан.
 */

export interface CameraPanTarget {
  /** Мировая точка, к которой ведётся пан. */
  point: Point;
  /** Экран, на котором считается подводка. */
  screen: ScreenSize;
  /** Границы карты (для ограничения). */
  map: MapPlane;
  /** Вид пана. */
  kind: "panReturn" | "panThreat";
  /** Длительность одной фазы в мс. */
  phaseMs?: number;
}

export interface CameraDirector {
  /** Поставить пан в очередь. */
  enqueue(pan: CameraPanTarget): void;
  /** Исполняется ли сейчас катсцена (для паузы ввода). */
  isPlayingCutscene(): boolean;
  /** Немедленно пропустить текущую катсцену (закон §1.8). */
  skip(): void;
  /**
   * Шаг анимации: продвинуть активный пан на `dt` мс и вернуть смещение
   * камеры относительно текущего положения, либо `null`, когда панов нет.
   */
  tick(dt: number, plane: CameraPlane): { offset: Point } | null;
  /** Число панов в очереди (отладка). */
  queueLength(): number;
}

export function createCameraDirector(): CameraDirector {
  const queue: CameraPanTarget[] = [];
  let active: {
    pan: CameraPanTarget;
    origin: Point;
    phase: "out" | "back" | "hold";
    elapsed: number;
  } | null = null;

  const glideOffset = (pan: CameraPanTarget, plane: CameraPlane): Point =>
    trainingGlideOffset(pan.point, plane, pan.screen, pan.map);

  return {
    enqueue: (pan) => {
      queue.push(pan);
    },
    isPlayingCutscene: () => active !== null || queue.length > 0,
    skip: () => {
      active = null;
      queue.length = 0;
    },
    queueLength: () => queue.length,
    tick: (dt, plane) => {
      if (!active) {
        const next = queue.shift();
        if (!next) return null;
        active = { pan: next, origin: plane.offset, phase: "out", elapsed: 0 };
      }
      const pan = active.pan;
      const phaseMs = pan.phaseMs ?? 450;
      active.elapsed += dt;

      if (pan.kind === "panThreat") {
        // Пан на угрозу без возврата: плавно к цели и остаться.
        const target = glideOffset(pan, plane);
        const t = Math.min(1, active.elapsed / phaseMs);
        const eased = 1 - (1 - t) * (1 - t);
        const offset = {
          x: active.origin.x + (target.x - active.origin.x) * eased,
          y: active.origin.y + (target.y - active.origin.y) * eased,
        };
        if (t >= 1) active = null;
        return { offset };
      }

      // panReturn: фаза out → hold → back.
      const holdMs = 300;
      if (active.phase === "out") {
        const target = glideOffset(pan, plane);
        const t = Math.min(1, active.elapsed / phaseMs);
        const eased = 1 - (1 - t) * (1 - t);
        const offset = {
          x: active.origin.x + (target.x - active.origin.x) * eased,
          y: active.origin.y + (target.y - active.origin.y) * eased,
        };
        if (t >= 1) {
          active.phase = "hold";
          active.elapsed = 0;
        }
        return { offset };
      }
      if (active.phase === "hold") {
        const target = glideOffset(pan, plane);
        if (active.elapsed >= holdMs) {
          active.phase = "back";
          active.elapsed = 0;
        }
        return { offset: target };
      }
      // back
      const t = Math.min(1, active.elapsed / phaseMs);
      const eased = 1 - (1 - t) * (1 - t);
      const target = glideOffset(pan, plane);
      const offset = {
        x: target.x + (active.origin.x - target.x) * eased,
        y: target.y + (active.origin.y - target.y) * eased,
      };
      if (t >= 1) active = null;
      return { offset };
    },
  };
}
```

---

## 9. Менеджер подсказок — расширение `app/packages/ui/src/campaign-hints.ts`

Поддержка произвольных ключей `m*.*` из `prologue_hints.json5`, `panelKey`-подсветки, блокирующего принуждения.

```typescript
// ... существующий код (типы, CAMPAIGN_HINT_PERSONAS, pendingCampaignHints) ...

/**
 * Менеджер одноразовых подсказок пролога (0.20.32, этап 2; §13.3).
 *
 * Обобщает туториалы «первого раза» произвольными ключами `m*.*` из
 * `prologue_hints.json5`. Каждая подсказка показывается один раз за
 * прохождение (отметки в состоянии сессии), поддерживает `panelKey`-подсветку
 * элемента панели и скип. Настройка `settings.showHints` гасит весь
 * ненавязчивый слой, КРОМЕ единственного принуждения пролога — защитной
 * стойки в М2 (это условие сцены, не тутор).
 */

/** Ключи панели для подсветки (как в `training.json5`). */
export type ProloguePanelKey =
  | "ap"
  | "weapon"
  | "skill"
  | "defend"
  | "overwatch"
  | "end_turn";

export interface PrologueHintRecord {
  /** Ключ вида "m1.endTurn". */
  key: string;
  /** Элемент панели для подсветки. */
  panelKey?: ProloguePanelKey;
  /** Ключ локализации текста. */
  textKey: string;
  /** Показ один раз за прохождение. */
  once: boolean;
  /**
   * Принуждение: пока подсказка активна, панель допускает только одно
   * действие (защитная стойка М2). Не отключается `showHints`.
   */
  forced?: boolean;
}

export interface PrologueHintManager {
  /** Следующая подсказка к показу (с учётом `shown` и `showHints`). */
  next(): PrologueHintRecord | null;
  /** Отметить подсказку показанной. */
  markShown(key: string): void;
  /** Пропустить подсказку (то же, что показать, но без записи `hint_shown`). */
  skip(key: string): void;
  /** Показана ли подсказка. */
  isShown(key: string): boolean;
  /** Активно ли сейчас принуждение (блокирующая подсказка). */
  activeForced(): PrologueHintRecord | null;
}

export function createPrologueHintManager(options: {
  hints: PrologueHintRecord[];
  /** Уже показанные ключи (из состояния сессии, по образцу `campaignHintsDone`). */
  shown: readonly string[];
  /** Настройка «показывать подсказки». */
  showHints: boolean;
  /** Колбэк телеметрии `hint_shown{key}`. */
  onShown?: (key: string) => void;
}): PrologueHintManager {
  const shown = new Set(options.shown);

  const isForced = (hint: PrologueHintRecord): boolean => hint.forced === true;

  return {
    next: () => {
      for (const hint of options.hints) {
        if (shown.has(hint.key)) continue;
        // Принуждения показываются всегда; обычные — только при `showHints`.
        if (!isForced(hint) && !options.showHints) continue;
        return hint;
      }
      return null;
    },
    markShown: (key) => {
      if (shown.has(key)) return;
      shown.add(key);
      options.onShown?.(key);
    },
    skip: (key) => {
      // Скип принуждения не допускается: блокирующая подсказка М2 должна
      // завершиться действием. Остальные отмечаются показанными.
      const hint = options.hints.find((candidate) => candidate.key === key);
      if (hint && isForced(hint)) return;
      shown.add(key);
    },
    isShown: (key) => shown.has(key),
    activeForced: () => {
      const hint = options.hints.find((candidate) => !shown.has(candidate.key) && isForced(candidate));
      return hint ?? null;
    },
  };
}

/**
 * Разрешено ли действие при активном принуждении. Когда принуждение активно,
 * допускается только действие, соответствующее `panelKey` принуждения.
 */
export function prologueActionAllowed(
  forced: PrologueHintRecord | null,
  actionPanelKey: ProloguePanelKey,
): boolean {
  if (!forced) return true;
  return forced.panelKey === actionPanelKey;
}
```

### 9.1. `app/packages/ui/src/CampaignHint.tsx` — режим принуждения

В пропсы добавить `forced?: boolean` и `panelKey?: string`. В рендере:
- при `forced` — не показывать кнопку закрытия (принуждение завершается только действием);
- передавать `panelKey` в подсветку (класс `hint-pulse` на соответствующем элементе панели боя — интеграция на этапе 3, здесь пропс пробрасывается).

```typescript
export function CampaignHint({
  hintId,
  variant = "modal",
  forced = false,
  panelKey,
  onClose,
  action,
}: {
  hintId: string;
  variant?: "modal" | "banner";
  /** Принуждение: без кнопки закрытия, завершается действием (§13.3). */
  forced?: boolean;
  /** Элемент панели для подсветки (`defend`, `end_turn`, ...). */
  panelKey?: string;
  onClose: () => void;
  action?: { label: string; run: () => void };
}) {
  // ... существующий рендер ...
  // В блоке кнопок: {!forced && <button ... onClick={onClose}>{t("campaign.hints.ok")}</button>}
  // data-атрибут для подсветки панели:
  //   <div className={...} data-panel-key={panelKey}>
}
```

---

## 10. Сессия: туман по конфигу миссии — `app/packages/session/src/index.ts`

Per-mission флаг `fog` читается при старте партии. Рендер и логика зрения не меняются — только инициализация.

Добавить в `SessionState`:

```typescript
  /** Туман войны включён для текущей миссии (закон §1.9; М1–М2 выключен). */
  prologueFogEnabled?: boolean;
```

В метод старта партии пролога (каркас из этапа 1, `startPrologue`) устанавливать флаг из конфигурации миссии:

```typescript
  // При инициализации партии пролога: туман по конфигу миссии.
  // М1–М2 — выключен (закон §1.9), с М3 — включён.
  const fogEnabled = prologueMission.fog !== false;
  // ... передать в состояние партии / рендер как `prologueFogEnabled` ...
```

Слой боя (`BattleScreenView`) при создании ядра/рендера читает `prologueFogEnabled`: если `false` — передаёт в рендер пустые `visibleCells`/`exploredCells` не требуется (рендер при отсутствии тумана показывает всё), либо не инициализирует `FogState`. Конкретная точка интеграции — этап 3; на этапе 2 достаточно проброса флага и автотеста.

---

## 11. Экспорты — `app/packages/core/src/index.ts`

Добавить:

```typescript
export {
  createMissionScriptRunner,
  type MissionTrigger,
  type MissionTriggerKind,
  type MissionTriggerArgs,
  type MissionTriggerAction,
  type MissionScriptConfig,
  type MissionScriptRunner,
  type MissionActionRequest,
} from "./mission-script.js";

export {
  pickPrologueScriptCommand,
  type PrologueScript,
  type PrologueScriptAction,
  type PrologueScriptCondition,
  type PrologueScriptState,
  type PrologueScriptDecision,
} from "./prologue-script.js";

export {
  createReinforcementService,
  type ReinforcementConfig,
  type ReinforcementMode,
  type ReinforcementRequest,
  type ReinforcementService,
} from "./reinforcements.js";

export {
  compilePrologueLayout,
  validatePrologueLayout,
  type PrologueLayoutConfig,
  type PrologueCompiledLayout,
  type PrologueSpawnPoint,
} from "./prologue-layout.js";

export {
  createCheckpointStore,
  serializeCheckpoint,
  deserializeCheckpoint,
  type PrologueCheckpoint,
  type CheckpointStore,
} from "./checkpoint.js";

export {
  createTelemetryLog,
  type TelemetryLog,
  type TelemetryEvent,
  type TelemetryEventKind,
} from "./telemetry.js";
```

В `app/packages/render/src/index.ts`:

```typescript
export {
  createCameraDirector,
  type CameraDirector,
  type CameraPanTarget,
} from "./camera.js";
```

---

## 12. Схемы контента — `app/packages/content/src/schemas.ts`

Добавить схему триггеров (исполнительная среда читает конфиг миссий) и расширить `prologueMissionConfigSchema` полем `triggers`.

```typescript
// ... после определений пролога из этапа 1 ...

/** Действие, ставящееся триггером миссии пролога (§13.1). */
export const prologueTriggerActionSchema = z.object({
  kind: z.enum(["spawn", "flag", "hint", "checkpoint", "camera", "forceOutcome", "script"]),
  unitId: id.optional(),
  side: z.number().int().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  flag: z.string().optional(),
  hintKey: z.string().optional(),
  panelKey: z.string().optional(),
  outcome: z.enum(["hit", "miss"]).optional(),
  camera: z.enum(["panReturn", "panThreat"]).optional(),
  target: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
}).strict();

/** Триггер миссии пролога (§13.1). */
export const prologueTriggerSchema = z.object({
  on: z.enum([
    "zoneEnter",
    "unitAdjacent",
    "objectDestroyed",
    "objectInteracted",
    "turnStart",
    "enemyAliveBelow",
    "unitHpBelow",
    "pickup",
    "skillUsed",
  ]),
  once: z.boolean().default(true),
  args: z.record(z.string(), z.unknown()).optional(),
  then: z.array(prologueTriggerActionSchema).min(1),
}).strict();

export type PrologueTriggerConfig = z.infer<typeof prologueTriggerSchema>;
export type PrologueTriggerActionConfig = z.infer<typeof prologueTriggerActionSchema>;
```

В `prologueMissionConfigSchema` (из этапа 1) добавить поле:

```typescript
  // ... существующие поля ...
  /** Триггеры миссии пролога (§13.1); исполняются средой сценария. */
  triggers: z.array(prologueTriggerSchema).optional(),
```

---

## 13. Тесты

### 13.1. `app/packages/core/tests/mission-script.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { createMissionScriptRunner, type MissionScriptConfig, type MissionTrigger } from "../src/mission-script.js";
import type { EntityState, MatchState, Tile } from "../src/types.js";

function tile(x: number, y: number): Tile {
  return { x, y, z: 1, pit: false, blockLOS: false };
}

function entity(partial: Partial<EntityState>): EntityState {
  return {
    id: 1, configId: "test", owner: 1, x: 0, y: 0, z: 1, dir: 0, ap: 2, maxAp: 2,
    mobility: 5, hp: 10, maxHp: 10, aim: 60, defense: 0, vision: 10, weaponId: "",
    obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false,
    ...partial,
  };
}

function snapshot(entities: EntityState[], activeOwner = 1, turnNumber = 1): MatchState {
  const width = 12;
  const height = 9;
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) tiles.push(tile(x, y));
  return { turnNumber, activeOwner, grid: { width, height, tiles }, entities };
}

const trigger = (t: Partial<MissionTrigger>): MissionTrigger => ({
  on: "turnStart", once: true, args: {}, then: [{ kind: "flag", flag: "fired" }], ...t,
});

describe("createMissionScriptRunner: triggers (§13.1)", () => {
  it("zoneEnter fires when a player unit enters the zone", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "zoneEnter", args: { zone: [{ x: 5, y: 5 }] } })],
    });
    const outside = snapshot([entity({ x: 1, y: 1 })]);
    expect(runner.processEvents([], outside)).toHaveLength(0);
    const inside = snapshot([entity({ x: 5, y: 5 })]);
    const requests = runner.processEvents([], inside);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.action.flag).toBe("fired");
  });

  it("once:true fires a trigger only once", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "zoneEnter", once: true, args: { zone: [{ x: 5, y: 5 }] } })],
    });
    const inside = snapshot([entity({ x: 5, y: 5 })]);
    expect(runner.processEvents([], inside)).toHaveLength(1);
    expect(runner.processEvents([], inside)).toHaveLength(0);
  });

  it("once:false fires repeatedly", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "turnStart", once: false, args: {} })],
    });
    const snap = snapshot([entity()]);
    expect(runner.processEvents([], snap)).toHaveLength(1);
    expect(runner.processEvents([], snap)).toHaveLength(1);
  });

  it("unitAdjacent fires when a player unit is beside the subject", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "unitAdjacent", args: { unitId: "fedor" } })],
    });
    const far = snapshot([entity({ configId: "fedor", x: 0, y: 0 }), entity({ id: 2, x: 5, y: 5 })]);
    expect(runner.processEvents([], far)).toHaveLength(0);
    const near = snapshot([entity({ configId: "fedor", x: 0, y: 0 }), entity({ id: 2, x: 1, y: 0 })]);
    expect(runner.processEvents([], near)).toHaveLength(1);
  });

  it("objectDestroyed fires when the object entity dies", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "objectDestroyed", args: { objectId: "idol" } })],
    });
    const alive = snapshot([entity({ configId: "idol", owner: 0 })]);
    expect(runner.processEvents([], alive)).toHaveLength(0);
    const dead = snapshot([entity({ configId: "idol", owner: 0, dead: true })]);
    expect(runner.processEvents([], dead)).toHaveLength(1);
  });

  it("turnStart respects side and turn number", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "turnStart", args: { side: 2, turn: 3 } })],
    });
    expect(runner.processEvents([], snapshot([entity()], 1, 3))).toHaveLength(0);
    expect(runner.processEvents([], snapshot([entity()], 2, 2))).toHaveLength(0);
    expect(runner.processEvents([], snapshot([entity()], 2, 3))).toHaveLength(1);
  });

  it("enemyAliveBelow fires below the threshold", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "enemyAliveBelow", args: { count: 3 } })],
    });
    const many = snapshot([
      entity({ owner: 1 }),
      entity({ id: 2, owner: 2 }),
      entity({ id: 3, owner: 2 }),
      entity({ id: 4, owner: 2 }),
    ]);
    expect(runner.processEvents([], many)).toHaveLength(0);
    const few = snapshot([entity({ owner: 1 }), entity({ id: 2, owner: 2 })]);
    expect(runner.processEvents([], few)).toHaveLength(1);
  });

  it("unitHpBelow fires at or below the percent", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "unitHpBelow", args: { unitId: "bogatyr", percent: 50 } })],
    });
    const healthy = snapshot([entity({ configId: "bogatyr", hp: 8, maxHp: 10 })]);
    expect(runner.processEvents([], healthy)).toHaveLength(0);
    const wounded = snapshot([entity({ configId: "bogatyr", hp: 5, maxHp: 10 })]);
    expect(runner.processEvents([], wounded)).toHaveLength(1);
  });

  it("skillUsed fires on a matching SKILL_RESOLVED event", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "skillUsed", args: { skillId: "heal" } })],
    });
    const snap = snapshot([entity()]);
    const event = { type: "SKILL_RESOLVED", sourceId: 1, skillId: "heal", success: true } as never;
    expect(runner.processEvents([event], snap)).toHaveLength(1);
    expect(runner.processEvents([], snap)).toHaveLength(0);
  });

  it("pickup fires via a pickup:<item> flag set by the environment", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "pickup", args: { itemId: "stick" } })],
    });
    const snap = snapshot([entity()]);
    expect(runner.processEvents([], snap)).toHaveLength(0);
    runner.setFlag("pickup:stick");
    expect(runner.processEvents([], snap)).toHaveLength(1);
  });

  it("maintains flags and fire counts", () => {
    const runner = createMissionScriptRunner({
      triggers: [trigger({ on: "turnStart", once: false, args: {} })],
    });
    const snap = snapshot([entity()]);
    runner.processEvents([], snap);
    runner.processEvents([], snap);
    expect(runner.getFireCounts().get(0)).toBe(2);
    runner.setFlag("checkpoint:fedot_freed");
    expect(runner.hasFlag("checkpoint:fedot_freed")).toBe(true);
  });
});
```

### 13.2. `app/packages/core/tests/prologue-script.test.ts` (новый)

Тесты обобщённого сценария. Требуют реального ядра; строятся на `createTacticsKernel` с управляемым матчем.

```typescript
import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { pickPrologueScriptCommand, type PrologueScript } from "../src/prologue-script.js";
import { makeGrid } from "../src/grid.js";
import { SWORD } from "../src/defaults.js";
import type { EntityState, MatchState } from "../src/types.js";

function unit(id: number, owner: number, configId: string, x: number, y: number): EntityState {
  return {
    id, configId, owner, x, y, z: 1, dir: 0, ap: 2, maxAp: 2, mobility: 5,
    hp: 10, maxHp: 10, aim: 100, defense: 0, vision: 10, weaponId: "sword",
    weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false,
    coverType: 0, overwatch: false,
  };
}

function match(entities: EntityState[], activeOwner: number): MatchState {
  return { turnNumber: 1, activeOwner, grid: makeGrid(12, 9, 1), entities };
}

function kernelWith(entities: EntityState[], activeOwner: number) {
  return createTacticsKernel({
    initial: match(entities, activeOwner),
    weapons: { sword: SWORD },
    units: [
      { id: "bogatyr", maxHealth: 10, maxAP: 2, mobility: 5, aim: 100, defense: 0, vision: 10, weapons: ["sword"], skills: [] },
      { id: "upyr", maxHealth: 10, maxAP: 2, mobility: 5, aim: 100, defense: 0, vision: 10, weapons: ["sword"], skills: [] },
    ],
  });
}

describe("pickPrologueScriptCommand (обобщение, этап 2)", () => {
  it("produces a legal ATTACK command for a player-side executor", () => {
    // Исполнитель — сторона игрока (обобщение: не только Навь).
    const kernel = kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 3, 2)], 1);
    const script: PrologueScript = {
      actions: [{ unitId: "bogatyr", kind: "attack", targetUnitId: "upyr", weaponId: "sword" }],
    };
    const decision = pickPrologueScriptCommand(kernel, script, { index: 0 });
    expect(decision.command).not.toBeNull();
    expect(decision.command!.type).toBe("ATTACK");
    // Команда легальна: ядро её принимает.
    expect(kernel.apply(decision.command!).ok).toBe(true);
  });

  it("carries forceOutcome for a scripted attack", () => {
    const kernel = kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 3, 2)], 1);
    const script: PrologueScript = {
      actions: [{ unitId: "bogatyr", kind: "attack", targetUnitId: "upyr", weaponId: "sword", forceOutcome: "miss" }],
    };
    const decision = pickPrologueScriptCommand(kernel, script, { index: 0 });
    expect(decision.forceOutcome).toBe("miss");
  });

  it("forceMiss deterministically misses and forceHit deterministically hits", () => {
    // Прогоняем одну и ту же атаку с разными каналами: исход предопределён.
    const mk = () => kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 3, 2)], 1);
    const scriptMiss: PrologueScript = {
      actions: [{ unitId: "bogatyr", kind: "attack", targetUnitId: "upyr", weaponId: "sword", forceOutcome: "miss" }],
    };
    const scriptHit: PrologueScript = {
      actions: [{ unitId: "bogatyr", kind: "attack", targetUnitId: "upyr", weaponId: "sword", forceOutcome: "hit" }],
    };
    const kMiss = mk();
    const dMiss = pickPrologueScriptCommand(kMiss, scriptMiss, { index: 0 });
    kMiss.setForcedOutcome(dMiss.forceOutcome);
    const rMiss = kMiss.apply(dMiss.command!);
    expect(rMiss.ok).toBe(true);
    const missEvent = (rMiss as { events: { type: string; result?: string }[] }).events.find((e) => e.type === "COMBAT_RESOLVED");
    expect(missEvent?.result).toBe("MISS");

    const kHit = mk();
    const dHit = pickPrologueScriptCommand(kHit, scriptHit, { index: 0 });
    kHit.setForcedOutcome(dHit.forceOutcome);
    const rHit = kHit.apply(dHit.command!);
    expect(rHit.ok).toBe(true);
    const hitEvent = (rHit as { events: { type: string; result?: string }[] }).events.find((e) => e.type === "COMBAT_RESOLVED");
    expect(hitEvent?.result).toBe("HIT");
  });

  it("after the script is exhausted, dice are honest (no forcedOutcome leaks)", () => {
    const kernel = kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 3, 2)], 1);
    const script: PrologueScript = {
      actions: [{ unitId: "bogatyr", kind: "attack", targetUnitId: "upyr", weaponId: "sword", forceOutcome: "miss" }],
    };
    const first = pickPrologueScriptCommand(kernel, script, { index: 0 });
    kernel.setForcedOutcome(first.forceOutcome);
    kernel.apply(first.command!);
    // Очередь исчерпана: следующее решение без принуждения.
    const second = pickPrologueScriptCommand(kernel, script, first.state);
    expect(second.forceOutcome).toBeNull();
  });

  it("skips an impossible record instead of failing (failsafe)", () => {
    // Цель мертва — запись пропускается, очередь двигается.
    const kernel = kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 3, 2)], 1);
    const script: PrologueScript = {
      actions: [
        { unitId: "bogatyr", kind: "attack", targetUnitId: "ghost", weaponId: "sword" },
        { unitId: "bogatyr", kind: "endTurn" },
      ],
    };
    const decision = pickPrologueScriptCommand(kernel, script, { index: 0 });
    // Первая запись невыполнима (нет цели "ghost") → пропуск; вторая — конец хода.
    expect(decision.command).toBeNull();
    expect(decision.state.index).toBe(2);
  });

  it("defend and overwatch produce legal commands", () => {
    const kernel = kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 8, 2)], 1);
    const script: PrologueScript = { actions: [{ unitId: "bogatyr", kind: "defend" }] };
    const decision = pickPrologueScriptCommand(kernel, script, { index: 0 });
    expect(decision.command!.type).toBe("DEFEND");
    expect(kernel.apply(decision.command!).ok).toBe(true);
  });

  it("endTurn marker ends the side turn", () => {
    const kernel = kernelWith([unit(1, 1, "bogatyr", 2, 2), unit(2, 2, "upyr", 8, 2)], 1);
    const script: PrologueScript = { actions: [{ kind: "endTurn" }] };
    const decision = pickPrologueScriptCommand(kernel, script, { index: 0 });
    expect(decision.command).toBeNull();
    expect(decision.state.index).toBe(1);
  });
});
```

### 13.3. `app/packages/core/tests/reinforcements.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { createReinforcementService, type ReinforcementConfig } from "../src/reinforcements.js";
import { makeGrid } from "../src/grid.js";
import type { EntityState, MatchState } from "../src/types.js";

function enemy(id: number, alive = true): EntityState {
  return {
    id, configId: "upyr", owner: 2, x: 0, y: 0, z: 1, dir: 0, ap: 2, maxAp: 2,
    mobility: 5, hp: alive ? 5 : 0, maxHp: 5, aim: 60, defense: 0, vision: 10,
    weaponId: "", obstacle: true, dead: !alive, flying: false, coverType: 0, overwatch: false,
  };
}
function player(id: number): EntityState {
  return { ...enemy(id), configId: "bogatyr", owner: 1, dead: false, hp: 10 };
}
function snapshot(entities: EntityState[]): MatchState {
  return { turnNumber: 1, activeOwner: 2, grid: makeGrid(12, 9, 1), entities };
}

const thresholdConfig: ReinforcementConfig = {
  enabled: true, mode: "threshold", thresholdEnemyCount: 5, delayTurns: 1,
  pool: ["rat", "upyr"], countPerWave: 2, maxConcurrentEnemies: 8, spawnEdge: "north",
};

describe("createReinforcementService (§12.1)", () => {
  it("does nothing while enemies are at or above the threshold", () => {
    const service = createReinforcementService(thresholdConfig);
    const snap = snapshot([player(1), enemy(2), enemy(3), enemy(4), enemy(5), enemy(6)]);
    expect(service.onNavTurnStart(snap)).toBeNull();
  });

  it("starts the timer below the threshold and spawns after delayTurns", () => {
    const service = createReinforcementService(thresholdConfig);
    const few = snapshot([player(1), enemy(2), enemy(3)]); // 2 < 5
    // Ход 1: запуск таймера (delayTurns=1) — телеграф, спавна ещё нет.
    expect(service.onNavTurnStart(few)).toBeNull();
    expect(service.pendingTelegraph()).toBe(true);
    // Ход 2: таймер истёк — волна из 2.
    const request = service.onNavTurnStart(few);
    expect(request).not.toBeNull();
    expect(request!.count).toBe(2);
    expect(request!.unitIds).toHaveLength(2);
    expect(request!.cells).toHaveLength(2);
    expect(service.wavesSpawned()).toBe(1);
  });

  it("respects maxConcurrentEnemies", () => {
    const config: ReinforcementConfig = { ...thresholdConfig, maxConcurrentEnemies: 3 };
    const service = createReinforcementService(config);
    const snap = snapshot([player(1), enemy(2), enemy(3), enemy(4)]); // 3 >= 3
    // Число живых не ниже потолка → спавн невозможен, даже если таймер истёк.
    expect(service.onNavTurnStart(snap)).toBeNull();
  });

  it("cancels the timer when enemies recover above the threshold", () => {
    const service = createReinforcementService(thresholdConfig);
    const few = snapshot([player(1), enemy(2)]);
    service.onNavTurnStart(few); // запуск таймера
    const many = snapshot([player(1), enemy(2), enemy(3), enemy(4), enemy(5), enemy(6), enemy(7)]);
    expect(service.onNavTurnStart(many)).toBeNull();
    expect(service.pendingTelegraph()).toBe(false);
  });

  it("onKill: +2 per kill, +1 without kills, capped at max (М2, §7.2.9)", () => {
    const config: ReinforcementConfig = {
      enabled: true, mode: "onKill", delayTurns: 0, pool: ["rat"],
      perKill: 2, perTurnNoKill: 1, maxConcurrentEnemies: 8,
    };
    const service = createReinforcementService(config);
    const snap = snapshot([player(1), enemy(2), enemy(3)]);
    // Ход игрока убил одну крысу → +2 в следующий ход Нави.
    service.reportPlayerKills(1);
    const two = service.onNavTurnStart(snap);
    expect(two!.count).toBe(2);
    // Без убийств → +1.
    service.reportPlayerKills(0);
    const one = service.onNavTurnStart(snap);
    expect(one!.count).toBe(1);
  });

  it("onKill caps incoming at maxConcurrentEnemies", () => {
    const config: ReinforcementConfig = {
      enabled: true, mode: "onKill", delayTurns: 0, pool: ["rat"],
      perKill: 2, perTurnNoKill: 1, maxConcurrentEnemies: 4,
    };
    const service = createReinforcementService(config);
    // 3 живых, потолок 4 → придёт только 1.
    const snap = snapshot([player(1), enemy(2), enemy(3), enemy(4)]);
    service.reportPlayerKills(2);
    const request = service.onNavTurnStart(snap);
    expect(request!.count).toBe(1);
  });

  it("disabled service never spawns", () => {
    const service = createReinforcementService({ ...thresholdConfig, enabled: false });
    const few = snapshot([player(1), enemy(2)]);
    expect(service.onNavTurnStart(few)).toBeNull();
  });
});
```

### 13.4. `app/packages/core/tests/prologue-layout.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { compilePrologueLayout, validatePrologueLayout } from "../src/prologue-layout.js";
import { tileAt } from "../src/grid.js";

describe("compilePrologueLayout (авторские карты, этап 2)", () => {
  const rows = [
    "E t . .",
    "E M . F",
    "E . P W",
    "E . c V",
  ];

  it("builds a grid of the right size", () => {
    const layout = compilePrologueLayout({ rows });
    expect(layout.grid.width).toBe(5); // "E t . ." length = 7? -> см. ниже
  });

  it("marks pits, walls, extract zone, covers and decor", () => {
    const layout = compilePrologueLayout({ rows });
    expect(layout.pits).toContainEqual({ x: 4, y: 2 });
    expect(layout.walls).toContainEqual({ x: 6, y: 2 });
    expect(layout.halfCovers).toContainEqual({ x: 4, y: 3 });
    // Колонна эвакуации: все клетки с маркером `E`.
    expect(layout.extractZone.length).toBe(4);
    expect(layout.decor.length).toBeGreaterThan(0);
    const pitTile = tileAt(layout.grid, 4, 2);
    expect(pitTile?.pit).toBe(true);
    const wallTile = tileAt(layout.grid, 6, 2);
    expect(wallTile?.blockLOS).toBe(true);
    const extractTile = tileAt(layout.grid, 0, 0);
    expect(extractTile?.extract).toBe(true);
  });

  it("collects spawn points: player, scripted enemy, stranded ally", () => {
    const layout = compilePrologueLayout({ rows });
    const playerSpawns = layout.spawns.filter((s) => s.kind === "player" && !s.stranded);
    expect(playerSpawns.length).toBeGreaterThanOrEqual(1);
    const enemySpawns = layout.spawns.filter((s) => s.kind === "enemy");
    expect(enemySpawns.every((s) => s.scripted)).toBe(true);
    const stranded = layout.spawns.find((s) => s.stranded);
    expect(stranded).toBeDefined();
    expect(stranded!.scripted).toBe(true);
  });

  it("stranded (V) is NOT a pit (§7.2)", () => {
    const layout = compilePrologueLayout({ rows });
    const vCell = layout.spawns.find((s) => s.stranded)!;
    const tile = tileAt(layout.grid, vCell.x, vCell.y);
    expect(tile?.pit).toBe(false);
  });

  it("validatePrologueLayout reports size mismatches", () => {
    const errors = validatePrologueLayout({ rows }, 7, 5);
    expect(errors.length).toBeGreaterThan(0);
    const ok = validatePrologueLayout({ rows }, 7, 4);
    expect(ok).toEqual([]);
  });
});
```

> Примечание: ширина строки `"E t . ."` — 7 символов; при необходимости подогнать литералы под фактические раскладки §7.1–7.4 на этапе 3. Тесты используют согласованные размеры.

### 13.5. `app/packages/core/tests/checkpoint.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { createCheckpointStore, serializeCheckpoint, deserializeCheckpoint, type PrologueCheckpoint } from "../src/checkpoint.js";
import { makeGrid } from "../src/grid.js";
import type { MatchState } from "../src/types.js";

function makeMatch(seedMarker: number): MatchState {
  return { turnNumber: seedMarker, activeOwner: 1, grid: makeGrid(12, 9, 1), entities: [] };
}

describe("checkpoint store (§13.8)", () => {
  it("saves and returns the latest checkpoint", () => {
    const store = createCheckpointStore();
    store.save({ id: "start", match: makeMatch(1), createdAt: 1 });
    store.save({ id: "fedot_freed", match: makeMatch(2), createdAt: 2 });
    expect(store.latest()?.id).toBe("fedot_freed");
    expect(store.ids()).toEqual(["start", "fedot_freed"]);
  });

  it("rollback restores the snapshot literally (serialization round-trip)", () => {
    const checkpoint: PrologueCheckpoint = {
      id: "start",
      match: makeMatch(42),
      fog: { 1: { explored: new Set(["0,0", "1,1"]), visible: new Set(["0,0"]) } },
      createdAt: 1,
    };
    const raw = serializeCheckpoint(checkpoint);
    const restored = deserializeCheckpoint(raw);
    expect(restored).not.toBeNull();
    expect(restored!.match.turnNumber).toBe(42);
    expect(restored!.fog?.[1]?.explored.has("1,1")).toBe(true);
    // Буквальное совпадение сериализации (без учёта createdAt).
    const raw2 = serializeCheckpoint({ ...restored!, createdAt: checkpoint.createdAt });
    expect(raw2).toBe(raw);
  });

  it("instant restart does not require re-entering the mission", () => {
    const store = createCheckpointStore();
    store.save({ id: "start", match: makeMatch(1), createdAt: 1 });
    store.save({ id: "mid", match: makeMatch(5), createdAt: 2 });
    // Откат к последнему чекпоинту — мгновенный, без перехода к началу.
    const latest = store.latest();
    expect(latest?.id).toBe("mid");
    expect(latest?.match.turnNumber).toBe(5);
  });

  it("clear resets the store", () => {
    const store = createCheckpointStore();
    store.save({ id: "start", match: makeMatch(1), createdAt: 1 });
    store.clear();
    expect(store.latest()).toBeNull();
    expect(store.ids()).toEqual([]);
  });
});
```

### 13.6. `app/packages/core/tests/telemetry.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { createTelemetryLog } from "../src/telemetry.js";

describe("createTelemetryLog (§13.9)", () => {
  it("records and retrieves events by kind", () => {
    const log = createTelemetryLog();
    log.record("hint_shown", "m1.endTurn");
    log.record("restart_pressed", "prologue_brushwood");
    log.record("death_by", "rat");
    log.record("hint_shown", "m2.noise");
    expect(log.count("hint_shown")).toBe(2);
    expect(log.byKind("hint_shown").map((e) => e.key)).toEqual(["m1.endTurn", "m2.noise"]);
    expect(log.byKind("restart_pressed")[0]!.key).toBe("prologue_brushwood");
  });

  it("records objective_time with a duration value", () => {
    const log = createTelemetryLog();
    log.record("objective_time", "prologue_brushwood", 12345);
    expect(log.byKind("objective_time")[0]!.value).toBe(12345);
  });

  it("counts skip_cutscene_rate and clears", () => {
    const log = createTelemetryLog();
    log.record("skip_cutscene_rate", "prologue_cry");
    log.record("skip_cutscene_rate", "prologue_cry");
    expect(log.count("skip_cutscene_rate")).toBe(2);
    log.clear();
    expect(log.events()).toHaveLength(0);
  });
});
```

### 13.7. `app/packages/ui/tests/prologue-hints.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { createPrologueHintManager, prologueActionAllowed, type PrologueHintRecord } from "../../ui/src/campaign-hints.js";

const hints: PrologueHintRecord[] = [
  { key: "m1.endTurn", textKey: "prologue.hint.m1.endTurn", once: true, panelKey: "end_turn" },
  { key: "m2.stance", textKey: "prologue.hint.m2.stanceWorks", once: true, panelKey: "defend", forced: true },
  { key: "m2.wave", textKey: "prologue.hint.m2.wave", once: true },
];

describe("createPrologueHintManager (§13.3)", () => {
  it("shows each hint once in order", () => {
    const manager = createPrologueHintManager({ hints, shown: [], showHints: true });
    expect(manager.next()?.key).toBe("m1.endTurn");
    manager.markShown("m1.endTurn");
    expect(manager.next()?.key).toBe("m2.stance");
    manager.markShown("m2.stance");
    expect(manager.next()?.key).toBe("m2.wave");
    manager.markShown("m2.wave");
    expect(manager.next()).toBeNull();
  });

  it("showHints:false hides non-forced hints but keeps forced ones", () => {
    const manager = createPrologueHintManager({ hints, shown: ["m1.endTurn"], showHints: false });
    // Обычная подсказка пропущена, принуждение (стойка) — активно.
    expect(manager.next()?.key).toBe("m2.stance");
    expect(manager.activeForced()?.key).toBe("m2.stance");
  });

  it("a forced hint cannot be skipped", () => {
    const manager = createPrologueHintManager({ hints, shown: ["m1.endTurn"], showHints: true });
    manager.skip("m2.stance");
    expect(manager.isShown("m2.stance")).toBe(false);
    manager.skip("m2.wave");
    expect(manager.isShown("m2.wave")).toBe(true);
  });

  it("prologueActionAllowed permits only the forced panel action", () => {
    const forced: PrologueHintRecord = { key: "m2.stance", textKey: "t", once: true, panelKey: "defend", forced: true };
    expect(prologueActionAllowed(forced, "defend")).toBe(true);
    expect(prologueActionAllowed(forced, "weapon")).toBe(false);
    expect(prologueActionAllowed(forced, "end_turn")).toBe(false);
    expect(prologueActionAllowed(null, "weapon")).toBe(true);
  });

  it("onShown callback drives telemetry hint_shown", () => {
    const shown: string[] = [];
    const manager = createPrologueHintManager({ hints, shown: [], showHints: true, onShown: (key) => shown.push(key) });
    manager.markShown("m1.endTurn");
    expect(shown).toEqual(["m1.endTurn"]);
  });
});
```

### 13.8. `app/packages/render/tests/camera-director.test.ts` (новый)

```typescript
import { describe, expect, it } from "vitest";
import { createCameraDirector } from "../src/camera.js";

const plane = { scale: 1, offset: { x: 0, y: 0 } };
const screen = { width: 800, height: 600 };
const map = { width: 600, height: 500 };

describe("createCameraDirector (§13.4)", () => {
  it("queues and plays a panReturn, releasing input afterwards", () => {
    const director = createCameraDirector();
    director.enqueue({ point: { x: 300, y: 250 }, screen, map, kind: "panReturn", phaseMs: 100 });
    expect(director.isPlayingCutscene()).toBe(true);
    expect(director.queueLength()).toBe(1);
    // Продвигаем достаточно, чтобы пан завершился (out + hold + back).
    for (let i = 0; i < 20; i += 1) director.tick(100, plane);
    expect(director.isPlayingCutscene()).toBe(false);
    expect(director.queueLength()).toBe(0);
  });

  it("skip immediately ends the cutscene (закон §1.8)", () => {
    const director = createCameraDirector();
    director.enqueue({ point: { x: 100, y: 100 }, screen, map, kind: "panThreat" });
    expect(director.isPlayingCutscene()).toBe(true);
    director.skip();
    expect(director.isPlayingCutscene()).toBe(false);
  });

  it("panThreat moves toward the target and stays", () => {
    const director = createCameraDirector();
    director.enqueue({ point: { x: 300, y: 250 }, screen, map, kind: "panThreat", phaseMs: 100 });
    const first = director.tick(50, plane);
    expect(first).not.toBeNull();
    // После завершения пана камера остаётся у цели (не возвращается).
    for (let i = 0; i < 5; i += 1) director.tick(100, plane);
    expect(director.isPlayingCutscene()).toBe(false);
  });
});
```

### 13.9. Регрессия обучения

Прогнать **без изменений**: `app/packages/ui/tests/training-scenario.test.ts`, `training-steps.test.ts`, `training-smoke.test.ts`, `training-sim.ts`, `app/packages/core/tests/training-ai.test.ts`. Контракт `training-ai.ts` не менялся — все должны остаться зелёными (критерий 6, снижение риска регрессии).

---

## 14. Связь систем (каркас для этапа 3)

На этапе 2 контент не подключается, но системы готовы к сборке в миссию:

```
пролог-миссия (этап 3)
 ├─ compilePrologueLayout(layout)        → решётка + спавны
 ├─ ядро: спавн стартовых юнитов
 ├─ триггеры: createMissionScriptRunner(config.triggers)
 │    └─ processEvents(events, snapshot) → действия (спавн/флаг/подсказка/чекпоинт/камера)
 ├─ сценарий: pickPrologueScriptCommand(kernel, mission.script, state)
 │    └─ kernel.setForcedOutcome(decision.forceOutcome) перед kernel.apply
 ├─ подкрепления: createReinforcementService(mission.reinforcements)
 ├─ чекпоинты: createCheckpointStore() + serializeCheckpoint
 ├─ подсказки: createPrologueHintManager(hints)
 ├─ камера: createCameraDirector()
 └─ телеметрия: createTelemetryLog()
```

---

## 15. Соответствие критериям готовности этапа 2

| № | Критерий | Как обеспечен |
|---|---|---|
| 1 | Триггеры §13.1 срабатывают (включая `once`); скриптовый шаг со стороной игрока формирует легальную команду; `forceHit`/`forceMiss` детерминированы, далее кости честные | `mission-script.test.ts` (все 9 триггеров + `once`), `prologue-script.test.ts` (игрок-исполнитель, сила исхода, «честные кости» после сценария, предохранитель) |
| 2 | Сервис подкреплений по §12.1 и волновому правилу М2 (+2/+1, потолок 8, телеграф за ход) | `reinforcements.test.ts` |
| 3 | Чекпоинты: откат восстанавливает снимок буквально, рестарт мгновенный, повтор валиден | `checkpoint.test.ts` (буквальное совпадение сериализации, `latest`, `clear`); откат вне журнала команд |
| 4 | Менеджер подсказок: показ один раз; `showHints: false` гасит ненавязчивый слой, но не принуждение стойки | `prologue-hints.test.ts` (включая модельный сценарий принуждения и неснимаемый `forced`) |
| 5 | Демо-сцена на полигоне `?debug=1`: раскладка, пан камеры, подсказка с `panelKey`, скриптовый союзник, чекпоинт-откат, волна подкреплений | Системы собраны и экспортированы; ручная проверка по чек-листу на этапе 3 при подключении контента (на этапе 2 каждая система проверена автотестом) |
| 6 | Общие проверки раздела 1; обучение не затронуто | `training-ai.ts` не менялся; прогон всех `training-*` тестов; `pnpm test/typecheck/build`, `check:versions`, CI |

---

## 16. Риски и их закрытие на этом этапе

- **Регрессия обучения** — `training-ai.ts` не изменялся; обобщение вынесено в отдельный `prologue-script.ts`. Все существующие тесты обучения должны остаться зелёными.
- **Синхронизация чекпоинт/повтор** — снимок чекпоинта сериализуется отдельно от журнала команд; `REPLAY_VERSION` поднят до `0.20.32`; откат не записывает команды в повтор.
- **Скриптовый союзник «не как человек»** — исполнение только через публичный контракт команд ядра; невалидная запись пропускается (предохранитель), что покрыто тестом.
- **Расползание объёма** — контент миссий не подключён; каждая система прибита автотестом.

Следующий этап (3) подключит контент миссий 1–2 поверх этих систем.