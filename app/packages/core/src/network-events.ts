import type { FogState } from "./fog.js";
import type { EntityState, GameEvent, MatchState } from "./types.js";

/**
 * Сокращение набора событий по зрению стороны (network-protocol.md §5):
 * ведомому не передаются события о сущностях и клетках, которые его сторона
 * не наблюдает, за исключением случаев, когда результат изменяет уже
 * известную местность (разрушение ранее наблюдавшегося укрытия).
 */
export function eventsVisibleTo(
  events: readonly GameEvent[],
  state: MatchState,
  fog: FogState,
  owner: number,
): GameEvent[] {
  const entry = fog[owner];
  if (!entry) return [...events];

  const entityVisible = (entity: EntityState | undefined): boolean => {
    if (!entity) return false;
    if (entity.owner === owner) return true;
    if (!entry.visible.has(`${entity.x},${entity.y}`)) return false;
    return !entity.hidden;
  };

  const cellKnown = (x: number, y: number): boolean =>
    entry.explored.has(`${x},${y}`) || entry.visible.has(`${x},${y}`);

  const affectedEntities = (event: GameEvent): number[] => {
    switch (event.type) {
      case "ENTITY_MOVED":
        return [event.entityId];
      case "ENTITY_DISPLACED":
        return [event.entityId];
      case "STAT_CHANGED":
        return [event.entityId];
      case "STATUS_CHANGED":
        return [event.entityId];
      case "COMBAT_RESOLVED":
        return [event.sourceId, event.targetId];
      case "SKILL_RESOLVED":
        return event.targetId !== undefined ? [event.sourceId, event.targetId] : [event.sourceId];
      case "SKILL_RESOURCE_CHANGED":
        return [event.entityId];
      case "ENTITY_SPAWNED":
        return [event.entity.id];
      case "ENTITY_DIED":
        return [event.entityId];
      case "ENTITY_REMOVED":
        return [event.entityId];
      case "OVERWATCH_FIRED":
        return [event.watcherId, event.triggerId];
      case "REVEALED":
        return [event.entityId];
      case "OBJECTIVE_CHANGED":
        return event.carrierId !== null ? [event.carrierId] : [];
      case "COVER_DESTROYED":
        return [];
      default:
        return [];
    }
  };

  return events.filter((event) => {
    // Служебные события и глобальные состояния передаются всем.
    if (event.type === "TURN_CHANGED" || event.type === "MATCH_ENDED") return true;

    // Разрушение укрытия и предмет без носителя передаются, если клетка
    // была разведана ранее (изменение уже известной местности).
    if (event.type === "COVER_DESTROYED") {
      return cellKnown(event.gridPos.x, event.gridPos.y);
    }
    if (event.type === "OBJECTIVE_CHANGED" && event.carrierId === null) {
      return cellKnown(event.pos.x, event.pos.y);
    }

    const ids = affectedEntities(event);
    if (ids.length === 0) return true;
    return ids.some((id) => {
      const entity = state.entities.find((candidate) => candidate.id === id);
      return entityVisible(entity);
    });
  });
}
