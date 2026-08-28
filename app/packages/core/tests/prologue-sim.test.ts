import { describe, expect, it } from "vitest";
import {
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  afterPrologueApply,
  compilePrologueLayout,
  gatePrologueCommand,
  weaponStatsFromRecord,
  type SpawnUnitConfig,
} from "../src/index.js";

const MIKULA: SpawnUnitConfig = {
  id: "mikula_peasant",
  maxHealth: 8,
  maxAP: 2,
  mobility: 5,
  aim: 60,
  defense: 0,
  vision: 10,
  weapons: [],
};
const RAT: SpawnUnitConfig = {
  id: "forest_rat",
  maxHealth: 4,
  maxAP: 2,
  mobility: 6,
  aim: 50,
  defense: 0,
  vision: 10,
  weapons: ["teeth"],
};
const FEDOT: SpawnUnitConfig = {
  id: "fedot_stranded",
  maxHealth: 5,
  maxAP: 2,
  mobility: 4,
  aim: 40,
  defense: 0,
  vision: 8,
  weapons: [],
  skills: ["evacuate"],
};

const CLUB = weaponStatsFromRecord({
  id: "club", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false,
  aimMod: 0, minDmg: 3, maxDmg: 5, crit: 10, critBonus: 1, envDmg: 0,
});
const TEETH = weaponStatsFromRecord({
  id: "teeth", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false,
  aimMod: 0, minDmg: 2, maxDmg: 3, crit: 10, critBonus: 1, envDmg: 0,
});

const M1_LAYOUT = {
  rows: [
    "....................",
    "....t.....t......t..",
    "..................F.",
    ".M..t..........t...S",
    "....................",
    "....t.....t......t..",
  ],
  legend: {
    M: { kind: "spawn", side: "player", unitId: "mikula_peasant" },
    S: { kind: "pickup", itemId: "stick", weaponId: "club" },
    F: { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
  },
};

describe("prologue M1 sim", () => {
  it("has no enemies before pickup and dash cannot reach the stick", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT, units: [MIKULA, RAT], seed: 701 });
    expect(match.entities.some((entity) => entity.configId === "forest_rat")).toBe(false);
    expect(match.entities.some((entity) => entity.configId === "stick")).toBe(true);
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const mikula = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    const stick = kernel.getSnapshot().entities.find((entity) => entity.configId === "stick")!;
    const reachable = kernel.getReachable(mikula.id);
    expect(reachable.some((cell) => cell.x === stick.x && cell.y === stick.y)).toBe(false);
  });

  it("arms the club on pickup and spawns a rat", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const compiled = compilePrologueLayout(M1_LAYOUT);
    const stick = compiled.markers.S![0]!;
    const snap = kernel.getSnapshot();
    const actor = snap.entities.find((entity) => entity.configId === "mikula_peasant")!;
    actor.x = stick.x;
    actor.y = stick.y;
    kernel.restoreMatch(snap, kernel.getFog());
    let state = createPrologueRunState("prologue_brushwood");
    const moved = kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(moved.ok).toBe(true);
    const actor2 = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    const near = kernel.getReachable(actor2.id).find((cell) => cell.apCost === 1) ?? kernel.getReachable(actor2.id)[0];
    expect(near).toBeTruthy();
    const applied = kernel.apply({ type: "MOVE", actorId: actor2.id, to: near! });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      state = afterPrologueApply(kernel, { type: "MOVE", actorId: actor2.id, to: near! }, applied.events, state, {
        missionId: "prologue_brushwood",
        hints: [],
        showHints: true,
        ratMarker: compiled.markers.F![0],
      });
    }
    // Stand on the stick explicitly.
    const placed = kernel.getSnapshot();
    const mik = placed.entities.find((entity) => entity.configId === "mikula_peasant")!;
    mik.x = stick.x;
    mik.y = stick.y;
    kernel.restoreMatch(placed, kernel.getFog());
    state = afterPrologueApply(kernel, { type: "MOVE", actorId: mik.id, to: { x: stick.x, y: stick.y, z: 1 } }, [{ type: "ENTITY_MOVED", entityId: mik.id, path: [{ x: stick.x, y: stick.y, z: 1 }], isDash: false, apSpent: 1 }], state, {
      missionId: "prologue_brushwood",
      hints: [],
      showHints: true,
      ratMarker: compiled.markers.F![0],
    });
    const after = kernel.getSnapshot();
    const armed = after.entities.find((entity) => entity.configId === "mikula_peasant")!;
    expect(armed.weaponIds).toContain("club");
    expect(after.entities.some((entity) => entity.configId === "stick")).toBe(false);
    expect(after.entities.some((entity) => entity.configId === "forest_rat" && !entity.dead)).toBe(true);
    expect(state.pickupDone).toBe(true);
  });
});

describe("prologue M2 gate", () => {
  it("forces defend after the first move", () => {
    const layout = {
      rows: [
        "Ett.....ttt.",
        "E...........",
        "E.M.........",
        "............",
        ".........F..",
        "............",
        "E........V..",
        "E...........",
        "Ett.....ttt.",
      ],
      legend: {
        M: { kind: "spawn", side: "player", unitId: "mikula_peasant" },
        V: { kind: "stranded", unitId: "fedot_stranded", state: "immobile" },
        F: { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
      },
    };
    const match = createPrologueMatch({ layout, units: [MIKULA, FEDOT, RAT], seed: 702, hideExtract: true });
    expect(match.grid.tiles.every((tile) => !tile.extract)).toBe(true);
    const fedot = match.entities.find((entity) => entity.configId === "fedot_stranded")!;
    expect(fedot.immobileTurns).toBeGreaterThan(0);
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, FEDOT, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 702,
      fogDisabled: true,
    });
    let state = createPrologueRunState("prologue_cry");
    const mikula = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    const step = kernel.getReachable(mikula.id)[0]!;
    const applied = kernel.apply({ type: "MOVE", actorId: mikula.id, to: step });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      state = afterPrologueApply(kernel, { type: "MOVE", actorId: mikula.id, to: step }, applied.events, state, {
        missionId: "prologue_cry",
        hints: [{ key: "m2.noise", textKey: "prologue.hint.m2.noise", once: true, forced: true, panelKey: "defend" }],
        showHints: true,
      });
    }
    expect(state.forceDefend).toBe(true);
    expect(gatePrologueCommand(state, { type: "ATTACK", actorId: mikula.id, targetId: 2, weaponId: "club" })).toBe(false);
    expect(gatePrologueCommand(state, { type: "DEFEND", actorId: mikula.id })).toBe(true);
  });
});
