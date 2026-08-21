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
