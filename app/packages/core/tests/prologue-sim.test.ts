import { describe, expect, it } from "vitest";
import {
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  afterPrologueApply,
  compilePrologueLayout,
  gatePrologueCommand,
  shouldRestoreCheckpoint,
  tickProloguePlayerTurn,
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
    expect(gatePrologueCommand(state, { type: "END_TURN", playerId: "1" })).toBe(false);
  });
});

const BOGATYR: SpawnUnitConfig = {
  id: "bogatyr",
  maxHealth: 12,
  maxAP: 2,
  mobility: 4,
  aim: 70,
  defense: 10,
  vision: 10,
  weapons: ["sword"],
};
const UPYR: SpawnUnitConfig = {
  id: "upyr",
  maxHealth: 6,
  maxAP: 2,
  mobility: 4,
  aim: 50,
  defense: 0,
  vision: 8,
  weapons: ["claws"],
};
const STRELETS: SpawnUnitConfig = {
  id: "strelets",
  maxHealth: 8,
  maxAP: 2,
  mobility: 5,
  aim: 70,
  defense: 0,
  vision: 12,
  weapons: ["bow"],
};
const ZNAHARKA: SpawnUnitConfig = {
  id: "znaharka",
  maxHealth: 8,
  maxAP: 2,
  mobility: 4,
  aim: 50,
  defense: 0,
  vision: 10,
  weapons: [],
};

describe("prologue M3 wave", () => {
  it("spawns the second wave and strelets after the first upyr dies", () => {
    const layout = {
      rows: [
        "............",
        "............",
        "............",
        ".M...U......",
        "............",
        "..........A.",
        ".......SS...",
        "............",
        "............",
      ],
      legend: {
        M: { kind: "spawn", side: "player", unitId: "bogatyr" },
        U: { kind: "spawn", side: "enemy", unitId: "upyr" },
        S: { kind: "spawn", side: "enemy", unitId: "upyr", scripted: true },
        A: { kind: "spawn", side: "player", unitId: "strelets", scripted: true },
      },
    };
    const match = createPrologueMatch({ layout, units: [BOGATYR, UPYR, STRELETS], seed: 703 });
    expect(match.entities.filter((entity) => entity.configId === "upyr")).toHaveLength(1);
    expect(match.entities.some((entity) => entity.configId === "strelets")).toBe(false);
    const kernel = createTacticsKernel({
      initial: match,
      units: [BOGATYR, UPYR, STRELETS],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 703,
      fogDisabled: false,
    });
    expect(kernel.getVisibleCells(1).size).toBeGreaterThan(0);
    const compiled = compilePrologueLayout(layout);
    let state = createPrologueRunState("prologue_glade");
    const upyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "upyr")!;
    state = afterPrologueApply(
      kernel,
      { type: "ATTACK", actorId: 1, targetId: upyr.id, weaponId: "sword" },
      [{ type: "ENTITY_DIED", entityId: upyr.id, causeOfDeath: "DAMAGE" }],
      state,
      {
        missionId: "prologue_glade",
        hints: [],
        showHints: true,
        waveCells: compiled.markers.S,
        allyCell: compiled.markers.A?.[0],
      },
    );
    expect(state.firstWave).toBe(true);
    const after = kernel.getSnapshot();
    expect(after.entities.filter((entity) => entity.configId === "upyr" && !entity.dead).length).toBeGreaterThanOrEqual(2);
    const fedot = after.entities.find((entity) => entity.configId === "strelets" && !entity.dead);
    expect(fedot).toBeTruthy();
    expect(fedot?.skillIds ?? []).not.toContain("aimed_eye");
  });
});

