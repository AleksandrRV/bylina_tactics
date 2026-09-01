/**
 * День 16 (0.21.15, P1-2 часть 1): переходы намерения игрока.
 *
 * Намерение — размеченное объединение `Intent`, переходы считает чистая
 * `nextIntent`. Здесь проверяются в первую очередь инварианты, которые
 * раньше ничем не охранялись: прицеливание невозможно без выбранного
 * бойца, заряженный рывок всегда имеет план и действие, а увод мыши
 * снимает только наведённый (не подтверждённый) рывок.
 */
import { describe, expect, it } from "vitest";
import type { CellPos } from "@bylina/core";
import { IDLE_INTENT, nextIntent, type Intent, type IntentEvent } from "../src/battle-intent.js";
import type { ChargePlan } from "../src/charge-attack.js";

const weapon = { type: "weapon", id: "sword" } as const;
const skill = { type: "skill", id: "leap" } as const;
const pos: CellPos = { x: 3, y: 4, z: 0 };

/** Минимальный план рывка — поля трассировки не важны для переходов. */
function plan(targetId: number): ChargePlan {
  return { targetId, step: { x: 1, y: 1, z: 0 }, path: [], mpCost: 2, apCost: 1 as const };
}

function reduce(intent: Intent, events: IntentEvent[]): Intent {
  return events.reduce<Intent>(nextIntent, intent);
}

describe("nextIntent: базовые фазы", () => {
  it("idle: выбор бойца переводит в selected", () => {
    expect(nextIntent(IDLE_INTENT, { type: "select", actorId: 7 })).toEqual({ kind: "selected", actorId: 7 });
  });

  it("reset и clearSelection из любой фазы возвращают idle", () => {
    const aiming = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
    ]);
    expect(nextIntent(aiming, { type: "reset" })).toEqual({ kind: "idle" });
    expect(nextIntent(aiming, { type: "clearSelection" })).toEqual({ kind: "idle" });
  });

  it("cancel снимает прицел, но оставляет выбранного бойца", () => {
    const aiming = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
    ]);
    expect(nextIntent(aiming, { type: "cancel" })).toEqual({ kind: "selected", actorId: 1 });
  });
});

describe("nextIntent: инвариант «прицел без выбранного бойца невозможен»", () => {
  it("armAction из idle ничего не меняет", () => {
    expect(nextIntent(IDLE_INTENT, { type: "armAction", action: weapon, targetId: 2 })).toBe(IDLE_INTENT);
  });

  it("aim из idle ничего не меняет", () => {
    expect(nextIntent(IDLE_INTENT, { type: "aim", targetId: 2, chargePlan: null, armed: false, targetPos: null })).toBe(
      IDLE_INTENT,
    );
  });

  it("toggleAction из idle не создаёт прицела", () => {
    expect(nextIntent(IDLE_INTENT, { type: "toggleAction", actorId: 1, action: weapon })).toBe(IDLE_INTENT);
  });

  it("previewMove из idle ничего не меняет", () => {
    expect(nextIntent(IDLE_INTENT, { type: "previewMove", key: "2,3" })).toBe(IDLE_INTENT);
  });
});

describe("nextIntent: прицеливание и действие", () => {
  it("armAction без цели вооружает действие с targetId null", () => {
    const selected = nextIntent(IDLE_INTENT, { type: "select", actorId: 1 });
    expect(nextIntent(selected, { type: "armAction", action: weapon, targetId: null })).toEqual({
      kind: "aiming",
      actorId: 1,
      action: weapon,
      targetId: null,
      targetPos: null,
      preview: null,
    });
  });

  it("armAction из selected вооружает действие и запоминает цель", () => {
    const selected = nextIntent(IDLE_INTENT, { type: "select", actorId: 1 });
    expect(nextIntent(selected, { type: "armAction", action: weapon, targetId: 2 })).toEqual({
      kind: "aiming",
      actorId: 1,
      action: weapon,
      targetId: 2,
      targetPos: null,
      preview: null,
    });
  });

  it("toggleAction с действием переводит в aiming без цели", () => {
    const selected = nextIntent(IDLE_INTENT, { type: "select", actorId: 1 });
    expect(nextIntent(selected, { type: "toggleAction", actorId: 1, action: skill })).toEqual({
      kind: "aiming",
      actorId: 1,
      action: skill,
      targetId: null,
      targetPos: null,
      preview: null,
    });
  });

  it("toggleAction с null выключает действие, оставляя бойца выбранным", () => {
    const aiming = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "toggleAction", actorId: 1, action: skill },
    ]);
    expect(nextIntent(aiming, { type: "toggleAction", actorId: 1, action: null })).toEqual({
      kind: "selected",
      actorId: 1,
    });
  });

  it("positionSkill запоминает клетку только в фазе прицела", () => {
    const aiming = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "toggleAction", actorId: 1, action: skill },
    ]);
    const placed = nextIntent(aiming, { type: "positionSkill", pos });
    expect(placed).toMatchObject({ kind: "aiming", targetPos: pos, preview: null });
    // В selected постановка клетки игнорируется.
    const selected = nextIntent(IDLE_INTENT, { type: "select", actorId: 1 });
    expect(nextIntent(selected, { type: "positionSkill", pos })).toEqual({ kind: "selected", actorId: 1 });
  });

  it("цель-боец в aiming заменяется событием aim без плана рывка", () => {
    const aiming = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
    ]);
    const reaimed = nextIntent(aiming, { type: "aim", targetId: 3, chargePlan: null, armed: false, targetPos: null });
    expect(reaimed).toMatchObject({ kind: "aiming", targetId: 3, action: weapon });
  });
});

