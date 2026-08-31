/**
 * Разбор нажатия по полю боя (0.20.63).
 *
 * Прежде намерение нажатия проверялось только живыми прогонами: собрать
 * состояние боя, смонтировать экран, дождаться анимаций. Теперь проверка
 * занимает строку: передали состояние — прочитали намерение.
 */

import { describe, expect, it } from "vitest";
import type { EntityState, ReachableCell, SkillStats } from "@bylina/core";
import { resolveCellClick, type CellClickContext, type CellIntent } from "../src/battle-cell-click.js";
import type { ChargePlan } from "../src/charge-attack.js";

/** Боец: ровно те поля, которые читает разбор. */
function fighter(id: number, overrides: Record<string, unknown> = {}): EntityState {
  return {
    id,
    owner: 1,
    x: id,
    y: 0,
    z: 1,
    ap: 2,
    maxAp: 2,
    hp: 10,
    dead: false,
    coverType: 0,
    weaponId: "sword",
    weaponIds: ["sword"],
    skillIds: [],
    ...overrides,
  } as unknown as EntityState;
}

/** Клетка поля: достижимая, если её передали в `reach`. */
const cell = (x: number, y: number, overrides: Record<string, unknown> = {}): ReachableCell =>
  ({ x, y, z: 1, ...overrides }) as unknown as ReachableCell;

function makeContext(overrides: Partial<CellClickContext> = {}): CellClickContext {
  const hero = fighter(1, { x: 0, y: 0 });
  return {
    paused: false,
    busy: false,
    outcomePending: false,
    ownTurn: true,
    isTraining: false,
    trainingNoopStep: false,
    trainingActorId: null,
    trainingDirective: null,
    selectedId: 1,
    selected: hero,
    action: null,
    skills: {},
    entities: [hero],
    tiles: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ],
    viewOwner: 1,
    reach: undefined,
    aimId: null,
    hitAvailable: false,
    charge: null,
    chargeArmed: false,
    preview: null,
    coarse: false,
    ...overrides,
  };
}

const skill = (overrides: Record<string, unknown> = {}): SkillStats =>
  ({ category: "attack", effects: [], radius: 0, filter: "enemies", ...overrides }) as unknown as SkillStats;

const chargePlan = (targetId: number): ChargePlan =>
  ({ targetId, step: { x: 1, y: 0, z: 1 }, path: [], mpCost: 2, apCost: 2 }) as ChargePlan;

const intentAt = (x: number, y: number, overrides: Partial<CellClickContext> = {}): CellIntent =>
  resolveCellClick(x, y, makeContext(overrides));

