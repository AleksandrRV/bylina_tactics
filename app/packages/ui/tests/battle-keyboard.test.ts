/**
 * Карта клавиш боевого экрана (0.20.59).
 *
 * Прежде решения по клавишам жили в эффекте экрана боя и проверялись только
 * косвенно — через монтирование экрана в jsdom, долгими прогонами с
 * ожиданием анимаций. Теперь карта — чистый модуль: тест передаёт контекст
 * и смотрит, какие действия вызваны, без React и без таймеров.
 */

import { describe, expect, it } from "vitest";
import { makeGrid, type EntityState, type MatchState, type SkillStats } from "@bylina/core";
import { handleBattleKey, type BattleKeyActions, type BattleKeyContext } from "../src/battle-keyboard.js";

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
    isOwn: (entity) => entity.owner === 1 && !entity.dead,
    ...overrides,
  };
}

/** Запись вызванных действий: имя и аргументы в порядке вызова. */
function makeActions(): { actions: BattleKeyActions; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args });
    };
  return {
    calls,
    actions: {
      skipCutscene: record("skipCutscene"),
      togglePause: record("togglePause"),
      select: record("select"),
      defend: record("defend"),
      overwatch: record("overwatch"),
      applySelfSkill: record("applySelfSkill"),
      armSkill: record("armSkill"),
      toggleAction: record("toggleAction"),
      cancel: record("cancel"),
      pan: record("pan"),
    },
  };
}

const press = (key: string): KeyboardEvent => ({ key, preventDefault: () => undefined }) as unknown as KeyboardEvent;

const names = (calls: { name: string }[]): string[] => calls.map((call) => call.name);

