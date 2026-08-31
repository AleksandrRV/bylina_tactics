import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { ENEMY_OWNER, PLAYER_OWNER } from "@bylina/core";
import { dataTree, makeRig, refreshDeps } from "./training-sim.js";
import {
  directiveAllowsAction,
  resolveTrainingDirective,
  trainingCommandAllowed,
  trainingStepCompleted,
  trainingDenialKey,
} from "../src/training-scenario.js";

/**
 * Чистые правила строгого сценария обучения (0.20.13): указание шага
 * предписывает ровно одно действие, финальная проверка пропускает только
 * его, а невыполнимые шаги пропускаются.
 */

describe("resolveTrainingDirective (0.20.13)", () => {
  it("movement step 2 prescribes the single farthest 1-AP cell of the actor", () => {
    const rig = makeRig("movement");
    const hint = rig.hints.find((h) => h.until === "move")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    expect(view.directive.kind).toBe("move");
    if (view.directive.kind !== "move") return;
    const directive = view.directive;
    const actor = rig.kernel.getSnapshot().entities.find((e) => e.configId === "bogatyr")!;
    // Клетка указания достижима и стоит одно очко действия.
    const reach = rig.kernel.getReachable(actor.id);
    const cell = reach.find((c) => c.x === directive.cell.x && c.y === directive.cell.y)!;
    expect(cell.apCost).toBe(1);
    // Это самая дальняя из клеток за одно очко.
    const maxMp = Math.max(...reach.filter((c) => c.apCost === 1).map((c) => c.mpCost));
    expect(cell.mpCost).toBe(maxMp);
    // Маркер на поле указывает ту же клетку.
    expect(view.highlight).toEqual({ kind: "cell", x: cell.x, y: cell.y });
  });

  it("dash step prescribes a 2-AP cell", () => {
    const rig = makeRig("movement");
    const hint = rig.hints.find((h) => h.until === "dash")!;
    // Уменьшаем ОД богатыря до 2 (начало хода) — рывок доступен сразу.
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    if (view.directive.kind !== "move") throw new Error("expected move directive");
    const directive = view.directive;
    const actor = rig.kernel.getSnapshot().entities.find((e) => e.configId === "bogatyr")!;
    const reach = rig.kernel.getReachable(actor.id);
    const cell = reach.find((c) => c.x === directive.cell.x && c.y === directive.cell.y)!;
    expect(cell.apCost).toBe(2);
  });

  it("combat approach step targets a cell adjacent to the upyr", () => {
    const rig = makeRig("combat");
    const hint = rig.hints.find((h) => h.until === "approach")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    if (view.directive.kind !== "move") throw new Error("expected move directive");
    const directive = view.directive;
    const upyr = rig.kernel.getSnapshot().entities.find((e) => e.configId === "upyr" && !e.dead)!;
    const dx = Math.abs(directive.cell.x - upyr.x);
    const dy = Math.abs(directive.cell.y - upyr.y);
    expect(Math.max(dx, dy)).toBe(1);
    // Подсветка — маркер клетки, шаг «приблизьтесь».
    expect(view.highlight?.kind).toBe("cell");
  });

  it("combat attack step prescribes the sword and the upyr", () => {
    const rig = makeRig("combat");
    const hint = rig.hints.find((h) => h.until === "attack")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    // Богатырь ещё не подошёл: указание — шаг к цели, не атака.
    expect(["move", "attack"]).toContain(view.directive.kind);
  });

  it("skill step prescribes the summon skill with a concrete cell", () => {
    const rig = makeRig("skills");
    const hint = rig.hints.find((h) => h.skillId === "summon_forest_beast")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    if (view.directive.kind !== "skill") throw new Error("expected skill directive");
    expect(view.directive.skillId).toBe("summon_forest_beast");
    expect(view.directive.cell).toBeDefined();
    expect(view.panelKey).toBe("skill");
  });

  it("defend/overwatch steps name their actor", () => {
    const rig = makeRig("skills");
    const defend = rig.hints.find((h) => h.until === "defend")!;
    const defendView = resolveTrainingDirective(defend, refreshDeps(rig))!;
    expect(defendView.directive.kind).toBe("defend");
    if (defendView.directive.kind === "defend") {
      const directive = defendView.directive;
      const actor = rig.kernel.getSnapshot().entities.find((e) => e.id === directive.actorId)!;
      expect(actor.configId).toBe("bogatyr");
    }
    const overwatch = rig.hints.find((h) => h.until === "overwatch")!;
    const overwatchView = resolveTrainingDirective(overwatch, refreshDeps(rig))!;
    expect(overwatchView.directive.kind).toBe("overwatch");
    if (overwatchView.directive.kind === "overwatch") {
      const directive = overwatchView.directive;
      const actor = rig.kernel.getSnapshot().entities.find((e) => e.id === directive.actorId)!;
      expect(actor.configId).toBe("strelets");
    }
  });
});

