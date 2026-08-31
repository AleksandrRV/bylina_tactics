/**
 * Карта клавиш боевого экрана (0.20.59; намерения — 0.20.65).
 *
 * Прежде решения по клавишам жили в эффекте экрана боя и проверялись только
 * косвенно — через монтирование экрана в jsdom, долгими прогонами с
 * ожиданием анимаций. Теперь карта — чистый модуль в той же форме, что
 * разбор нажатия по полю и канал команд: тест передаёт состояние боя и
 * сравнивает намерение, без React и без таймеров.
 */

import { describe, expect, it } from "vitest";
import { makeGrid, type EntityState, type MatchState, type SkillStats } from "@bylina/core";
import { resolveBattleKey, type BattleKeyContext, type BattleKeyIntent } from "../src/battle-keyboard.js";

/** Боец: ровно те поля, которые читает карта клавиш. */
function makeEntity(id: number, overrides: Record<string, unknown> = {}): EntityState {
  return {
    id,
    owner: 1,
    configId: "bogatyr",
    x: id,
    y: 0,
    z: 1,
    dir: 0,
    ap: 2,
    maxAp: 2,
    hp: 10,
    maxHp: 10,
    dead: false,
    coverType: 0,
    weaponIds: ["sword"],
    skillIds: [],
    skillCooldowns: {},
    skillUses: {},
    ...overrides,
  } as unknown as EntityState;
}

function makeSnapshot(entities: EntityState[], activeOwner = 1): MatchState {
  return { turnNumber: 1, activeOwner, grid: makeGrid(8, 6), entities } as MatchState;
}

function makeContext(overrides: Partial<BattleKeyContext> = {}): BattleKeyContext {
  const actor = makeEntity(1);
  return {
    paused: false,
    busy: false,
    outcomePending: false,
    cutscenePlaying: false,
    isTraining: false,
    trainingActorId: null,
    trainingDirective: null,
    trainingAllows: () => true,
    selectedId: 1,
    selected: actor,
    action: null,
    skills: {},
    snapshot: makeSnapshot([actor]),
    viewOwner: 1,
    side: { viewOwner: 1, isSpectator: false, isReplay: false },
    ...overrides,
  };
}

