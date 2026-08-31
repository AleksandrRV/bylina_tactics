/**
 * Рывок к цели ближнего боя (0.20.50).
 *
 * Ближний бой требует соседней клетки, и прежде игрок тратил два жеста
 * вручную: сначала шаг, потом удар. Теперь, когда цель названа, а в
 * непосредственной досягаемости её нет, экран сам показывает подход:
 * маршрут до ближайшей по очкам движения клетки, откуда удар возможен,
 * и линию атаки уже оттуда. Повторное нажатие по цели исполняет оба
 * действия подряд — подход и удар.
 *
 * Правила боя здесь не переписываются: это тот же шаг и тот же удар,
 * только соединённые в один замысел. Подход стоит очков действия по
 * общим правилам, удар — по записи оружия или умения, а если после
 * подхода удар стал невозможен (дозорный выстрел, гибель, помеха),
 * экран честно сообщает об этом и останавливается.
 */

import {
  hasLineOfSight,
  inMeleeReach,
  previewAttack,
  type CellPos,
  type EntityState,
  type MatchState,
  type ReachableCell,
  type SkillStats,
  type WeaponStats,
} from "@bylina/core";
import type { SelectableAction } from "./action-shortcuts.js";

/** Удар ближнего боя: оружие или умение, бьющее одну цель вблизи. */
export interface MeleeStrike {
  kind: "weapon" | "skill";
  id: string;
  apCost: number;
  requiresLOS: boolean;
  weapon?: WeaponStats | undefined;
  skill?: SkillStats | undefined;
}

/** План рывка: куда подойти и откуда бить. */
export interface ChargePlan {
  targetId: number;
  /** Клетка подхода — с неё наносится удар. */
  step: CellPos;
  /** Маршрут от текущей клетки до клетки подхода (первая клетка — своя). */
  path: CellPos[];
  /** Очки движения, которых стоит подход. */
  mpCost: number;
  /** Очки действия, которых стоит подход (1 — шаг, 2 — рывок). */
  apCost: 1 | 2;
}

/** Умение бьёт одну цель вблизи: без области, без призыва, без переноса. */
function singleTargetMeleeSkill(skill: SkillStats): boolean {
  if (skill.category !== "melee" || (skill.radius ?? 0) > 0) return false;
  if (skill.extract) return false;
  return !skill.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");
}

/**
 * Действие как удар ближнего боя: оружие ближнего боя либо умение,
 * работающее только по одной цели вблизи. Дальнее оружие, площадные и
 * «на себя» умения рывка не получают — им подход не нужен.
 */
export function meleeStrikeOf(
  action: SelectableAction | null,
  weapons: Record<string, WeaponStats>,
  skills: Record<string, SkillStats>,
): MeleeStrike | null {
  if (!action) return null;
  if (action.type === "weapon") {
    const weapon = weapons[action.id];
    if (!weapon || weapon.category !== "melee") return null;
    return {
      kind: "weapon",
      id: action.id,
      apCost: weapon.apCost,
      requiresLOS: weapon.requiresLOS,
      weapon,
    };
  }
  const skill = skills[action.id];
  if (!skill || !singleTargetMeleeSkill(skill)) return null;
  return {
    kind: "skill",
    id: action.id,
    apCost: skill.apCost,
    requiresLOS: skill.requiresLOS,
    skill,
  };
}

/** Доступность удара с клетки: проверка без изменения состояния боя. */
function strikeAvailable(
  snapshot: MatchState,
  actor: EntityState,
  target: EntityState,
  strike: MeleeStrike,
  cell: CellPos,
): boolean {
  // Боец мыслится стоящим на клетке подхода: подменяем его в списке
  // сущностей, само ядро не трогаем. Очки действия здесь не считаются —
  // их бюджет проверяет вызывающий.
  const ghost: EntityState = { ...actor, x: cell.x, y: cell.y, z: cell.z };
  const entities = snapshot.entities.map((entity) => (entity.id === actor.id ? ghost : entity));
  if (strike.kind === "weapon" && strike.weapon) {
    return previewAttack(snapshot.grid, entities, ghost, target, strike.weapon, { ignoreAp: true }).available;
  }
  if (!inMeleeReach(ghost.x, ghost.y, ghost.z, target.x, target.y, target.z)) return false;
  if (!strike.requiresLOS) return true;
  return hasLineOfSight(snapshot.grid, ghost.x, ghost.y, ghost.z, target.x, target.y, target.z);
}

export interface ChargeOptions {
  snapshot: MatchState;
  actor: EntityState;
  target: EntityState;
  strike: MeleeStrike;
  /** Клетки, доступные бойцу за его очки действия. */
  reachable: readonly ReachableCell[];
  /** Маршрут до клетки: путь, очки движения и стоимость в очках действия. */
  pathOf: (cell: CellPos) => { path: CellPos[]; mpCost: number; apCost: 1 | 2 } | null;
}

/**
 * Клетка подхода: ближайшая к бойцу по очкам движения, с которой удар
 * достижим. Возвращает `null`, если подойти нечем — например, удар съедает
 * последнее очко действия или цель отрезана укрытиями.
 */
export function planCharge({ snapshot, actor, target, strike, reachable, pathOf }: ChargeOptions): ChargePlan | null {
  if (actor.dead || target.dead || actor.id === target.id) return null;
  // Удар уже достижим — рывок не нужен: боец бьёт с места.
  if (strikeAvailable(snapshot, actor, target, strike, { x: actor.x, y: actor.y, z: actor.z })) return null;
  // После подхода должно хватить очков на сам удар.
  const budget = actor.ap - strike.apCost;
  if (budget <= 0) return null;

  let best: ChargePlan | null = null;
  for (const cell of reachable) {
    if (cell.apCost > budget) continue;
    if (!strikeAvailable(snapshot, actor, target, strike, cell)) continue;
    const route = pathOf(cell);
    if (!route || route.path.length === 0) continue;
    const candidate: ChargePlan = {
      targetId: target.id,
      step: { x: cell.x, y: cell.y, z: cell.z },
      path: route.path,
      mpCost: route.mpCost,
      apCost: route.apCost,
    };
    // Ближе по очкам движения — дешевле по очкам действия — короче путь.
    // Порядок детерминирован: одинаковый ввод даёт одинаковую клетку.
    if (
      !best ||
      candidate.mpCost < best.mpCost ||
      (candidate.mpCost === best.mpCost && candidate.apCost < best.apCost) ||
      (candidate.mpCost === best.mpCost &&
        candidate.apCost === best.apCost &&
        candidate.path.length < best.path.length) ||
      (candidate.mpCost === best.mpCost &&
        candidate.apCost === best.apCost &&
        candidate.path.length === best.path.length &&
        (candidate.step.y < best.step.y || (candidate.step.y === best.step.y && candidate.step.x < best.step.x)))
    ) {
      best = candidate;
    }
  }
  return best;
}
