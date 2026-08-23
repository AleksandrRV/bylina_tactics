import type { Envelope } from "./envelope.js";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const position = (value: unknown): boolean => object(value) && number(value.x) && number(value.y) && number(value.z);

/** Runtime contract for untrusted tactical commands. */
export function isCommandPayload(value: unknown): boolean {
  if (!object(value) || typeof value.type !== "string") return false;
  if (value.type === "END_TURN") return typeof value.playerId === "string" && value.playerId.length <= 32;
  if (!number(value.actorId) || !Number.isInteger(value.actorId)) return false;
  switch (value.type) {
    case "MOVE": return position(value.to) && (value.path === undefined || (Array.isArray(value.path) && value.path.every(position)));
    case "ATTACK": return number(value.targetId) && typeof value.weaponId === "string" && value.weaponId.length <= 128;
    case "OVERWATCH": case "DEFEND": return true;
    case "USE_SKILL": return typeof value.skillId === "string" && value.skillId.length <= 128 &&
      (value.targetId === undefined || number(value.targetId)) && (value.targetPos === undefined || position(value.targetPos));
    default: return false;
  }
}

/** Event batches are host-produced but still validated at every trust boundary. */
export function isEventBatchPayload(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 512 && value.every((event) => object(event) && typeof event.type === "string" && event.type.length <= 64);
}

/** The single network-protocol.md SyncPayload format: { match, visible, explored }. */
export function isSyncPayload(value: unknown): boolean {
  if (!object(value) || !object(value.match) || !Array.isArray(value.visible) || !Array.isArray(value.explored)) return false;
  const match = value.match;
  return number(match.turnNumber) && number(match.activeOwner) && object(match.grid) &&
    Array.isArray(match.entities) && Array.isArray((match.grid as Record<string, unknown>).tiles) &&
    value.visible.every((cell) => typeof cell === "string") && value.explored.every((cell) => typeof cell === "string");
}

export function isEnvelope(value: unknown): value is Envelope {
  return object(value) && typeof value.type === "string" && typeof value.senderId === "string" && number(value.timestamp) && "payload" in value;
}
