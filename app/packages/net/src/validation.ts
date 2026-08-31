import type { Command } from "@bylina/core";
import type { Envelope } from "./envelope.js";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const position = (value: unknown): boolean => object(value) && number(value.x) && number(value.y) && number(value.z);

/**
 * Максимальная длина маршрута в MOVE. Тот же порядок пределов, что и у
 * пакета событий (512): недоверенный ведомый не должен задавать длину
 * работы ведущего (проверка каждого шага пути поиском и запись в журнал).
 */
const MAX_PATH_LENGTH = 256;

/**
 * Runtime contract for untrusted tactical commands. Отбрасывает только
 * заведомо непригодные кадры: семантическую законность (право хода,
 * достижимость, очки действий) проверяет ядро. Сужение до Command убирает
 * приведение типа на принимающей стороне (session).
 */
export function isCommandPayload(value: unknown): value is Command {
  if (!object(value) || typeof value.type !== "string") return false;
  if (value.type === "END_TURN") return typeof value.playerId === "string" && value.playerId.length <= 32;
  if (!number(value.actorId) || !Number.isInteger(value.actorId)) return false;
  switch (value.type) {
    case "MOVE":
      return (
        position(value.to) &&
        (value.path === undefined ||
          (Array.isArray(value.path) && value.path.length <= MAX_PATH_LENGTH && value.path.every(position)))
      );
    case "ATTACK":
      return number(value.targetId) && typeof value.weaponId === "string" && value.weaponId.length <= 128;
    case "OVERWATCH":
    case "DEFEND":
      return true;
    case "USE_SKILL":
      return (
        typeof value.skillId === "string" &&
        value.skillId.length <= 128 &&
        (value.targetId === undefined || number(value.targetId)) &&
        (value.targetPos === undefined || position(value.targetPos))
      );
    default:
      return false;
  }
}

/** Event batches are host-produced but still validated at every trust boundary. */
export function isEventBatchPayload(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 512 &&
    value.every((event) => object(event) && typeof event.type === "string" && event.type.length <= 64)
  );
}

/**
 * Размеры снимка синхронизации ограничены так же, как остальная граница
 * доверия (network-protocol.md §3): недоверенный ведущий не должен присылать
 * раздуваемые CPU/память массивы. Сетки контента — 12×10..14×10, отряды —
 * единицы–десятки сущностей; потолки взяты с большим запасом.
 */
const MAX_SYNC_ENTITIES = 256;
const MAX_SYNC_TILES = 10_000;
const MAX_CELL_KEY_LENGTH = 16;

/** The single network-protocol.md SyncPayload format: { match, visible, explored }. */
export function isSyncPayload(value: unknown): boolean {
  if (!object(value) || !object(value.match) || !Array.isArray(value.visible) || !Array.isArray(value.explored))
    return false;
  if (value.visible.length > MAX_SYNC_TILES || value.explored.length > MAX_SYNC_TILES) return false;
  if (!value.visible.every((cell) => typeof cell === "string" && cell.length <= MAX_CELL_KEY_LENGTH)) return false;
  if (!value.explored.every((cell) => typeof cell === "string" && cell.length <= MAX_CELL_KEY_LENGTH)) return false;
  const match = value.match;
  const grid = object(match.grid) ? match.grid : null;
  return (
    number(match.turnNumber) &&
    number(match.activeOwner) &&
    grid !== null &&
    Array.isArray(match.entities) &&
    match.entities.length <= MAX_SYNC_ENTITIES &&
    Array.isArray(grid.tiles) &&
    grid.tiles.length <= MAX_SYNC_TILES &&
    grid.tiles.every(position)
  );
}

export function isEnvelope(value: unknown): value is Envelope {
  return (
    object(value) &&
    typeof value.type === "string" &&
    typeof value.senderId === "string" &&
    number(value.timestamp) &&
    "payload" in value
  );
}
