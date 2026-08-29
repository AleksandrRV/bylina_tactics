import type { TrainingHintConfig } from "@bylina/content";
import type { CellPos, Command, EntityState, GameEvent, MatchState, ReachableCell, SkillStats } from "@bylina/core";
import { distH } from "@bylina/core";
import { hintCompletedByEvents } from "./training-progress.js";

/**
 * Строгий сценарий игрока в режиме обучения (0.20.13, game-design §3.5).
 *
 * Прежде «заморозка» шага запрещала лишь КАТЕГОРИЮ действия (например,
 * «перемещение»), поэтому игрок мог уйти в произвольную клетку, атаковать
 * любым оружием любого врага — и сценарий обучения шёл не по плану.
 * Теперь каждый шаг конфигурации предписывает ровно одно действие
 * конкретного бойца: `resolveTrainingDirective` превращает шаг в точное
 * указание (клетка/оружие/умение/цель), интерфейс не исполняет ничего иного,
 * а каждый отказ сопровождается пояснением (ui-design §4.5).
 *
 * Модуль чистый: вся зависимость от боя — узкий интерфейс `deps`, поэтому
 * логика покрыта автотестами без среды обозревателя.
 */

/** Действия игрока, различаемые блокировкой обучения. */
export type TrainingActionKind =
  | "move"
  | "dash"
  | "attack"
  | "skill"
  | "defend"
  | "overwatch"
  | "endTurn";

export interface TrainingScenarioDeps {
  /** Полный снимок ведущего (обучение всегда выполняет локальное ядро). */
  snapshot: MatchState;
  reachable(actorId: number): ReachableCell[];
  hitPreview(actorId: number, targetId: number, weaponId?: string): { available: boolean };
  skillPreview(actorId: number, skillId: string, targetId?: number, pos?: CellPos): { available: boolean };
  /** Определения умений (эффекты решают вид указания: призыв, лечение…). */
  skills: Record<string, SkillStats>;
}

export type TrainingDirective =
  | { kind: "noop" }
  | { kind: "move"; reason: "move" | "dash" | "approach"; actorId: number; actorUnitId: string; cell: CellPos }
  | { kind: "attack"; actorId: number; actorUnitId: string; targetId: number; targetUnitId: string; weaponId: string }
  | {
      kind: "skill";
      actorId: number;
      actorUnitId: string;
      skillId: string;
      targetId?: number;
      targetUnitId?: string;
      cell?: CellPos;
    }
  | { kind: "defend"; actorId: number; actorUnitId: string }
  | { kind: "overwatch"; actorId: number; actorUnitId: string }
  | { kind: "endTurn" };

export interface TrainingDirectiveView {
  directive: TrainingDirective;
  /** Маркер на поле: целевая клетка либо целевая сущность. */
  highlight: { kind: "cell" | "entity"; x: number; y: number } | null;
  /** Подсвечиваемый элемент панели (ui-design §4.5). */
  panelKey: string | null;
}

const PLAYER_OWNER = 1;

function ownFighters(snapshot: MatchState): EntityState[] {
  return snapshot.entities
    .filter(
      (entity) =>
        !entity.dead && entity.owner === PLAYER_OWNER && entity.coverType === 0 && entity.maxAp > 0,
    )
    .sort((a, b) => a.id - b.id);
}

function livingByUnitId(snapshot: MatchState, unitId: string): EntityState | undefined {
  return snapshot.entities.find((entity) => entity.configId === unitId && !entity.dead);
}

/** Боец шага: предписанный записью (только из стороны игрока — воскрешённый противник с той же записью исполнителем быть не может) либо первый боец высадки с очками действия. */
function stepActor(hint: TrainingHintConfig, snapshot: MatchState): EntityState | undefined {
  if (hint.actorUnitId) {
    return snapshot.entities.find(
      (entity) => entity.configId === hint.actorUnitId && !entity.dead && entity.owner === PLAYER_OWNER,
    );
  }
  return ownFighters(snapshot).find((entity) => entity.ap > 0);
}

/**
 * Дальняя достижимая клетка заданной цены (правило подсветки «шаг/рывок»,
 * ui-design §4.5): максимум стоимости маршрута, детерминированный
 * выбор при равенстве. Без клеток нужной цены — дальняя из любых (маркер
 * не исчезает молча, 0.20.2).
 */
