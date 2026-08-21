import type { EntityState } from "@bylina/core";

/**
 * Возвращает сущность, с которой должен взаимодействовать щелчок по клетке.
 * Живой юнит всегда приоритетнее среды. Проходимая клетка не выбирает
 * граневое укрытие: такой щелчок зарезервирован за перемещением.
 */
export function interactiveEntityAt(
  entities: readonly EntityState[],
  x: number,
  y: number,
  reachable: boolean,
): EntityState | undefined {
  const unit = entities.find(
    (entity) => !entity.dead && entity.coverType === 0 && entity.x === x && entity.y === y,
  );
  if (unit) return unit;
  if (reachable) return undefined;
  return entities.find(
    (entity) => !entity.dead && entity.coverType > 0 && entity.x === x && entity.y === y,
  );
}

/**
 * В режиме перемещения щелчок по врагу автоматически включает основное
 * оружие выбранного бойца и переводит врага в предварительную цель.
 */
export function primaryAttackForEnemy(
  selected: EntityState | undefined,
  target: EntityState | undefined,
  playerOwner: number,
  targeting: boolean,
): { type: "weapon"; id: string } | null {
  if (
    targeting ||
    !selected ||
    selected.dead ||
    !target ||
    target.dead ||
    target.coverType > 0 ||
    target.owner <= 0 ||
    target.owner === playerOwner
  ) return null;
  const weaponId = selected.weaponId || selected.weaponIds?.[0];
  return weaponId ? { type: "weapon", id: weaponId } : null;
}
