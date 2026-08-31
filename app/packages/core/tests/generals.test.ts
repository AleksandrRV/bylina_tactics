import { describe, expect, it } from "vitest";
import { createMissionMatch, createTacticsKernel, livingOf } from "../src/index.js";
import { ENEMY_OWNER, PLAYER_OWNER } from "../src/debug-map.js";
import type { SpawnUnitConfig } from "../src/defaults.js";
import type { WeaponStats } from "../src/weapons.js";
import type { EntityState, MatchState } from "../src/types.js";

const MAP = {
  width: 14,
  height: 10,
  pitChance: 0.03,
  coverDensity: 0.05,
  wallDensity: 0.02,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.5,
  heightMix: { z0: 0.12, z1: 0.76, z2: 0.12 },
};

const BOGATYR: SpawnUnitConfig = {
  id: "bogatyr",
  maxHealth: 12,
  maxAP: 2,
  mobility: 5,
  aim: 100,
  defense: 0,
  will: 40,
  vision: 12,
  weapons: ["sword"],
  skills: [],
  tags: [],
};
const UPYR: SpawnUnitConfig = {
  id: "upyr",
  maxHealth: 8,
  maxAP: 2,
  mobility: 5,
  aim: 60,
  defense: 0,
  will: 20,
  vision: 10,
  weapons: ["claws"],
  skills: [],
  tags: [],
};
const YAGA: SpawnUnitConfig = {
  id: "baba_yaga",
  maxHealth: 24,
  maxAP: 2,
  mobility: 6,
  aim: 80,
  defense: 5,
  will: 90,
  vision: 14,
  weapons: ["branch"],
  skills: [],
  tags: ["flying"],
  fleeHp: 6,
};
const SOLOVEY: SpawnUnitConfig = {
  id: "solovey",
  maxHealth: 18,
  maxAP: 2,
  mobility: 5,
  aim: 85,
  defense: 5,
  will: 60,
  vision: 13,
  weapons: ["bow"],
  skills: [],
  tags: ["hiddenStart"],
};

const SWORD: WeaponStats = {
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 1,
  maxDmg: 1,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

function mission(options: Partial<Parameters<typeof createMissionMatch>[0]> = {}): MatchState {
  return createMissionMatch({
    units: [BOGATYR, UPYR, YAGA, SOLOVEY],
    map: MAP,
    playerSlots: ["bogatyr"],
    enemies: [{ unitId: "upyr", count: 1 }],
    seed: 41,
    ...options,
  });
}

describe("generals (0.18.0)", () => {
  it("spawns configured generals with the enemy side", () => {
    const match = mission({ generals: ["solovey", "baba_yaga"] });
    const yaga = match.entities.find((entity) => entity.configId === "baba_yaga");
    const solovey = match.entities.find((entity) => entity.configId === "solovey");
    expect(yaga).toBeDefined();
    expect(solovey).toBeDefined();
    expect(yaga?.owner).toBe(ENEMY_OWNER);
    expect(yaga?.flying).toBe(true);
    expect(yaga?.fleeHp).toBe(6);
    expect(solovey?.hidden).toBe(true);
    // Не пересекаются с бойцами (1..) и врагами (10..).
    expect(yaga!.id).toBeGreaterThanOrEqual(500);
    expect(solovey!.id).toBeGreaterThanOrEqual(500);
  });

  it("excludes generals that died earlier in the campaign", () => {
    const match = mission({ generals: ["baba_yaga"], excludedGenerals: ["baba_yaga"] });
    expect(match.entities.some((entity) => entity.configId === "baba_yaga")).toBe(false);
  });

  it("a fleeing general leaves the field without dying", () => {
    const match = mission({ generals: ["baba_yaga"] });
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 41 });
    const yaga = kernel.getSnapshot().entities.find((entity) => entity.configId === "baba_yaga")!;
    const player = kernel
      .getSnapshot()
      .entities.find((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0)!;
    // Поставить вплотную (расстановка до ядра — match уже передан; используем снимок нельзя).
    // Создадим ядро заново с расставленными сущностями.
    const placed = mission({ generals: ["baba_yaga"] });
    const placedYaga = placed.entities.find((entity) => entity.configId === "baba_yaga")!;
    const placedPlayer = placed.entities.find((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0)!;
    placedYaga.x = 6;
    placedYaga.y = 5;
    placedYaga.defense = 0;
    placedPlayer.x = 7;
    placedPlayer.y = 5;
    // Урон 19 → hp 5 ≤ fleeHp 6 → уход.
    const lethal = { ...SWORD, minDmg: 19, maxDmg: 19 };
    const kernel2 = createTacticsKernel({ initial: placed, weapons: { sword: lethal }, skills: {}, seed: 42 });
    const applied = kernel2.apply({
      type: "ATTACK",
      actorId: placedPlayer.id,
      targetId: placedYaga.id,
      weaponId: "sword",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const after = kernel2.getSnapshot();
    expect(after.entities.some((entity) => entity.id === placedYaga.id)).toBe(false);
    expect(after.entities.some((entity) => entity.configId === "baba_yaga" && !entity.dead)).toBe(false);
    // Причина удаления — FLED (уход, не гибель).
    expect(applied.events.some((event) => event.type === "ENTITY_REMOVED" && event.reason === "FLED")).toBe(true);
  });

  it("a general killed in the mission is recorded as dead", () => {
    const match = mission({ generals: ["baba_yaga"] });
    const placed = mission({ generals: ["baba_yaga"] });
    const placedYaga = placed.entities.find((entity) => entity.configId === "baba_yaga")!;
    const placedPlayer = placed.entities.find((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0)!;
    placedYaga.x = 6;
    placedYaga.y = 5;
    placedYaga.defense = 0;
    placedPlayer.x = 7;
    placedPlayer.y = 5;
    const lethal = { ...SWORD, minDmg: 24, maxDmg: 24 };
    const kernel = createTacticsKernel({ initial: placed, weapons: { sword: lethal }, skills: {}, seed: 43 });
    const applied = kernel.apply({
      type: "ATTACK",
      actorId: placedPlayer.id,
      targetId: placedYaga.id,
      weaponId: "sword",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.events.some((event) => event.type === "ENTITY_DIED" && event.entityId === placedYaga.id)).toBe(true);
    const after = kernel.getSnapshot();
    expect(after.entities.find((entity) => entity.id === placedYaga.id)?.dead).toBe(true);
  });
});

describe("general death accounting (QA 0.18.0)", () => {
  it("the full host snapshot reports a general dead even outside the player's view", () => {
    const match = mission({ generals: ["baba_yaga"] });
    // Ограничиваем зрение игрока: Яга у восточного края вне обзора.
    for (const entity of match.entities) {
      if (entity.owner === PLAYER_OWNER) entity.vision = 3;
    }
    const kernel = createTacticsKernel({ initial: match, weapons: { sword: SWORD }, skills: {}, seed: 45 });
    // Сокращённый снимок игрока не содержит Яги (вне обзора)...
    const playerSnap = kernel.getSnapshotFor(PLAYER_OWNER);
    expect(playerSnap.entities.some((entity) => entity.configId === "baba_yaga")).toBe(false);
    // ...но полный снимок ведущего содержит её (BattleScreen берёт его
    // для учёта окончательной гибели генерала).
    expect(kernel.getSnapshot().entities.some((entity) => entity.configId === "baba_yaga")).toBe(true);
  });
});
