import { describe, expect, it } from "vitest";
import { ENEMY_OWNER, PLAYER_OWNER, matchOutcome, pickScriptedEnemyCommand } from "@bylina/core";
import { commandFromDirective, makeRig, refreshDeps, runMission, reachableOf } from "./training-sim.js";
import {
  resolveTrainingDirective,
  trainingCommandAllowed,
} from "../src/training-scenario.js";
import { shouldAutoEndTurn } from "../src/training-progress.js";

/**
 * Правила интерфейса строгого сценария обучения (0.20.13): игрок не может
 * совершить ничего, кроме предписанного шагом («непослушные» команды
 * отклоняет финальная проверка applyCommand), авто-завершение хода не
 * обгоняет урок, а Навь действует строго по сценарию (яд в первый ход,
 * воскрешение упыря при появлении тела).
 */

describe("the scenario gate rejects every non-prescribed action (0.20.13)", () => {
  it("a disobedient player cannot deviate: wrong cells, weapons, targets and turns are rejected", () => {
    let fired = 0;
    const run = runMission("skills", {
      intruder: (rig, view) => {
        // По одному «непослушному» жесту на каждое указание.
        fired += 1;
        if (fired % 2 === 0) return null;
        const d = view.directive;
        const snap = rig.kernel.getSnapshot();
        if (d.kind === "move") {
          const reach = reachableOf(rig.kernel, d.actorId);
          const other = reach.find((c) => !(c.x === d.cell.x && c.y === d.cell.y));
          return other ? { type: "MOVE", actorId: d.actorId, to: other } : null;
        }
        if (d.kind === "attack") {
          // Атака булавой вместо лука/меча по другой цели.
          const wrongTarget = snap.entities.find(
            (e) => !e.dead && e.owner === ENEMY_OWNER && e.id !== d.targetId,
          );
          return wrongTarget
            ? { type: "ATTACK", actorId: d.actorId, targetId: wrongTarget.id, weaponId: "mace" }
            : null;
        }
        if (d.kind === "skill" && d.cell === undefined) {
          // Умение по «не той» цели.
          const wrong = snap.entities.find((e) => !e.dead && e.id !== d.targetId && e.owner === PLAYER_OWNER);
          return wrong && d.targetId !== undefined
            ? { type: "USE_SKILL", actorId: d.actorId, skillId: d.skillId, targetId: wrong.id }
            : null;
        }
        if (d.kind === "move" || d.kind === "defend" || d.kind === "overwatch") return null;
        return { type: "DEFEND", actorId: 1 };
      },
    });
    // Все непослушные команды отклонены, но миссия всё равно доводится
    // до победы указаниями: сценарий невозможно увести с рельсов.
    expect(run.rejected.length).toBeGreaterThan(0);
    expect(run.over).toBe("victory");
  });

  it("an intruder cannot end the turn on a non-endTurn directive", () => {
    const rig = makeRig("movement");
    const hint = rig.hints.find((h) => h.until === "move")!;
    const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
    expect(trainingCommandAllowed(view, { type: "END_TURN", playerId: "1" })).toBe(false);
    expect(trainingCommandAllowed(view, commandFromDirective(view))).toBe(true);
  });

  it("directive commands always pass the gate themselves", () => {
    for (const mission of ["movement", "combat", "skills"] as const) {
      const run = runMission(mission);
      expect(run.over, mission).toBe("victory");
      expect(run.rejected, mission).toEqual([]);
    }
  });
});

describe("auto end turn stays behind the lesson (0.20.6/0.20.13)", () => {
  const base = (activeHint: { until: string } | null, isTraining = true) =>
    shouldAutoEndTurn({
      paused: false,
      busy: false,
      enemyPhase: false,
      isReplay: false,
      isSpectator: false,
      isTraining,
      activeHint: activeHint as never,
      activeOwner: PLAYER_OWNER,
      viewOwner: PLAYER_OWNER,
      ownUnits: [{ ap: 0 }],
      outcomeOngoing: true,
      isNetGuest: false,
    });

  it("never auto-ends while a scenario step is active", () => {
    for (const until of ["move", "dash", "attack", "skill", "defend", "overwatch", "approach", "end_turn", "noop"]) {
      expect(base({ until })).toBe(false);
    }
  });

  it("keeps normal auto-ending after hints are complete and outside training", () => {
    expect(base(null)).toBe(true);
    expect(base({ until: "attack" }, false)).toBe(true);
  });
});

describe("enemy script of the skills mission (0.20.13)", () => {
  it("kikimora poisons the bogatyr on the first Nav turn", () => {
    const rig = makeRig("skills");
    // Игрок пропускает ход — ход Нави по сценарию.
    rig.kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    let poisoned = false;
    for (let guard = 0; guard < 24; guard += 1) {
      const snap = rig.kernel.getSnapshot();
      if (snap.activeOwner !== ENEMY_OWNER) break;
      if (matchOutcome(snap) !== "ongoing") break;
      const decision = pickScriptedEnemyCommand(rig.kernel, rig.mission.enemyScript, { index: 0 });
      const applied = decision.command
        ? rig.kernel.apply(decision.command)
        : rig.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      if (!applied.ok) break;
      if (applied.events.some((e) => e.type === "STATUS_CHANGED" && e.status === "POISON" && e.applied)) {
        poisoned = true;
      }
      if (!decision.command) break;
    }
    expect(poisoned).toBe(true);
    const snap = rig.kernel.getSnapshot();
    const bogatyr = snap.entities.find((e) => e.configId === "bogatyr")!;
    expect(Boolean(bogatyr.poison)).toBe(true);
  });

  it("priority rule raises the upyr once its corpse appears", () => {
    // Прогон миссии до победы: плашка воскрешения обязана сработать.
    const run = runMission("skills");
    expect(run.notes.resurrect).toBeGreaterThan(0);
  });
});