describe("prologue M4 vasilisa", () => {
  it("joins on poison or crossing x>=8, not twice", () => {
    const layout = {
      rows: [
        "..............",
        "..............",
        "............z.",
        "M.............",
        "A.............",
        "..............",
        "..............",
        "..............",
        "..............",
      ],
      legend: {
        M: { kind: "spawn", side: "player", unitId: "bogatyr" },
        A: { kind: "spawn", side: "player", unitId: "strelets" },
        z: { kind: "spawn", side: "player", unitId: "znaharka", scripted: true },
      },
    };
    const match = createPrologueMatch({ layout, units: [BOGATYR, STRELETS, ZNAHARKA], seed: 704 });
    expect(match.entities.some((entity) => entity.configId === "znaharka")).toBe(false);
    const kernel = createTacticsKernel({
      initial: match,
      units: [BOGATYR, STRELETS, ZNAHARKA],
      seed: 704,
    });
    const compiled = compilePrologueLayout(layout);
    let state = createPrologueRunState("prologue_village");
    const bogatyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "bogatyr")!;
    state = afterPrologueApply(
      kernel,
      { type: "MOVE", actorId: bogatyr.id, to: { x: 8, y: 3, z: 1 } },
      [{ type: "ENTITY_MOVED", entityId: bogatyr.id, path: [{ x: 0, y: 3, z: 1 }, { x: 8, y: 3, z: 1 }], isDash: false, apSpent: 1 }],
      state,
      { missionId: "prologue_village", hints: [], showHints: true, healerCell: compiled.markers.z?.[0] },
    );
    expect(state.vasilisaJoined).toBe(true);
    expect(kernel.getSnapshot().entities.filter((entity) => entity.configId === "znaharka")).toHaveLength(1);
    state = afterPrologueApply(
      kernel,
      { type: "USE_SKILL", actorId: 2, skillId: "poison_needles", targetId: bogatyr.id },
      [{ type: "STATUS_CHANGED", entityId: bogatyr.id, status: "POISON", applied: true, duration: 2, magnitude: 1, sourceId: 99 }],
      state,
      { missionId: "prologue_village", hints: [], showHints: true, healerCell: compiled.markers.z?.[0] },
    );
    expect(kernel.getSnapshot().entities.filter((entity) => entity.configId === "znaharka")).toHaveLength(1);
  });
});


describe("prologue checkpoint restore", () => {
  it("restores after firstWave, not only fedotFreed", () => {
    const match = {
      turnNumber: 2,
      activeOwner: 1,
      grid: { width: 4, height: 4, tiles: [] },
      entities: [
        { id: 1, configId: "bogatyr", owner: 1, dead: true, coverType: 0, x: 0, y: 0, z: 1, dir: 1, ap: 0, maxAp: 2, mobility: 4, hp: 0, maxHp: 12, aim: 70, defense: 0, vision: 10, weaponId: "sword", obstacle: true, flying: false, overwatch: false, defending: false, movementSpent: 0 },
      ],
    };
    const wave = createPrologueRunState("prologue_glade");
    wave.firstWave = true;
    expect(shouldRestoreCheckpoint(wave, [{ type: "ENTITY_DIED", entityId: 1, causeOfDeath: "DAMAGE" }], match as never)).toBe(true);
    const start = createPrologueRunState("prologue_glade");
    expect(shouldRestoreCheckpoint(start, [{ type: "ENTITY_DIED", entityId: 1, causeOfDeath: "DAMAGE" }], match as never)).toBe(false);
  });
});

describe("prologue player script", () => {
  it("issues a forceHit attack for strelets on the player turn", () => {
    const layout = {
      rows: [".M..", "U...", "..A."],
      legend: {
        M: { kind: "spawn", side: "player", unitId: "bogatyr" },
        U: { kind: "spawn", side: "enemy", unitId: "upyr" },
        A: { kind: "spawn", side: "player", unitId: "strelets", scripted: true },
      },
    };
    const match = createPrologueMatch({ layout, units: [BOGATYR, UPYR, STRELETS], seed: 705 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [BOGATYR, UPYR, STRELETS],
      weapons: { club: CLUB, teeth: TEETH, bow: weaponStatsFromRecord({
        id: "bow", category: "ranged", apCost: 1, endsTurn: true, range: 8, requiresLOS: true,
        aimMod: 0, minDmg: 3, maxDmg: 5, crit: 15, critBonus: 2, envDmg: 0,
      }) },
      seed: 705,
      fogDisabled: true,
    });
    kernel.spawnScripted("strelets", 1, { x: 2, y: 2, z: 1 });
    const state = createPrologueRunState("prologue_glade");
    state.firstWave = true;
    const decision = tickProloguePlayerTurn(kernel, state, {
      missionId: "prologue_glade",
      hints: [],
      showHints: true,
      script: {
        actions: [
          { unitId: "strelets", side: "player", kind: "appear", at: { x: 2, y: 2 } },
          { unitId: "strelets", side: "player", kind: "attack", targetUnitId: "upyr", weaponId: "bow", forceOutcome: "hit" },
        ],
      },
    });
    expect(decision.forceOutcome).toBe("hit");
    expect(decision.command?.type).toBe("ATTACK");
  });
});
