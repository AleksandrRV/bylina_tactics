import type { EntityState } from "@bylina/core";

/** Ключ клетки: им помечены достижимые клетки, предпросмотр и память поля. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

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
  const unit = entities.find((entity) => !entity.dead && entity.coverType === 0 && entity.x === x && entity.y === y);
  if (unit) return unit;
  if (reachable) return undefined;
  return entities.find((entity) => !entity.dead && entity.coverType > 0 && entity.x === x && entity.y === y);
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
    target.owner === playerOwner
  )
    return null;
  // Владелец 0 — нейтральный объект миссии (идол): клик по нему включает
  // основное оружие, как по противнику.
  const weaponId = selected.weaponId || selected.weaponIds?.[0];
  return weaponId ? { type: "weapon", id: weaponId } : null;
}