function farthestCell(reachable: readonly ReachableCell[], apCost: 1 | 2): ReachableCell | null {
  const pool = reachable.filter((cell) => cell.apCost === apCost);
  const source = pool.length > 0 ? pool : [...reachable];
  return source.reduce<ReachableCell | null>(
    (best, cell) => (!best || cell.mpCost > best.mpCost ? cell : best),
    null,
  );
}

/**
 * Клетка шага «приблизьтесь»: соседняя с целью, предпочтительно дешёвая —
 * подход за 1 ОД оставляет бойцу удар в том же ходу (0.20.43: с новыми
 * правилами движения рывок съедает весь ход, поэтому цена важнее высоты).
 * Затем выше ярусом (преимущество высоты), затем детерминированный порядок.
 * Соседних нет — ближайшая достижимая к цели.
 */
function approachCell(reachable: readonly ReachableCell[], target: { x: number; y: number }): ReachableCell | null {
  const adjacent = reachable
    .filter((cell) => distH(cell.x, cell.y, target.x, target.y) === 1)
    .sort(
      (a, b) =>
        a.apCost - b.apCost ||
        a.mpCost - b.mpCost ||
        (b.z ?? 0) - (a.z ?? 0) ||
        a.y - b.y ||
        a.x - b.x,
    );
  if (adjacent.length > 0) return adjacent[0]!;
  return (
    [...reachable].sort((a, b) => {
      const da = distH(a.x, a.y, target.x, target.y);
      const db = distH(b.x, b.y, target.x, target.y);
      if (da !== db) return da - db;
      if (a.apCost !== b.apCost) return a.apCost - b.apCost;
      return a.y - b.y || a.x - b.x;
    })[0] ?? null
  );
}

/** Клетка призыва: кольцами от заклинателя в фиксированном порядке сторон. */
function summonCell(
  deps: TrainingScenarioDeps,
  actor: EntityState,
  skillId: string,
): CellPos | undefined {
  const skill = deps.skills[skillId];
  const range = skill?.range ?? 1;
  const orders: Array<[number, number]> = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
    [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1],
    [2, 2], [-2, 2], [2, -2], [-2, -2],
  ];
  const seen = new Set<string>();
  for (const [dx, dy] of orders) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) > range) continue;
    const x = actor.x + dx;
    const y = actor.y + dy;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tile = deps.snapshot.grid.tiles.find((candidate) => candidate.x === x && candidate.y === y);
    if (!tile) continue;
    const pos: CellPos = { x, y, z: tile.z };
    if (deps.skillPreview(actor.id, skillId, undefined, pos).available) return pos;
  }
  return undefined;
}

/** Раненый союзник для политики финала: ниже доля здоровья, затем номер. */
function mostWounded(fighters: readonly EntityState[]): EntityState | undefined {
  return [...fighters]
    .filter((entity) => entity.hp < entity.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id)[0];
}

/** Отравленный союзник (политика финала снимает яд очищением). */
function poisonedAlly(fighters: readonly EntityState[]): EntityState | undefined {
  return fighters.find((entity) => entity.poison);
}

function hasSkillEffect(skill: SkillStats | undefined, effectType: string): boolean {
  return Boolean(skill?.effects.some((effect) => effect.type === effectType));
}

/** Живой противник, умеющий воскрешать павших (по определениям умений). */
function resurrectorOf(deps: TrainingScenarioDeps, enemies: readonly EntityState[]): EntityState | undefined {
  for (const foe of enemies) {
    for (const skillId of foe.skillIds ?? []) {
      const skill = deps.skills[skillId];
      const spawn = skill?.effects.find((effect) => effect.type === "spawn");
      if (!spawn || spawn.spawnKind !== "resurrection") continue;
      const uses = foe.skillUses?.[skillId] ?? 0;
      if (skill?.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle) continue;
      return foe;
    }
  }
  return undefined;
}

