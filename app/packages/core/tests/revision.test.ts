/**
 * День 11 (0.21.10, P1-1 часть 1): монотонная ревизия состояния.
 *
 * Ревизия растёт на единицу при каждом зафиксированном изменении боя и не
 * меняется на запросах предпросмотра (architecture §3.7: «запросы
 * предпросмотра не изменяют состояние и не обращаются к генератору»). Так
 * представление сможет подписываться на «состояние изменилось» вместо
 * клонирования снимка на каждый рендер.
 */
import { describe, expect, it } from "vitest";
import { createTacticsKernel } from "../src/kernel.js";
import { createPvpMatch } from "../src/match.js";
import { DEFAULT_TRAINING_UNITS } from "../src/defaults.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "../src/debug-map.js";
import type { MatchState } from "../src/types.js";
import type { WeaponStats } from "../src/weapons.js";

const MAP = {
  width: 12,
  height: 10,
  pitChance: 0.04,
  coverDensity: 0.06,
  wallDensity: 0.02,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.55,
  heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
};

const SWORD: WeaponStats = {
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 20,
  maxDmg: 20,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

/** Собрать ядро с двумя бойцами вплотную — гарантированный валидный бой. */
function makeKernel(): {
  kernel: ReturnType<typeof createTacticsKernel>;
  side1: MatchState["entities"][number];
  side2: MatchState["entities"][number];
} {
  const match = createPvpMatch({
    units: Object.values(DEFAULT_TRAINING_UNITS),
    map: MAP,
    side1: ["bogatyr"],
    side2: ["bogatyr"],
    loadouts: { bogatyr: ["sword"] },
    seed: 2026,
  });
  const side1 = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0)!;
  const side2 = match.entities.find((e) => e.owner === ENEMY_OWNER && e.coverType === 0)!;
  const clear = (x: number, y: number): void => {
    const tile = match.grid.tiles.find((t) => t.x === x && t.y === y)!;
    tile.pit = false;
    tile.blockLOS = false;
    for (const other of match.entities) {
      if (other.x === x && other.y === y && other.id !== side1.id && other.id !== side2.id) other.x += 3;
    }
  };
  clear(4, 4);
  clear(5, 4);
  side1.x = 4;
  side1.y = 4;
  side1.z = match.grid.tiles.find((t) => t.x === 4 && t.y === 4)!.z;
  side2.x = 5;
  side2.y = 4;
  side2.z = match.grid.tiles.find((t) => t.x === 5 && t.y === 4)!.z;
  const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 2026 });
  return { kernel, side1, side2 };
}

describe("ревизия состояния ядра", () => {
  it("стартует с нуля", () => {
    const { kernel } = makeKernel();
    expect(kernel.getRevision()).toBe(0);
  });

  it("растит ревизию на каждом успешном apply", () => {
    const { kernel } = makeKernel();
    expect(kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) }).ok).toBe(true);
    expect(kernel.getRevision()).toBe(1);
    expect(kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) }).ok).toBe(true);
    expect(kernel.getRevision()).toBe(2);
  });

  it("не растит ревизию на отклонённой команде", () => {
    const { kernel } = makeKernel();
    const before = kernel.getRevision();
    // Завершать ход может только активный владелец.
    expect(kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) }).ok).toBe(false);
    expect(kernel.getRevision()).toBe(before);
  });

  it("не растит ревизию на запросах предпросмотра", () => {
    const { kernel, side1, side2 } = makeKernel();
    const before = kernel.getRevision();
    // getHitPreview / getSkillPreview / getPath / getReachable — чистые запросы.
    kernel.getHitPreview(side1.id, side2.id, "sword");
    kernel.getReachable(side1.id);
    kernel.getPath(side1.id, { x: side1.x, y: side1.y + 1, z: side1.z });
    kernel.getVisibleCells(side1.owner);
    kernel.getExploredCells(side1.owner);
    kernel.getSnapshotFor(side1.owner);
    expect(kernel.getRevision()).toBe(before);
  });

  it("растит ревизию при успешной атаке", () => {
    const { kernel, side1, side2 } = makeKernel();
    const before = kernel.getRevision();
    expect(kernel.apply({ type: "ATTACK", actorId: side1.id, targetId: side2.id, weaponId: "sword" }).ok).toBe(true);
    expect(kernel.getRevision()).toBe(before + 1);
  });

  it("уведомляет подписчика и поднимает ревизию на одно изменение", () => {
    const { kernel } = makeKernel();
    let notified = 0;
    const unlisten = kernel.subscribe(() => {
      notified += 1;
    });
    kernel.apply({ type: "DEFEND", actorId: kernel.getSnapshot().entities.find((e) => e.owner === PLAYER_OWNER)!.id });
    expect(notified).toBe(1);
    expect(kernel.getRevision()).toBe(1);
    unlisten();
  });
});