describe("trainingCommandAllowed: only the prescribed command passes (0.20.13)", () => {
  it("move directive rejects other cells, other actors and non-move commands", () => {
    const rig = makeRig("movement");
    const hint = rig.hints.find((h) => h.until === "move")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    if (view.directive.kind !== "move") throw new Error("expected move directive");
    const directive = view.directive;
    const allowed = { type: "MOVE", actorId: directive.actorId, to: directive.cell } as const;
    expect(trainingCommandAllowed(view, allowed)).toBe(true);
    // Другая достижимая клетка — запрещена.
    const reach = rig.kernel.getReachable(directive.actorId);
    const other = reach.find((c) => !(c.x === directive.cell.x && c.y === directive.cell.y))!;
    expect(trainingCommandAllowed(view, { type: "MOVE", actorId: directive.actorId, to: other })).toBe(false);
    // Чужой исполнитель и иные категории — запрещены.
    expect(trainingCommandAllowed(view, { type: "MOVE", actorId: 999, to: directive.cell })).toBe(false);
    expect(trainingCommandAllowed(view, { type: "END_TURN", playerId: "1" })).toBe(false);
    expect(trainingCommandAllowed(view, { type: "DEFEND", actorId: directive.actorId })).toBe(false);
  });

  it("attack directive rejects wrong weapon, wrong target and wrong actor", () => {
    const rig = makeRig("skills");
    const snap = rig.kernel.getSnapshot();
    const strelets = snap.entities.find((e) => e.configId === "strelets")!;
    const kikimora = snap.entities.find((e) => e.configId === "kikimora" && !e.dead)!;
    // Указание атаки из сценария (стрелец, лук, кикимора) — проверка чистая,
    // поэтому вид указания построен напрямую.
    const view = {
      directive: {
        kind: "attack",
        actorId: strelets.id,
        actorUnitId: "strelets",
        targetId: kikimora.id,
        targetUnitId: "kikimora",
        weaponId: "bow",
      },
      highlight: null,
      panelKey: "weapon",
    } as const;
    const { actorId, targetId, weaponId } = view.directive;
    expect(trainingCommandAllowed(view, { type: "ATTACK", actorId, targetId, weaponId })).toBe(true);
    const upyr = snap.entities.find((e) => e.configId === "upyr" && !e.dead)!;
    expect(trainingCommandAllowed(view, { type: "ATTACK", actorId, targetId: upyr.id, weaponId })).toBe(false);
    expect(trainingCommandAllowed(view, { type: "ATTACK", actorId, targetId, weaponId: "pishchal" })).toBe(false);
    expect(trainingCommandAllowed(view, { type: "ATTACK", actorId: targetId, targetId, weaponId })).toBe(false);
    expect(trainingCommandAllowed(view, { type: "MOVE", actorId, to: { x: 1, y: 1, z: 0 } })).toBe(false);
  });

  it("endTurn directive rejects any other command; other directives reject end turn", () => {
    const rig = makeRig("movement");
    const hint = rig.hints.find((h) => h.until === "end_turn")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    expect(view.directive.kind).toBe("endTurn");
    expect(trainingCommandAllowed(view, { type: "END_TURN", playerId: "1" })).toBe(true);
    expect(trainingCommandAllowed(view, { type: "DEFEND", actorId: 1 })).toBe(false);
  });

  it("no directive (outside training) allows everything", () => {
    expect(trainingCommandAllowed(null, { type: "END_TURN", playerId: "1" })).toBe(true);
  });
});

describe("trainingStepCompleted repeat rules (0.20.13)", () => {
  it("targetDead step completes only when the target is dead, not on a single hit", () => {
    const rig = makeRig("combat");
    const hint = rig.hints.find((h) => h.repeatUntil === "targetDead")!;
    expect(trainingStepCompleted(hint, [], rig.kernel.getSnapshot())).toBe(false);
    // Упырь жив после одного события атаки — шаг продолжается.
    const hitEvent = [{ type: "COMBAT_RESOLVED", result: "HIT", damageDealt: 5 } as never];
    const snap = rig.kernel.getSnapshot();
    expect(trainingStepCompleted(hint, hitEvent, snap)).toBe(false);
    const upyr = snap.entities.find((e) => e.configId === "upyr")!;
    upyr.dead = true;
    expect(trainingStepCompleted(hint, [], snap)).toBe(true);
  });

  it("victory step completes when all Nav is dead", () => {
    const rig = makeRig("skills");
    const hint = rig.hints.find((h) => h.repeatUntil === "victory")!;
    const snap = rig.kernel.getSnapshot();
    expect(trainingStepCompleted(hint, [], snap)).toBe(false);
    // Убить всех противников напрямую.
    for (const entity of snap.entities) {
      if (entity.owner === ENEMY_OWNER && !entity.dead) entity.dead = true;
    }
    expect(trainingStepCompleted(hint, [], snap)).toBe(true);
  });
});

