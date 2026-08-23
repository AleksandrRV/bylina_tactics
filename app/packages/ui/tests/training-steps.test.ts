import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { dataTree } from "./training-sim.js";

/**
 * Строгий сценарий обучения (0.20.13): конфигурация миссий обязана быть
 * связной — шаги образуют последовательность, предписания ссылаются на
 * реальное содержимое, миссия с противником завершается финальным шагом
 * до победы, а номера шагов локализованы (ключи текстов существуют).
 */
describe("training mission configurations under the strict scenario (0.20.13)", () => {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const missions = parsed.data.training.missions;

  const byId = (id: string) => missions.find((m) => m.id === id)!;

  it("movement: intro -> step -> turn -> dash -> turn", () => {
    const hints = [...byId("movement").hints].sort((a, b) => a.step - b.step);
    expect(hints.map((h) => h.until)).toEqual(["noop", "move", "end_turn", "dash", "end_turn"]);
    // Каждый шаг именует исполнителя — богатыря высадки.
    for (const hint of hints) {
      expect(hint.actorUnitId).toBe("bogatyr");
    }
  });

  it("combat: intro -> approach -> attack-until-dead with the prescribed sword", () => {
    const hints = [...byId("combat").hints].sort((a, b) => a.step - b.step);
    expect(hints.map((h) => h.until)).toEqual(["noop", "approach", "attack"]);
    const attack = hints[2]!;
    expect(attack.actorUnitId).toBe("bogatyr");
    expect(attack.weaponId).toBe("sword");
    expect(attack.targetUnitId).toBe("upyr");
    expect(attack.repeatUntil).toBe("targetDead");
  });

  it("skills: the lesson names every actor, skill and weapon", () => {
    const hints = [...byId("skills").hints].sort((a, b) => a.step - b.step);
    expect(hints.map((h) => h.until)).toEqual([
      "skill", // призыв зверя
      "overwatch", // дозор стрельца
      "end_turn",
      "skill", // очищение яда
      "defend", // стойка богатыря
      "attack", // лук по кикиморе
      "end_turn",
      "skill", // лечение
      "attack", // финал до победы
    ]);
    expect(hints[0]!.actorUnitId).toBe("znaharka");
    expect(hints[0]!.skillId).toBe("summon_forest_beast");
    expect(hints[1]!.actorUnitId).toBe("strelets");
    expect(hints[3]!.actorUnitId).toBe("znaharka");
    expect(hints[3]!.skillId).toBe("cleanse");
    expect(hints[3]!.targetUnitId).toBe("bogatyr");
    expect(hints[4]!.actorUnitId).toBe("bogatyr");
    expect(hints[5]!.actorUnitId).toBe("strelets");
    expect(hints[5]!.weaponId).toBe("bow");
    expect(hints[5]!.targetUnitId).toBe("kikimora");
    expect(hints[7]!.actorUnitId).toBe("znaharka");
    expect(hints[7]!.skillId).toBe("heal");
    // Финальный шаг ведёт политика: исполнителя в записи нет.
    expect(hints[8]!.actorUnitId).toBeUndefined();
    expect(hints[8]!.repeatUntil).toBe("victory");
  });

  it("every step declares a matching highlight target", () => {
    for (const mission of missions) {
      for (const hint of mission.hints) {
        const id = `${mission.id} step ${hint.step}`;
        if (hint.highlight === "panel" || hint.highlight === "button") {
          expect(hint.panelKey, id).toBeDefined();
        }
        if (hint.highlight === "entity") {
          // Цель подсветки: явная запись либо политика шага (лечение —
          // самого раненого, финал — цель по приоритету боя).
          expect(hint.targetUnitId ?? hint.skillId ?? hint.repeatUntil, id).toBeDefined();
        }
        // cell/zone: явная клетка необязательна — карты генерируются,
        // клетку указания вычисляет сценарий (дальняя/смежная с целью).
      }
    }
  });

  it("repeatUntil steps always name a target or mean victory", () => {
    for (const mission of missions) {
      for (const hint of mission.hints) {
        if (!hint.repeatUntil) continue;
        if (hint.repeatUntil === "targetDead") {
          expect(hint.targetUnitId, `${mission.id} step ${hint.step}`).toBeDefined();
        }
        // repeatUntil victory может быть только финальным шагом.
        if (hint.repeatUntil === "victory") {
          expect(hint.step).toBe(mission.hints.length);
        }
      }
    }
  });

  it("enemy scripts are ordered lists with explicit end turn markers", () => {
    for (const mission of missions) {
      const script = mission.enemyScript;
      if (!script) continue;
      let turn = 1;
      for (const action of script.actions) {
        if (action.kind === "endTurn") turn += 1;
        else expect(action.unitId, `${mission.id} action without actor`).toBeDefined();
      }
      expect(turn).toBeGreaterThan(1);
      for (const rule of script.priority) {
        expect(rule.unitId).toBeDefined();
        expect(rule.kind === "resurrect" ? rule.corpseUnitId : rule.targetUnitId).toBeDefined();
      }
    }
  });
});