/** Тело, которое ещё можно поднять (умение воскрешения не исчерпано). */
function raisableCorpseExists(deps: TrainingScenarioDeps, snapshot: MatchState): boolean {
  for (const entity of snapshot.entities) {
    if (!entity.dead || entity.owner === PLAYER_OWNER || entity.coverType > 0) continue;
    // Тело имеет смысл лишь при живом воскрешателе с остатком применений.
    for (const foe of snapshot.entities) {
      if (foe.dead || foe.owner === PLAYER_OWNER || foe.coverType > 0) continue;
      for (const skillId of foe.skillIds ?? []) {
        const skill = deps.skills[skillId];
        const spawn = skill?.effects.find((effect) => effect.type === "spawn");
        if (!spawn || spawn.spawnKind !== "resurrection") continue;
        if (spawn.unitId !== entity.configId) continue;
        const uses = foe.skillUses?.[skillId] ?? 0;
        if (skill?.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle) continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * Указание финального шага («добейте Навь», repeatUntil victory):
 * детерминированная политика — по одному действию за указание. Порядок
 * бойцов по номеру; очищение яда и лечение раненого прежде атаки. Цель
 * атаки — противник без воскрешения прежде самого воскрешателя (урок
 * «кикимора поднимет упыря» обязан состояться), затем слабейший.
 * «Передышка»: когда тело поднятия уже лежит, а воскрешатель жив, указание —
 * завершить ход и дать Навь показать урок воскрешения.
 */
function finaleDirective(deps: TrainingScenarioDeps): TrainingDirective {
  const snapshot = deps.snapshot;
  const fighters = ownFighters(snapshot).filter((entity) => entity.ap > 0);
  const enemies = snapshot.entities
    .filter((entity) => !entity.dead && entity.owner !== PLAYER_OWNER && entity.coverType === 0);
  const resurrector = resurrectorOf(deps, enemies);

  // Передышка: тело для воскрешения лежит, воскрешатель жив и способен —
  // урок требует хода Нави, атаковать больше нечего.
  if (resurrector && raisableCorpseExists(deps, snapshot)) {
    return { kind: "endTurn" };
  }

  const targetOrder = [...enemies].sort((a, b) => {
    const ra = a.id === resurrector?.id ? 1 : 0;
    const rb = b.id === resurrector?.id ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (a.hp !== b.hp) return a.hp - b.hp;
    return a.id - b.id;
  });

  for (const actor of fighters) {
    const poisoned = poisonedAlly(ownFighters(snapshot));
    for (const skillId of actor.skillIds ?? []) {
      const skill = deps.skills[skillId];
      if (!skill || !hasSkillEffect(skill, "removeStatus")) continue;
      if (poisoned && deps.skillPreview(actor.id, skillId, poisoned.id).available) {
        return {
          kind: "skill",
          actorId: actor.id,
          actorUnitId: actor.configId,
          skillId,
          targetId: poisoned.id,
          targetUnitId: poisoned.configId,
        };
      }
    }
    const wounded = mostWounded(ownFighters(snapshot));
    for (const skillId of actor.skillIds ?? []) {
      const skill = deps.skills[skillId];
      if (!skill || !hasSkillEffect(skill, "heal")) continue;
      if (wounded && wounded.hp * 10 <= wounded.maxHp * 6 && deps.skillPreview(actor.id, skillId, wounded.id).available) {
        return {
          kind: "skill",
          actorId: actor.id,
          actorUnitId: actor.configId,
          skillId,
          targetId: wounded.id,
          targetUnitId: wounded.configId,
        };
      }
    }
    const weaponId = actor.weaponId ?? actor.weaponIds?.[0];
    if (weaponId) {
      for (const foe of targetOrder) {
        if (deps.hitPreview(actor.id, foe.id, weaponId).available) {
          return {
            kind: "attack",
            actorId: actor.id,
            actorUnitId: actor.configId,
            targetId: foe.id,
            targetUnitId: foe.configId,
            weaponId,
          };
        }
      }
    }
  }

  // Никто не достаёт — шаг сближения ближайшим бойцом (цель — не
  // воскрешатель, пока живы прочие).
  const actor = fighters[0];
  const foe = actor
    ? [...targetOrder].sort((a, b) =>
        distH(actor.x, actor.y, a.x, a.y) - distH(actor.x, actor.y, b.x, b.y) || a.id - b.id,
      )[0]
    : undefined;
  if (actor && foe) {
    const reachable = deps.reachable(actor.id);
    const now = distH(actor.x, actor.y, foe.x, foe.y);
    const step = reachable
      .filter((cell) => distH(cell.x, cell.y, foe.x, foe.y) < now)
      .sort((a, b) => {
        const da = distH(a.x, a.y, foe.x, foe.y);
        const db = distH(b.x, b.y, foe.x, foe.y);
        if (da !== db) return da - db;
        if (a.apCost !== b.apCost) return a.apCost - b.apCost;
        return a.y - b.y || a.x - b.x;
      })[0];
    if (step) {
      return { kind: "move", reason: "approach", actorId: actor.id, actorUnitId: actor.configId, cell: step };
    }
  }
  return { kind: "endTurn" };
}

/**
 * Превращает активный шаг конфигурации в точное указание. Возвращает null,
 * когда шаг невыполним и должен быть пропущен вызывающим кодом (исполнитель
 * погиб, цель уже мертва, умение бессмысленно). Когда предписанное действие
 * невозможно из-за исчерпания очков действия, указанием становится явное
 * завершение хода — очки восстановятся, и шаг продолжится.
 */
export function resolveTrainingDirective(
  hint: TrainingHintConfig,
  deps: TrainingScenarioDeps,
): TrainingDirectiveView | null {
  const snapshot = deps.snapshot;
  const actor = stepActor(hint, snapshot);
  // Финальный шаг атаки (без исполнителя) ведёт политика — исполнитель ему
  // не нужен. end_turn и ознакомительный шаг исполнителя не требуют.
  const needsActor =
    hint.until !== "end_turn" &&
    hint.until !== "noop" &&
    !(hint.until === "attack" && hint.actorUnitId === undefined);
  if (!actor && needsActor) return null;

  const cellHighlight = (cell: CellPos): { kind: "cell"; x: number; y: number } => ({
    kind: "cell",
    x: cell.x,
    y: cell.y,
  });
  const entityHighlight = (entity: EntityState): { kind: "entity"; x: number; y: number } => ({
    kind: "entity",
    x: entity.x,
    y: entity.y,
  });
  const panel = (): string | null => (hint.panelKey ? hint.panelKey : null);

  switch (hint.until) {
    case "noop":
      return { directive: { kind: "noop" }, highlight: null, panelKey: panel() };

    case "end_turn":
      return { directive: { kind: "endTurn" }, highlight: null, panelKey: panel() };

    case "move":
    case "dash":
    case "approach": {
      if (!actor) return null;
      if (actor.ap <= 0) {
        return { directive: { kind: "endTurn" }, highlight: null, panelKey: "end_turn" };
      }
      const reachable = deps.reachable(actor.id);
      if (reachable.length === 0) return null;
      let cell: ReachableCell | null = null;
      let reason: "move" | "dash" | "approach" = hint.until === "move" ? "move" : hint.until === "dash" ? "dash" : "approach";
      if (hint.until === "approach") {
        const target = hint.targetUnitId ? livingByUnitId(snapshot, hint.targetUnitId) : undefined;
        if (!target || target.owner === PLAYER_OWNER) return null;
        // Цель уже вплотную — шаг «приблизьтесь» выполнен, пропустить.
        if (distH(actor.x, actor.y, target.x, target.y) === 1) return null;
        cell = approachCell(reachable, target);
      } else {
        cell = hint.cell
          ? (reachable.find((candidate) => candidate.x === hint.cell!.x && candidate.y === hint.cell!.y) ??
            farthestCell(reachable, hint.until === "move" ? 1 : 2))
          : farthestCell(reachable, hint.until === "move" ? 1 : 2);
      }
      if (!cell) return null;
      return {
        directive: { kind: "move", reason, actorId: actor.id, actorUnitId: actor.configId, cell },
        highlight: cellHighlight(cell),
        panelKey: null,
      };
    }

    case "attack": {
      // Финальный шаг без исполнителя ведёт политика (до победы).
      if (!hint.actorUnitId) {
        const inner = finaleDirective(deps);
        if (inner.kind === "attack") {
          const target = snapshot.entities.find((entity) => entity.id === inner.targetId);
          return { directive: inner, highlight: target ? entityHighlight(target) : null, panelKey: "weapon" };
        }
        if (inner.kind === "skill") {
          const target = inner.targetId !== undefined ? snapshot.entities.find((entity) => entity.id === inner.targetId) : undefined;
          return { directive: inner, highlight: target ? entityHighlight(target) : null, panelKey: "skill" };
        }
        if (inner.kind === "move") {
          return { directive: inner, highlight: cellHighlight(inner.cell), panelKey: null };
        }
        return { directive: inner, highlight: null, panelKey: inner.kind === "endTurn" ? "end_turn" : null };
      }
      if (!actor) return null;
      const target = hint.targetUnitId ? livingByUnitId(snapshot, hint.targetUnitId) : undefined;
      if (!target || target.owner === PLAYER_OWNER) return null;
      const weaponId = hint.weaponId ?? actor.weaponId ?? actor.weaponIds?.[0];
      if (!weaponId) return null;
      if (deps.hitPreview(actor.id, target.id, weaponId).available) {
        if (actor.ap <= 0) {
          return { directive: { kind: "endTurn" }, highlight: null, panelKey: "end_turn" };
        }
        return {
          directive: { kind: "attack", actorId: actor.id, actorUnitId: actor.configId, targetId: target.id, targetUnitId: target.configId, weaponId },
          highlight: entityHighlight(target),
          panelKey: panel() ?? "weapon",
        };
      }
      // Оружие не достаёт: указанием становится шаг к цели (сначала восстановить ОД).
      if (actor.ap <= 0) {
        return { directive: { kind: "endTurn" }, highlight: null, panelKey: "end_turn" };
      }
      const reachable = deps.reachable(actor.id);
      const cell = approachCell(reachable, target);
      if (!cell) return null;
      return {
        directive: { kind: "move", reason: "approach", actorId: actor.id, actorUnitId: actor.configId, cell },
        highlight: cellHighlight(cell),
        panelKey: null,
      };
    }

    case "skill": {
      if (!actor) return null;
      const skillId = hint.skillId ?? actor.skillIds?.[0];
      if (!skillId) return null;
      const skill = deps.skills[skillId];
      if (!skill) return null;
      const uses = actor.skillUses?.[skillId] ?? 0;
      if (skill.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle) return null;
      if ((actor.skillCooldowns?.[skillId] ?? 0) > 0) return null;
      if (actor.ap <= 0) {
        return { directive: { kind: "endTurn" }, highlight: null, panelKey: "end_turn" };
      }
      // Призыв (эффект spawn без воскрешения): указание — подсвеченная клетка.
      const spawn = skill.effects.find((effect) => effect.type === "spawn");
      if (spawn && spawn.spawnKind !== "resurrection") {
        const cell = summonCell(deps, actor, skillId);
        if (!cell) return null;
        return {
          directive: { kind: "skill", actorId: actor.id, actorUnitId: actor.configId, skillId, cell },
          highlight: cellHighlight(cell),
          panelKey: panel() ?? "skill",
        };
      }
      // Само-умения применяются без цели.
      if (skill.category === "self") {
        if (!deps.skillPreview(actor.id, skillId).available) return null;
        return {
          directive: { kind: "skill", actorId: actor.id, actorUnitId: actor.configId, skillId },
          highlight: entityHighlight(actor),
          panelKey: panel() ?? "skill",
        };
      }
      // Целевое умение: цель из записи; лечение без записи — раненый союзник.
      let target = hint.targetUnitId ? livingByUnitId(snapshot, hint.targetUnitId) : undefined;
      if (!target && hasSkillEffect(skill, "heal")) target = mostWounded(ownFighters(snapshot));
      if (!target) return null;
      if (!deps.skillPreview(actor.id, skillId, target.id).available) return null;
      return {
        directive: { kind: "skill", actorId: actor.id, actorUnitId: actor.configId, skillId, targetId: target.id, targetUnitId: target.configId },
        highlight: entityHighlight(target),
        panelKey: panel() ?? "skill",
      };
    }

    case "defend": {
      if (!actor) return null;
      if (actor.defending) return null;
      if (actor.ap <= 0) {
        return { directive: { kind: "endTurn" }, highlight: null, panelKey: "end_turn" };
      }
      return { directive: { kind: "defend", actorId: actor.id, actorUnitId: actor.configId }, highlight: entityHighlight(actor), panelKey: panel() ?? "defend" };
    }

    case "overwatch": {
      if (!actor) return null;
      if (actor.overwatch) return null;
      if (actor.ap <= 0) {
        return { directive: { kind: "endTurn" }, highlight: null, panelKey: "end_turn" };
      }
      return { directive: { kind: "overwatch", actorId: actor.id, actorUnitId: actor.configId }, highlight: entityHighlight(actor), panelKey: panel() ?? "overwatch" };
    }

    default:
      return null;
  }
}

/**
 * Допустима ли категория действия на активном указании. Точные цели
 (клетка, оружие, умение, цель) проверяет интерфейс по самому указанию.
 */
export function directiveAllowsAction(
  view: TrainingDirectiveView | null,
  action: TrainingActionKind,
): boolean {
  if (!view) return true;
  const kind = view.directive.kind;
  switch (action) {
    case "move":
    case "dash":
      return kind === "move";
    case "attack":
      return kind === "attack";
    case "skill":
      return kind === "skill";
    case "defend":
      return kind === "defend";
    case "overwatch":
      return kind === "overwatch";
    case "endTurn":
      return kind === "endTurn";
    default:
      return false;
  }
}

/**
 * Финальная проверка команды игрока в обучении (строгий сценарий, 0.20.13):
 * команда обязана в точности совпадать с активным указанием — исполнитель,
 * клетка, оружие, умение и цель. Вызывается в applyCommand поверх жестовых
 * проверок интерфейса (кнопки и клики) — единая точка правды для интерфейса
 * и автотестов. Вне обучения (указания нет) разрешено всё.
 */
export function trainingCommandAllowed(
  view: TrainingDirectiveView | null,
  command: Command,
): boolean {
  if (!view) return true;
  const d = view.directive;
  switch (command.type) {
    case "MOVE":
      return (
        d.kind === "move" &&
        d.actorId === command.actorId &&
        d.cell.x === command.to.x &&
        d.cell.y === command.to.y
      );
    case "ATTACK":
      return (
        d.kind === "attack" &&
        d.actorId === command.actorId &&
        d.targetId === command.targetId &&
        d.weaponId === command.weaponId
      );
    case "USE_SKILL": {
      if (d.kind !== "skill" || d.actorId !== command.actorId || d.skillId !== command.skillId) return false;
      if (d.cell !== undefined) {
        const pos = command.targetPos;
        return pos !== undefined && d.cell.x === pos.x && d.cell.y === pos.y;
      }
      return d.targetId === undefined ? command.targetId === undefined : d.targetId === command.targetId;
    }
    case "DEFEND":
      return d.kind === "defend" && d.actorId === command.actorId;
    case "OVERWATCH":
      return d.kind === "overwatch" && d.actorId === command.actorId;
    case "END_TURN":
      return d.kind === "endTurn";
    default:
      return false;
  }
}

/** Категория действия команды — для пояснения отклонённой команды. */
export function trainingActionKindOfCommand(command: Command): TrainingActionKind {
  switch (command.type) {
    case "MOVE":
      return "move";
    case "ATTACK":
      return "attack";
    case "USE_SKILL":
      return "skill";
    case "DEFEND":
      return "defend";
    case "OVERWATCH":
      return "overwatch";
    case "END_TURN":
      return "endTurn";
    default:
      return "move";
  }
}

/**
 * Завершение шага. Шаги с `repeatUntil` («пока цель не падёт», «до победы»)
 не завершаются единичным событием — условие проверяется по снимку. Прочие
 шаги завершаются событием действия игрока (события Нави не учитываются).
 */
export function trainingStepCompleted(
  hint: TrainingHintConfig,
  events: readonly GameEvent[],
  snapshot: MatchState,
): boolean {
  if (hint.repeatUntil === "targetDead") {
    const target = hint.targetUnitId ? snapshot.entities.find((entity) => entity.configId === hint.targetUnitId) : undefined;
    return target === undefined || target.dead;
  }
  if (hint.repeatUntil === "victory") {
    return snapshot.entities.every(
      (entity) => entity.owner === PLAYER_OWNER || entity.dead || entity.coverType > 0,
    );
  }
  return hintCompletedByEvents(hint, events);
}

/** Ключ пояснения для действия, отклонённого сценарием обучения. */
export function trainingDenialKey(view: TrainingDirectiveView | null, action: TrainingActionKind): string {
  if (!view) return "training.locked.generic";
  const kind = view.directive.kind;
  if (kind === "move" && (action === "move" || action === "dash")) return "training.locked.cell";
  if ((kind === "attack" || kind === "skill") && (action === "attack" || action === "skill")) {
    return kind === "attack" ? "training.locked.weapon" : "training.locked.skill";
  }
  if (action === "endTurn" || kind === "endTurn") return "training.locked.endTurn";
  return "training.locked.generic";
}