/** Нажатие: пустая реакция на `preventDefault`, чтобы видеть подавление. */
function press(key: string): { event: KeyboardEvent; defaultPrevented: () => boolean } {
  let prevented = false;
  const event = {
    key,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as KeyboardEvent;
  return { event, defaultPrevented: () => prevented };
}

const intentOf = (key: string, overrides: Partial<BattleKeyContext> = {}): BattleKeyIntent =>
  resolveBattleKey(press(key).event, makeContext(overrides));

const none: BattleKeyIntent = { kind: "none" };

describe("battle keyboard (0.20.65)", () => {
  it("toggles pause on Escape and skips the frame during a cutscene", () => {
    expect(intentOf("Escape"), "обычный бой").toEqual({ kind: "togglePause" });
    expect(intentOf("Escape", { cutscenePlaying: true }), "сцена: пауза уступает кадру").toEqual({
      kind: "skipCutscene",
    });
    // Пробел и ввод во время сцены тоже отпускают кадр (campaign.md §1.8),
    // и их действие по умолчанию подавляется.
    const space = press(" ");
    expect(resolveBattleKey(space.event, makeContext({ cutscenePlaying: true }))).toEqual({
      kind: "skipCutscene",
    });
    expect(space.defaultPrevented(), "пробел подавлен").toBe(true);
  });

  it("keeps combat keys silent while paused, busy or awaiting the outcome", () => {
    for (const state of [{ paused: true }, { busy: true }, { outcomePending: true }] as Partial<BattleKeyContext>[]) {
      expect(intentOf("9", state), `состояние ${JSON.stringify(state)}`).toEqual(none);
    }
  });

  it("defends on 9 and watches on 0 when the fighter can act", () => {
    expect(intentOf("9"), "защитная стойка").toEqual({ kind: "defend", actorId: 1 });
    expect(intentOf("0"), "дозор").toEqual({ kind: "overwatch", actorId: 1 });
  });

  it("refuses stance keys without action points, on a foreign turn or when training forbids", () => {
    expect(intentOf("9", { selected: makeEntity(1, { ap: 0 }) }), "нет очков действия").toEqual(none);
    expect(intentOf("9", { snapshot: makeSnapshot([makeEntity(1)], 2) }), "ход противника").toEqual(none);
    expect(
      intentOf("9", { isTraining: true, trainingAllows: (action) => action !== "defend" }),
      "обучение запрещает",
    ).toEqual(none);
    // Обучение: исполнителем должен быть боец текущего указания.
    expect(intentOf("9", { isTraining: true, trainingActorId: 2 }), "не тот исполнитель").toEqual(none);
  });

  it("cycles own living fighters on Tab, preferring those with action points", () => {
    const own = makeEntity(1, { ap: 2 });
    const spent = makeEntity(2, { ap: 0 });
    const fresh = makeEntity(3, { ap: 1 });
    const foe = makeEntity(4, { owner: 2, ap: 2 });
    const context = { selectedId: 1, snapshot: makeSnapshot([own, spent, fresh, foe]) };
    // Боец без очков действия пропускается: следующий — третий.
    expect(intentOf("Tab", context), "вперёд").toEqual({ kind: "select", id: 3 });
    expect(intentOf("Tab", { ...context, selectedId: 3 }), "по кругу").toEqual({ kind: "select", id: 1 });

    // Tab подавляется: иначе фокус ушёл бы за пределы поля.
    const tab = press("Tab");
    resolveBattleKey(tab.event, makeContext(context));
    expect(tab.defaultPrevented()).toBe(true);
  });

  it("forbids Tab in training while the directive pins the actor", () => {
    expect(intentOf("Tab", { isTraining: true, trainingActorId: 1 })).toEqual(none);
  });

  it("selects a weapon by its shortcut", () => {
    expect(intentOf("1")).toEqual({ kind: "toggleAction", entry: { type: "weapon", id: "sword" } });
  });

  it("arms an area self-skill on the first tap and applies it on the second", () => {
    const skills = { roar: { category: "self", radius: 2 } as unknown as SkillStats };
    const context = { selected: makeEntity(1, { weaponIds: [], skillIds: ["roar"] }), skills };
    expect(intentOf("1", context), "первый тап").toEqual({
      kind: "armSkill",
      entry: { type: "skill", id: "roar" },
    });
    expect(intentOf("1", { ...context, action: { type: "skill", id: "roar" } }), "второй тап").toEqual({
      kind: "applySelfSkill",
      skillId: "roar",
    });
    // Без области умение применяется сразу.
    const plain = { roar: { category: "self", radius: 0 } as unknown as SkillStats };
    expect(intentOf("1", { ...context, skills: plain }), "без области").toEqual({
      kind: "applySelfSkill",
      skillId: "roar",
    });
  });

  it("ignores a skill on cooldown and one spent for the battle", () => {
    const skills = { roar: { category: "self", maxUsesPerBattle: 1 } as unknown as SkillStats };
    expect(
      intentOf("1", {
        selected: makeEntity(1, { weaponIds: [], skillIds: ["roar"], skillCooldowns: { roar: 2 } }),
        skills,
      }),
      "перезарядка",
    ).toEqual(none);
    expect(
      intentOf("1", {
        selected: makeEntity(1, { weaponIds: [], skillIds: ["roar"], skillUses: { roar: 1 } }),
        skills,
      }),
      "исчерпано",
    ).toEqual(none);
  });

  it("follows the training directive: only the prescribed weapon passes", () => {
    const directive = {
      kind: "attack",
      actorId: 1,
      weaponId: "sword",
    } as unknown as BattleKeyContext["trainingDirective"];
    const training = { isTraining: true, trainingDirective: directive };
    expect(intentOf("1", training), "предписанное оружие").toEqual({
      kind: "toggleAction",
      entry: { type: "weapon", id: "sword" },
    });
    expect(
      intentOf("2", { ...training, selected: makeEntity(1, { weaponIds: ["sword", "club"] }) }),
      "другое оружие",
    ).toEqual(none);
  });

  it("pans the field with arrows and WASD", () => {
    const cases: [string, number, number][] = [
      ["ArrowLeft", 28, 0],
      ["a", 28, 0],
      ["ArrowRight", -28, 0],
      ["d", -28, 0],
      ["ArrowUp", 0, 28],
      ["w", 0, 28],
      ["ArrowDown", 0, -28],
      ["S", 0, -28],
    ];
    for (const [key, dx, dy] of cases) {
      expect(intentOf(key), `клавиша ${key}`).toEqual({ kind: "pan", dx, dy });
    }
  });
});