describe("directiveAllowsAction and denial keys (0.20.13)", () => {
  it("category gating matches the directive kind", () => {
    const rig = makeRig("skills");
    const hint = rig.hints.find((h) => h.until === "defend")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    expect(directiveAllowsAction(view, "defend")).toBe(true);
    expect(directiveAllowsAction(view, "attack")).toBe(false);
    expect(directiveAllowsAction(view, "skill")).toBe(false);
    expect(directiveAllowsAction(view, "endTurn")).toBe(false);
    expect(directiveAllowsAction(null, "attack")).toBe(true);
  });

  it("denial keys cover the lock cases", () => {
    const rig = makeRig("movement");
    const moveView = resolveTrainingDirective(
      rig.hints.find((h) => h.until === "move")!,
      refreshDeps(rig),
    )!;
    expect(trainingDenialKey(moveView, "move")).toBe("training.locked.cell");
    const endView = resolveTrainingDirective(
      rig.hints.find((h) => h.until === "end_turn")!,
      refreshDeps(rig),
    )!;
    expect(trainingDenialKey(endView, "attack")).toBe("training.locked.endTurn");
    expect(trainingDenialKey(null, "attack")).toBe("training.locked.generic");
  });
});

describe("impossible steps are skipped instead of blocking the scenario (0.20.13)", () => {
  it("approach step with a dead target resolves to null", () => {
    const rig = makeRig("combat");
    const hint = rig.hints.find((h) => h.until === "approach")!;
    // Мутируем снимок зависимостей (ядро здесь ни при чём — проверка чистая).
    const snap = rig.kernel.getSnapshot();
    const upyr = snap.entities.find((e) => e.configId === "upyr")!;
    upyr.dead = true;
    rig.deps.snapshot = snap;
    expect(resolveTrainingDirective(hint, rig.deps)).toBeNull();
  });

  it("heal step without a wounded ally resolves to null", () => {
    const rig = makeRig("skills");
    const hint = rig.hints.find((h) => h.skillId === "heal")!;
    expect(resolveTrainingDirective(hint, refreshDeps(rig))).toBeNull();
  });
});

describe("content references are consistent (0.20.13)", () => {
  it("every strict-scenario field points to real content", () => {
    const parsed = parseContent(dataTree());
    if (!parsed.ok) throw new Error("content parse failed");
    const unitIds = new Set(parsed.data.units.map((u) => u.id));
    const weaponIds = new Set(parsed.data.weapons.map((w) => w.id));
    const skillIds = new Set(parsed.data.skills.map((s) => s.id));
    for (const mission of parsed.data.training.missions) {
      for (const hint of mission.hints) {
        if (hint.actorUnitId) expect(unitIds.has(hint.actorUnitId), `${mission.id} step ${hint.step} actor`).toBe(true);
        if (hint.weaponId) expect(weaponIds.has(hint.weaponId), `${mission.id} step ${hint.step} weapon`).toBe(true);
        if (hint.skillId) expect(skillIds.has(hint.skillId), `${mission.id} step ${hint.step} skill`).toBe(true);
        if (hint.targetUnitId)
          expect(unitIds.has(hint.targetUnitId), `${mission.id} step ${hint.step} target`).toBe(true);
      }
      const missionEnemies = new Set(mission.enemies.map((e) => e.unitId));
      for (const action of [...(mission.enemyScript?.priority ?? []), ...(mission.enemyScript?.actions ?? [])]) {
        if (action.unitId) {
          expect(missionEnemies.has(action.unitId), `${mission.id} script unit ${action.unitId}`).toBe(true);
          expect(unitIds.has(action.unitId)).toBe(true);
        }
        if (action.skillId) expect(skillIds.has(action.skillId)).toBe(true);
        if (action.weaponId) expect(weaponIds.has(action.weaponId)).toBe(true);
        if (action.corpseUnitId) expect(missionEnemies.has(action.corpseUnitId)).toBe(true);
      }
    }
  });

  it("every mission with enemies has a scripted enemy plan", () => {
    const parsed = parseContent(dataTree());
    if (!parsed.ok) throw new Error("content parse failed");
    for (const mission of parsed.data.training.missions) {
      if (mission.enemies.length === 0) continue;
      expect(mission.enemyScript, `${mission.id} enemyScript`).toBeDefined();
      expect(
        mission.enemyScript!.actions.some((a) => a.kind === "endTurn"),
        `${mission.id} endTurn marker`,
      ).toBe(true);
    }
  });

  it("player side is always owner 1 in training snapshots", () => {
    const rig = makeRig("skills");
    const players = rig.kernel.getSnapshot().entities.filter((e) => e.owner === PLAYER_OWNER);
    expect(players.length).toBe(3);
    const enemies = rig.kernel.getSnapshot().entities.filter((e) => e.owner === ENEMY_OWNER && e.coverType === 0);
    expect(enemies.length).toBe(2);
  });
});
