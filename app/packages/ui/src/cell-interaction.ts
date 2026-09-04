import type { EntityState } from "@bylina/core";

/** Ключ клетки: им помечены достижимые клетки, предпросмотр и память поля. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Возвращает сущность, с которой должен взаимодействовать щелчок по клетке.
 * Живой юнит всегда приоритетнее среды. Проходимая клетка не выбирает
 * граневое укрытие: такой щелчок зарезервирован за перемещением.
 * Предмет на поле (палка М1, owner 0, maxAp 0) не считается целью атаки:
 * клик по клетке с предметом трактуется как перемещение (0.21.27).
 */
export function interactiveEntityAt(
  entities: readonly EntityState[],
  x: number,
  y: number,
  reachable: boolean,
): EntityState | undefined {
  const unit = entities.find(
    (entity) =>
      !entity.dead &&
      entity.coverType === 0 &&
      entity.x === x &&
      entity.y === y &&
      // Нейтральный предмет пролога (палка) не перехватывает клик.
      !(entity.owner === 0 && entity.maxAp === 0),
  );
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
  // Предмет на поле (палка М1) не считается целью атаки.
  if (target.owner === 0 && target.maxAp === 0) return null;
  // Владелец 0 — нейтральный объект миссии (идол): клик по нему включает
  // основное оружие, как по противнику.
  const weaponId = selected.weaponId || selected.weaponIds?.[0];
  return weaponId ? { type: "weapon", id: weaponId } : null;
}