describe("battle keyboard (0.20.59)", () => {
  it("toggles pause on Escape and skips the frame during a cutscene", () => {
    const { actions, calls } = makeActions();
    handleBattleKey(press("Escape"), makeContext(), actions);
    expect(names(calls)).toEqual(["togglePause"]);

    const playing = makeActions();
    handleBattleKey(press("Escape"), makeContext({ cutscenePlaying: true }), playing.actions);
    expect(names(playing.calls)).toEqual(["skipCutscene"]);

    // Пробел и ввод во время сцены тоже отпускают кадр (campaign.md §1.8).
    const space = makeActions();
    handleBattleKey(press(" "), makeContext({ cutscenePlaying: true }), space.actions);
    expect(names(space.calls)).toEqual(["skipCutscene"]);
  });

  it("keeps combat keys silent while paused, busy or awaiting the outcome", () => {
    for (const state of [{ paused: true }, { busy: true }, { outcomePending: true }] as Partial<BattleKeyContext>[]) {
      const { actions, calls } = makeActions();
      handleBattleKey(press("9"), makeContext(state), actions);
      expect(names(calls), `состояние ${JSON.stringify(state)}`).toEqual([]);
    }
  });

  it("defends on 9 and watches on 0 when the fighter can act", () => {
    const defence = makeActions();
    handleBattleKey(press("9"), makeContext(), defence.actions);
    expect(names(defence.calls)).toEqual(["defend"]);

    const watch = makeActions();
    handleBattleKey(press("0"), makeContext(), watch.actions);
    expect(names(watch.calls)).toEqual(["overwatch"]);
  });

  it("refuses stance keys without action points, on a foreign turn or when training forbids", () => {
    const noAp = makeActions();
    handleBattleKey(press("9"), makeContext({ selected: makeEntity(1, { ap: 0 }) }), noAp.actions);
    expect(names(noAp.calls), "нет очков действия").toEqual([]);

    const foreign = makeActions();
    handleBattleKey(press("9"), makeContext({ snapshot: makeSnapshot([makeEntity(1)], 2) }), foreign.actions);
    expect(names(foreign.calls), "ход противника").toEqual([]);

    const training = makeActions();
    handleBattleKey(
      press("9"),
      makeContext({ isTraining: true, trainingAllows: (action) => action !== "defend" }),
      training.actions,
    );
    expect(names(training.calls), "обучение запрещает").toEqual([]);
  });

  it("cycles own living fighters on Tab, preferring those with action points", () => {
    const own = makeEntity(1, { ap: 2 });
    const spent = makeEntity(2, { ap: 0 });
    const fresh = makeEntity(3, { ap: 1 });
    const foe = makeEntity(4, { owner: 2, ap: 2 });
    const context = makeContext({
      selectedId: 1,
      selected: own,
      snapshot: makeSnapshot([own, spent, fresh, foe]),
    });

    const first = makeActions();
    handleBattleKey(press("Tab"), context, first.actions);
    // Боец без очков действия пропускается: следующий — третий.
    expect(first.calls).toEqual([{ name: "select", args: [3] }]);

    const second = makeActions();
    handleBattleKey(press("Tab"), { ...context, selectedId: 3 }, second.actions);
    expect(second.calls).toEqual([{ name: "select", args: [1] }]);
  });

  it("forbids Tab in training while the directive pins the actor", () => {
    const { actions, calls } = makeActions();
    handleBattleKey(press("Tab"), makeContext({ isTraining: true, trainingActorId: 1 }), actions);
    expect(names(calls)).toEqual([]);
  });

  it("selects a weapon by its shortcut", () => {
    const { actions, calls } = makeActions();
    handleBattleKey(press("1"), makeContext(), actions);
    expect(calls).toEqual([{ name: "toggleAction", args: [{ type: "weapon", id: "sword" }] }]);
  });

  it("arms an area self-skill on the first tap and applies it on the second", () => {
    const skills = { roar: { category: "self", radius: 2 } as unknown as SkillStats };
    const actor = makeEntity(1, { weaponIds: [], skillIds: ["roar"] });
    const context = makeContext({ selected: actor, skills });

    const first = makeActions();
    handleBattleKey(press("1"), context, first.actions);
    expect(first.calls).toEqual([{ name: "armSkill", args: [{ type: "skill", id: "roar" }] }]);

    const second = makeActions();
    handleBattleKey(press("1"), { ...context, action: { type: "skill", id: "roar" } }, second.actions);
    expect(second.calls).toEqual([{ name: "applySelfSkill", args: ["roar"] }]);
  });

  it("ignores a skill on cooldown and one spent for the battle", () => {
    const skills = { roar: { category: "self", maxUsesPerBattle: 1 } as unknown as SkillStats };
    const onCooldown = makeActions();
    handleBattleKey(
      press("1"),
      makeContext({
        selected: makeEntity(1, { weaponIds: [], skillIds: ["roar"], skillCooldowns: { roar: 2 } }),
        skills,
      }),
      onCooldown.actions,
    );
    expect(names(onCooldown.calls), "перезарядка").toEqual([]);

    const spent = makeActions();
    handleBattleKey(
      press("1"),
      makeContext({ selected: makeEntity(1, { weaponIds: [], skillIds: ["roar"], skillUses: { roar: 1 } }), skills }),
      spent.actions,
    );
    expect(names(spent.calls), "исчерпано").toEqual([]);
  });

  it("follows the training directive: only the prescribed weapon passes", () => {
    const directive = {
      kind: "attack",
      actorId: 1,
      weaponId: "sword",
    } as unknown as BattleKeyContext["trainingDirective"];
    const allowed = makeActions();
    handleBattleKey(press("1"), makeContext({ isTraining: true, trainingDirective: directive }), allowed.actions);
    expect(names(allowed.calls), "предписанное оружие").toEqual(["toggleAction"]);

    const forbidden = makeActions();
    handleBattleKey(
      press("2"),
      makeContext({
        isTraining: true,
        trainingDirective: directive,
        selected: makeEntity(1, { weaponIds: ["sword", "club"] }),
      }),
      forbidden.actions,
    );
    expect(names(forbidden.calls), "другое оружие").toEqual([]);
  });

  it("pans the field with arrows and WASD", () => {
    const cases: [string, unknown[]][] = [
      ["ArrowLeft", [28, 0]],
      ["a", [28, 0]],
      ["ArrowRight", [-28, 0]],
      ["d", [-28, 0]],
      ["ArrowUp", [0, 28]],
      ["w", [0, 28]],
      ["ArrowDown", [0, -28]],
      ["S", [0, -28]],
    ];
    for (const [key, args] of cases) {
      const { actions, calls } = makeActions();
      handleBattleKey(press(key), makeContext(), actions);
      expect(calls, `клавиша ${key}`).toEqual([{ name: "pan", args }]);
    }
  });
});
