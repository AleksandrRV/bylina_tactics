import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { distH } from "./grid.js";
import { livingOf, matchOutcome } from "./outcome.js";
import { isResurrectionSpawn } from "./skills.js";
import type { TacticsKernel } from "./kernel.js";
import type { Command, EntityState, GameEvent, ReachableCell } from "./types.js";

function nearest(from: { x: number; y: number }, candidates: readonly EntityState[]): EntityState | undefined {
  const ranked = [...candidates].sort((a, b) => {
    const da = distH(from.x, from.y, a.x, a.y);
    const db = distH(from.x, from.y, b.x, b.y);
    if (da !== db) return da - db;
    return a.id - b.id;
  });
  return ranked[0];
}

function hasStatus(entity: EntityState, status: string): boolean {
  if (status === "poison") return Boolean(entity.poison);
  if (status === "panic") return Boolean(entity.panic);
  if (status === "immobile") return Boolean(entity.immobileTurns);
  if (status === "hidden") return Boolean(entity.hidden);
  if (status === "flying") return Boolean(entity.flying);
  if (status === "timed") return entity.timedLife !== undefined;
  return false;
}

function repeatsAppliedStatus(kernel: TacticsKernel, skillId: string, target: EntityState): boolean {
  const skill = kernel.getSkillDefinition(skillId);
  return Boolean(skill?.effects.some((effect) => effect.type === "applyStatus" && hasStatus(target, effect.status)));
}

function bestSkill(kernel: TacticsKernel, actor: EntityState, foes: readonly EntityState[], all: readonly EntityState[]): Command | null {
  for (const skillId of actor.skillIds ?? []) {
    const skill = kernel.getSkillDefinition(skillId);
    if (!skill) continue;
    // Извлечение: юнит в зоне эвакуации покидает поле (§6 math).
    if (skill.extract) {
      if (kernel.getSkillPreview(actor.id, skillId).available) {
        return { type: "USE_SKILL", actorId: actor.id, skillId };
      }
      continue;
    }
    const spawnEffect = skill.effects.find((effect) => effect.type === "spawn");
    if (spawnEffect?.type === "spawn") {
      // Воскрешение требует тело погибшего юнита указанной записи в целевой
      // клетке; причина определяется признаком spawnKind (либо эвристикой).
      if (!isResurrectionSpawn(spawnEffect, skillId)) continue;
      const corpse = all
        .filter((entity) => entity.dead && entity.owner === actor.owner && entity.configId === spawnEffect.unitId)
        .sort((a, b) => a.id - b.id)
        .find((entity) => kernel.getSkillPreview(actor.id, skillId, undefined, { x: entity.x, y: entity.y, z: entity.z }).available);
      if (corpse) return { type: "USE_SKILL", actorId: actor.id, skillId, targetPos: { x: corpse.x, y: corpse.y, z: corpse.z } };
      continue;
    }
    if (skill.filter === "enemies") {
      const target = foes.find((foe) =>
        !repeatsAppliedStatus(kernel, skillId, foe) && kernel.getSkillPreview(actor.id, skillId, foe.id).available
      );
      if (target) return { type: "USE_SKILL", actorId: actor.id, skillId, targetId: target.id };
    }
  }
  return null;
}

function bestAttack(kernel: TacticsKernel, actor: EntityState, foes: readonly EntityState[]): Command | null {
  const hits: { foe: EntityState; dist: number }[] = [];
  for (const foe of foes) {
    const preview = kernel.getHitPreview(actor.id, foe.id);
    if (!preview.available) continue;
    hits.push({ foe, dist: distH(actor.x, actor.y, foe.x, foe.y) });
  }
  if (hits.length === 0) return null;
  const kite = actor.preferredRange !== undefined;
  hits.sort((a, b) => {
    if (kite && a.dist !== b.dist) return b.dist - a.dist;
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.foe.id - b.foe.id;
  });
  const chosen = hits[0];
  if (!chosen) return null;
  return { type: "ATTACK", actorId: actor.id, targetId: chosen.foe.id, weaponId: actor.weaponId };
}

function scoreMove(actor: EntityState, cell: ReachableCell, foe: EntityState): number {
  const next = distH(cell.x, cell.y, foe.x, foe.y);
  if (actor.preferredRange !== undefined) {
    const now = distH(actor.x, actor.y, foe.x, foe.y);
    if (now < (actor.preferredRange! - 1)) return next * 10 - cell.apCost;
    if (now > (actor.preferredRange! + 1)) return -next * 10 - cell.apCost;
    return -Math.abs(next - actor.preferredRange!) * 10 - cell.apCost;
  }
  return -next * 10 - cell.apCost;
}

function bestMove(kernel: TacticsKernel, actor: EntityState, foes: readonly EntityState[]): Command | null {
  const foe = nearest(actor, foes);
  if (!foe) return null;
  const reachable = kernel.getReachable(actor.id);
  if (reachable.length === 0) return null;
  const ranked = [...reachable].sort((a, b) => {
    const sa = scoreMove(actor, a, foe);
    const sb = scoreMove(actor, b, foe);
    if (sa !== sb) return sb - sa;
    if (a.apCost !== b.apCost) return a.apCost - b.apCost;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
  const now = distH(actor.x, actor.y, foe.x, foe.y);
  const best = ranked[0];
  if (!best) return null;
  const next = distH(best.x, best.y, foe.x, foe.y);
  if (actor.preferredRange !== undefined) {
    if (now < (actor.preferredRange! - 1) && next <= now) return null;
    if (now > (actor.preferredRange! + 1) && next >= now) return null;
  } else if (next >= now) {
    return null;
  }
  return { type: "MOVE", actorId: actor.id, to: best };
}

export function pickEnemyCommand(kernel: TacticsKernel): Command | null {
  const snap = kernel.getSnapshot();
  if (snap.activeOwner !== ENEMY_OWNER) return null;
  const visible = kernel.getVisibleCells(ENEMY_OWNER);
  const foes = livingOf(snap, PLAYER_OWNER).filter((entity) => !entity.hidden && visible.has(`${entity.x},${entity.y}`));
  const enemies = livingOf(snap, ENEMY_OWNER)
    .filter((entity) => entity.ap > 0)
    .sort((a, b) => a.id - b.id);
  if (enemies.length === 0) return null;
  for (const actor of enemies) {
    const skill = bestSkill(kernel, actor, foes, snap.entities);
    if (skill) return skill;
    const attack = bestAttack(kernel, actor, foes);
    if (attack) return attack;
    const move = bestMove(kernel, actor, foes);
    if (move) return move;
  }
  // Если доступных целей нет, оставшийся юнит использует нормативный дозор.
  const watcher = enemies.find((actor) => actor.ap > 0 && !actor.overwatch && actor.weaponId);
  return watcher ? { type: "OVERWATCH", actorId: watcher.id } : null;
}

/** Исполняет ход Нави теми же командами, что и человек. */
export function runEnemyTurn(kernel: TacticsKernel): GameEvent[] {
  const events: GameEvent[] = [];
  for (let step = 0; step < 96; step += 1) {
    const snap = kernel.getSnapshot();
    if (snap.activeOwner !== ENEMY_OWNER) break;
    if (matchOutcome(snap) !== "ongoing") break;
    const command = pickEnemyCommand(kernel);
    if (!command) {
      const ended = kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      if (ended.ok) events.push(...ended.events);
      break;
    }
    const applied = kernel.apply(command);
    if (!applied.ok) {
      const ended = kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      if (ended.ok) events.push(...ended.events);
      break;
    }
    events.push(...applied.events);
  }
  return events;
}