describe("nextIntent: рывок (charge)", () => {
  it("aim с планом переводит в charging; план и действие всегда присутствуют", () => {
    const state = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
      { type: "aim", targetId: 2, chargePlan: plan(2), armed: true, targetPos: null },
    ]);
    expect(state.kind).toBe("charging");
    if (state.kind === "charging") {
      expect(state.plan).toEqual(plan(2));
      expect(state.armed).toBe(true);
      expect(state.action).toEqual(weapon);
      expect(state.targetId).toBe(2);
    }
  });

  it("инвариант: заряженный рывок всегда несёт план — это проверяет тип", () => {
    // Компиляционная страховка: у charging нет варианта без plan.
    const state: Intent = {
      kind: "charging",
      actorId: 1,
      action: weapon,
      targetId: 2,
      plan: plan(2),
      armed: false,
    };
    expect(state.kind === "charging" ? state.plan.apCost : 0).toBe(1);
  });

  it("hoverLeave снимает только наведённый (armed=false) рывок", () => {
    const hovered = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
      { type: "aim", targetId: 2, chargePlan: plan(2), armed: false, targetPos: null },
    ]);
    const afterLeave = nextIntent(hovered, { type: "hoverLeave" });
    expect(afterLeave).toMatchObject({ kind: "aiming", targetId: 2 });

    // Подтверждённый рывок увод мыши не трогает.
    const armed = nextIntent(hovered, { type: "aim", targetId: 2, chargePlan: plan(2), armed: true, targetPos: null });
    expect(nextIntent(armed, { type: "hoverLeave" })).toBe(armed);
  });

  it("previewMove не сбивает заряженный рывок", () => {
    const charging = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
      { type: "aim", targetId: 2, chargePlan: plan(2), armed: true, targetPos: null },
    ]);
    expect(nextIntent(charging, { type: "previewMove", key: "5,5" })).toBe(charging);
  });
});

describe("nextIntent: предпросмотр шага", () => {
  it("наведение на достижимую клетку из selected переводит в placing", () => {
    const selected = nextIntent(IDLE_INTENT, { type: "select", actorId: 1 });
    expect(nextIntent(selected, { type: "previewMove", key: "2,3" })).toEqual({
      kind: "placing",
      actorId: 1,
      preview: "2,3",
    });
  });

  it("previewMove в aiming с незаполненной целью показывает путь и снимает цель", () => {
    const aiming = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
    ]);
    const preview = nextIntent(aiming, { type: "previewMove", key: "4,4" });
    expect(preview).toMatchObject({ kind: "aiming", preview: "4,4", targetId: null });
  });
});

describe("nextIntent: типовой сценарий боя", () => {
  it("выбор → оружие → рывок → отмена возвращает к выбранному бойцу", () => {
    const state = reduce(IDLE_INTENT, [
      { type: "select", actorId: 1 },
      { type: "armAction", action: weapon, targetId: 2 },
      { type: "aim", targetId: 2, chargePlan: plan(2), armed: true, targetPos: null },
      { type: "cancel" },
    ]);
    expect(state).toEqual({ kind: "selected", actorId: 1 });
  });

  it("функция чистая: одинаковый вход даёт одинаковый результат и не мутирует вход", () => {
    const start = nextIntent(IDLE_INTENT, { type: "select", actorId: 9 });
    const event: IntentEvent = { type: "armAction", action: weapon, targetId: 3 };
    const a = nextIntent(start, event);
    const b = nextIntent(start, event);
    expect(a).toEqual(b);
    expect(start).toEqual({ kind: "selected", actorId: 9 });
  });
});