describe("battle cell click (0.20.63)", () => {
  it("ignores the click while the input is closed", () => {
    for (const state of [
      { paused: true },
      { busy: true },
      { outcomePending: true },
      { ownTurn: false },
    ] as Partial<CellClickContext>[]) {
      expect(intentAt(0, 0, state), `состояние ${JSON.stringify(state)}`).toEqual({ kind: "ignore" });
    }
  });

  it("advances the introductory training step by any click", () => {
    // Шаг until "noop" (0.20.1): действие не предполагается, подсказка не
    // должна застревать до первого действия игрока.
    expect(intentAt(0, 0, { isTraining: true, trainingNoopStep: true })).toEqual({
      kind: "advanceNoopStep",
    });
  });

  it("applies a self-area skill from any cell", () => {
    const skills = { roar: skill({ category: "self", radius: 2 }) };
    expect(
      intentAt(2, 0, { skills, action: { type: "skill", id: "roar" }, selected: fighter(1, { skillIds: ["roar"] }) }),
    ).toEqual({ kind: "selfArea", skillId: "roar" });
  });

  it("selects an own fighter, but only the prescribed one in training", () => {
    const hero = fighter(1, { x: 0, y: 0 });
    const second = fighter(2, { x: 1, y: 0 });
    expect(intentAt(1, 0, { entities: [hero, second] }), "обычный бой").toEqual({ kind: "select", id: 2 });
    // Строгий сценарий (0.20.13): выбрать можно только исполнителя указания.
    expect(
      intentAt(1, 0, { entities: [hero, second], isTraining: true, trainingActorId: 1 }),
      "обучение: не тот исполнитель",
    ).toEqual({ kind: "denyActor" });
    // Умение по союзнику: нажатие по своему — это цель, а не выбор.
    const skills = { heal: skill({ filter: "allies", category: "support" }) };
    expect(
      intentAt(1, 0, { entities: [hero, second], skills, action: { type: "skill", id: "heal" } }),
      "умение по союзнику",
    ).toEqual({ kind: "aim", id: 2 });
  });

  it("arms the primary weapon on an enemy and checks it against the training directive", () => {
    const hero = fighter(1, { x: 0, y: 0 });
    const foe = fighter(2, { x: 2, y: 0, owner: 2 });
    expect(intentAt(2, 0, { entities: [hero, foe] }), "обычный бой").toEqual({
      kind: "armAttack",
      entry: { type: "weapon", id: "sword" },
      targetId: 2,
    });
    const directive = { kind: "attack", actorId: 1, targetId: 2, weaponId: "sword" };
    expect(
      intentAt(2, 0, {
        entities: [hero, foe],
        isTraining: true,
        trainingDirective: directive as unknown as CellClickContext["trainingDirective"],
      }),
      "обучение: предписанная цель и оружие",
    ).toEqual({ kind: "armAttack", entry: { type: "weapon", id: "sword" }, targetId: 2 });
    const otherWeapon = { ...(directive as Record<string, unknown>), weaponId: "club" };
    expect(
      intentAt(2, 0, {
        entities: [hero, foe],
        isTraining: true,
        trainingDirective: otherWeapon as unknown as CellClickContext["trainingDirective"],
      }),
      "обучение: другое оружие",
    ).toEqual({ kind: "denyTarget", action: "attack" });
  });

  it("aims first, then strikes or charges on the second tap", () => {
    const hero = fighter(1, { x: 0, y: 0 });
    const foe = fighter(2, { x: 2, y: 0, owner: 2 });
    const entities = [hero, foe];
    const armed = { action: { type: "weapon", id: "sword" } } as Partial<CellClickContext>;

    expect(intentAt(2, 0, { entities, ...armed }), "первое нажатие").toEqual({ kind: "aim", id: 2 });
    expect(intentAt(2, 0, { entities, ...armed, aimId: 2, hitAvailable: true }), "повторное: удар доступен").toEqual({
      kind: "attack",
      id: 2,
    });
    expect(
      intentAt(2, 0, {
        entities,
        ...armed,
        aimId: 2,
        charge: chargePlan(2),
        chargeArmed: true,
      }),
      "повторное: рывок вооружён",
    ).toEqual({ kind: "charge", id: 2 });
    // План показан, но игрок его не подтвердил — остаётся прицеливание.
    expect(
      intentAt(2, 0, { entities, ...armed, aimId: 2, charge: chargePlan(2), chargeArmed: false }),
      "рывок не подтверждён",
    ).toEqual({ kind: "aim", id: 2 });
  });

  it("checks the aiming target against the training directive", () => {
    const hero = fighter(1, { x: 0, y: 0 });
    const foe = fighter(2, { x: 2, y: 0, owner: 2 });
    const other = fighter(3, { x: 3, y: 0, owner: 2 });
    const aim = { action: { type: "weapon", id: "sword" } } as Partial<CellClickContext>;
    const directive = {
      kind: "attack",
      actorId: 1,
      targetId: 2,
      weaponId: "sword",
    } as unknown as CellClickContext["trainingDirective"];
    expect(
      intentAt(2, 0, { entities: [hero, foe, other], ...aim, isTraining: true, trainingDirective: directive }),
      "предписанная цель",
    ).toEqual({ kind: "aim", id: 2 });
    expect(
      intentAt(3, 0, { entities: [hero, foe, other], ...aim, isTraining: true, trainingDirective: directive }),
      "другая цель",
    ).toEqual({ kind: "denyTarget", action: "attack" });
  });

  it("gives the cell to a skill that spawns or displaces", () => {
    const skills = { totem: skill({ effects: [{ type: "spawn" }] }) };
    const action = { type: "skill", id: "totem" } as const;
    expect(intentAt(2, 0, { skills, action, selected: fighter(1, { skillIds: ["totem"] }) }), "призыв").toEqual({
      kind: "positionSkill",
      cell: { x: 2, y: 0, z: 2 },
    });
    // Клетки вне поля нет — нажатие ни к чему не ведёт.
    expect(intentAt(9, 9, { skills, action }), "клетка вне поля").toEqual({ kind: "ignore" });
  });

  it("moves into a reachable cell, confirming the step by a coarse pointer", () => {
    const hero = fighter(1, { x: 0, y: 0 });
    const reach = cell(2, 0);
    expect(intentAt(2, 0, { entities: [hero], reach }), "обычный указатель").toEqual({
      kind: "move",
      cell: reach,
    });
    // Палец закрывает клетку: первое нажатие показывает шаг, второе идёт.
    expect(intentAt(2, 0, { entities: [hero], reach, coarse: true }), "первое касание").toEqual({
      kind: "previewMove",
      key: "2,0",
    });
    expect(intentAt(2, 0, { entities: [hero], reach, coarse: true, preview: "2,0" }), "второе касание").toEqual({
      kind: "move",
      cell: reach,
    });
    // Обучение: палец принимает только подсвеченную клетку указания.
    const directive = {
      kind: "move",
      actorId: 1,
      cell: { x: 1, y: 0 },
    } as unknown as CellClickContext["trainingDirective"];
    expect(
      intentAt(2, 0, { entities: [hero], reach, coarse: true, isTraining: true, trainingDirective: directive }),
      "обучение: не та клетка",
    ).toEqual({ kind: "denyTarget", action: "move" });
    expect(
      intentAt(1, 0, {
        entities: [hero],
        reach: cell(1, 0),
        coarse: true,
        isTraining: true,
        trainingDirective: directive,
      }),
      "обучение: предписанная клетка",
    ).toEqual({ kind: "previewMove", key: "1,0" });
  });

  it("cancels the aim on an empty unreachable cell", () => {
    expect(intentAt(5, 5, { entities: [fighter(1, { x: 0, y: 0 })], aimId: 2 })).toEqual({ kind: "cancel" });
  });
});
