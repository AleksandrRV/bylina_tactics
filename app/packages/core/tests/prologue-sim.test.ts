import { describe, expect, it } from "vitest";
import {
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  afterPrologueApply,
  compilePrologueLayout,
  gatePrologueCommand,
  matchOutcome,
  pickScriptedCommand,
  shouldRestoreCheckpoint,
  tickProloguePlayerTurn,
  weaponStatsFromRecord,
  type GameEvent,
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

// Раскладка М1 «Хворост» (синхронна с prologue_missions.json5, 0.20.37).
const M1_LAYOUT = {
  rows: [
    ".t..W....t....W...t.",
    "..t.....t...t....t..",
    "..................F.",
    ".M..t.......t..t...S",
    "..t.....t.......t...",
    ".t..W....t....W..t..",
  ],
  heights: [
    "11122221111111122111",
    "11122211111111112211",
    "11111211111111111111",
    "11111111111111111111",
    "11000011111000111111",
    "10000011100000011111",
  ],
  legend: {
    ".": { kind: "ground" },
    t: { kind: "decor", decor: "bush" },
    W: { kind: "wall" },
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

/* ---------- M1: крыса как полноценный противник (0.20.37) ---------- */

const M1_FOG_OFF_LAYOUT = {
  rows: [
    "....................",
    "....t.....t......t..",
    "..................F.",
    ".M..t..........t...S",
    "....................",
    "....t.....t......t..",
  ],
  legend: {
    ".": { kind: "ground" },
    t: { kind: "decor", decor: "bush" },
    M: { kind: "spawn", side: "player", unitId: "mikula_peasant" },
    S: { kind: "pickup", itemId: "stick", weaponId: "club" },
    F: { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
  },
};

const M1_SCRIPT = {
  priority: [],
  actions: [
    {
      unitId: "forest_rat",
      side: "enemy",
      kind: "attack",
      targetUnitId: "mikula_peasant",
      weaponId: "teeth",
      // Синхронно с prologue_missions.json5 (0.20.40): укус обязан
      // состояться, но это минимальный урон зубов.
      forceOutcome: "min",
      onlyIf: "targetAlive",
    },
    { kind: "endTurn" },
  ],
};

/** Дойти до палки и подобрать её: крыса появляется скриптово. */
function armMikula(kernel: ReturnType<typeof createTacticsKernel>) {
  const compiled = compilePrologueLayout(M1_FOG_OFF_LAYOUT as never);
  const stick = compiled.markers.S![0]!;
  let state = createPrologueRunState("prologue_brushwood");
  const ctx = {
    missionId: "prologue_brushwood",
    script: M1_SCRIPT as never,
    hints: [],
    showHints: false,
    ratMarker: compiled.markers.F![0],
  };
  for (let guard = 0; guard < 60; guard += 1) {
    const snap = kernel.getSnapshot();
    const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant")!;
    if (mikula.x === stick.x && mikula.y === stick.y) {
      const applied = kernel.apply({ type: "END_TURN", playerId: "1" });
      if (applied.ok) state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, applied.events, state, ctx);
      break;
    }
    const reach = kernel.getReachable(mikula.id);
    const best = [...reach].sort(
      (a, b) =>
        Math.floor(Math.hypot(a.x - stick.x, a.y - stick.y)) - Math.floor(Math.hypot(b.x - stick.x, b.y - stick.y)),
    )[0];
    if (!best) {
      const applied = kernel.apply({ type: "END_TURN", playerId: "1" });
      if (applied.ok) state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, applied.events, state, ctx);
      continue;
    }
    const command = { type: "MOVE", actorId: mikula.id, to: best } as const;
    const applied = kernel.apply(command);
    if (applied.ok) state = afterPrologueApply(kernel, command, applied.events, state, ctx);
    else {
      const ended = kernel.apply({ type: "END_TURN", playerId: "1" });
      if (ended.ok) state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, ended.events, state, ctx);
    }
  }
  return { state, ctx };
}

describe("prologue M1 rat as a real enemy (0.20.37)", () => {
  function boot(seed: number) {
    const match = createPrologueMatch({ layout: M1_FOG_OFF_LAYOUT as never, units: [MIKULA, RAT], seed });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed,
      fogDisabled: true,
    });
    return kernel;
  }

  it("gives the scripted side its own fog of war once it enters the field", () => {
    const kernel = boot(701);
    // Противника ещё нет: туман Нави отсутствует.
    expect(kernel.getVisibleCells(2).size).toBe(0);
    const compiled = compilePrologueLayout(M1_FOG_OFF_LAYOUT as never);
    kernel.spawnScripted("forest_rat", 2, { x: compiled.markers.F![0]!.x, y: compiled.markers.F![0]!.y, z: 1 });
    // Сторона появилась — туман для неё создан и (при fogDisabled) раскрыт.
    expect(kernel.getVisibleCells(2).size).toBe(120);
  });

  it("the rat attacks Mikula instead of standing in overwatch", () => {
    const kernel = boot(701);
    const { state, ctx } = armMikula(kernel);
    expect(state.pickupDone).toBe(true);
    expect(kernel.getSnapshot().entities.some((entity) => entity.configId === "forest_rat" && !entity.dead)).toBe(true);

    let run = state;
    const outcomes: string[] = [];
    const rejections: string[] = [];
    let overwatch = false;

    for (let round = 0; round < 6; round += 1) {
      if (matchOutcome(kernel.getSnapshot()) !== "ongoing") break;
      // Игрок ничего не делает — только завершает ход.
      if (kernel.getSnapshot().activeOwner === 1) {
        const ended = kernel.apply({ type: "END_TURN", playerId: "1" });
        if (ended.ok) run = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, ended.events, run, ctx);
      }
      let guard = 0;
      while (kernel.getSnapshot().activeOwner === 2 && matchOutcome(kernel.getSnapshot()) === "ongoing" && guard < 96) {
        guard += 1;
        const decision = pickScriptedCommand(kernel, M1_SCRIPT as never, run.script, { activeOwner: 2 });
        run = { ...run, script: decision.state };
        if (decision.forceOutcome) kernel.setForcedOutcome(decision.forceOutcome);
        const command = decision.command ?? { type: "END_TURN" as const, playerId: "2" };
        if (decision.command?.type === "OVERWATCH") overwatch = true;
        const applied = kernel.apply(command as never);
        if (!applied.ok) {
          rejections.push(`${decision.command?.type ?? "END_TURN"}:${applied.reason}`);
          kernel.apply({ type: "END_TURN", playerId: "2" });
          break;
        }
        run = afterPrologueApply(kernel, command as never, applied.events, run, ctx);
        for (const event of applied.events) {
          // Результат и урон: первый удар обязан быть минимальным (0.20.40).
          if (event.type === "COMBAT_RESOLVED") outcomes.push(`${event.result}:${event.damageDealt}`);
        }
        if (!decision.command) break;
      }
    }

    // Крыса бьёт каждый ход: алгоритм не выдаёт ни одной отвергнутой команды.
    expect(rejections).toEqual([]);
    expect(overwatch).toBe(false);
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
    // Первый скриптовый удар — минимальный урон зубов (0.20.40): укус
    // состоялся, но учебный бой не калечит героя случайным максимумом.
    expect(outcomes[0]).toBe("HIT:2");
    // Дальше честные кости: за оставшиеся ходы Микула получает ещё урон.
    const mikula = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    expect(mikula.hp).toBeLessThan(mikula.maxHp);
  });

  it("never issues a command the kernel rejects, on any seed", () => {
    for (const seed of [701, 733, 811, 907, 1024]) {
      const kernel = boot(seed);
      const { state, ctx } = armMikula(kernel);
      let run = state;
      for (let round = 0; round < 4; round += 1) {
        if (matchOutcome(kernel.getSnapshot()) !== "ongoing") break;
        if (kernel.getSnapshot().activeOwner === 1) {
          const ended = kernel.apply({ type: "END_TURN", playerId: "1" });
          if (ended.ok) run = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, ended.events, run, ctx);
        }
        let guard = 0;
        while (kernel.getSnapshot().activeOwner === 2 && guard < 96) {
          guard += 1;
          if (matchOutcome(kernel.getSnapshot()) !== "ongoing") break;
          const decision = pickScriptedCommand(kernel, M1_SCRIPT as never, run.script, { activeOwner: 2 });
          run = { ...run, script: decision.state };
          if (decision.forceOutcome) kernel.setForcedOutcome(decision.forceOutcome);
          const command = decision.command ?? { type: "END_TURN" as const, playerId: "2" };
          const applied = kernel.apply(command as never);
          expect(applied.ok, `seed ${seed}: ${decision.command?.type ?? "END_TURN"}`).toBe(true);
          if (!applied.ok) break;
          run = afterPrologueApply(kernel, command as never, applied.events, run, ctx);
          if (!decision.command) break;
        }
      }
    }
  });
});

describe("prologue M1 relief (0.20.37)", () => {
  it("applies per-cell heights from the parallel array", () => {
    const compiled = compilePrologueLayout(M1_LAYOUT as never);
    const at = (x: number, y: number) => compiled.grid.tiles.find((tile) => tile.x === x && tile.y === y)!;
    // Северные всхолмления.
    expect(at(4, 0).z).toBe(2);
    // Тропа Микулы и клетка палки — ровный ярус.
    expect(at(1, 3).z).toBe(1);
    expect(at(19, 3).z).toBe(1);
    // Точка выхода крысы — тот же ярус, что и клетка палки: без поправки к меткости.
    expect(at(18, 2).z).toBe(at(19, 3).z);
    // Низина сухого ручья на юге.
    expect(at(3, 5).z).toBe(0);
    // Валуны блокируют обзор и проход.
    expect(at(4, 0).blockLOS).toBe(true);
    expect(at(14, 0).blockLOS).toBe(true);
  });

  it("keeps all three tiers on the map and the stick out of dash range", () => {
    const compiled = compilePrologueLayout(M1_LAYOUT as never);
    const tiers = new Set(compiled.grid.tiles.map((tile) => tile.z));
    expect([...tiers].sort()).toEqual([0, 1, 2]);

    const match = createPrologueMatch({ layout: M1_LAYOUT as never, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const mikula = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    const stick = kernel.getSnapshot().entities.find((entity) => entity.configId === "stick")!;
    // 18 клеток по прямой: полный рывок (до 10) не достаёт — второму ходу есть чему учить.
    expect(Math.floor(Math.hypot(stick.x - mikula.x, stick.y - mikula.y))).toBeGreaterThanOrEqual(18);
    expect(kernel.getReachable(mikula.id).some((cell) => cell.x === stick.x && cell.y === stick.y)).toBe(false);
    // Маршрут к палке существует: миссия проходима.
    expect(kernel.getReachable(mikula.id).length).toBeGreaterThan(0);
  });
});

describe("prologue M1 checkpoint (0.20.37)", () => {
  function deadMikulaSnapshot(kernel: ReturnType<typeof createTacticsKernel>) {
    const snap = kernel.getSnapshot();
    const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant")!;
    return {
      mikula,
      events: [{ type: "ENTITY_DIED", entityId: mikula.id, causeOfDeath: "DAMAGE" }] as never[],
      match: {
        ...snap,
        entities: snap.entities.map((entity) =>
          entity.id === mikula.id ? { ...entity, hp: 0, dead: true } : entity,
        ),
      },
    };
  }

  it("arms the checkpoint when the rat runs onto the field", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT as never, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const fresh = createPrologueRunState("prologue_brushwood");
    expect(fresh.ratSpawned).toBe(false);
    const { state } = armMikula(kernel);
    expect(state.ratSpawned).toBe(true);
  });

  it("replays the scene instead of losing once the checkpoint is armed", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT as never, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const { state } = armMikula(kernel);
    const { events, match: dead } = deadMikulaSnapshot(kernel);
    // Контрольная точка активна — гибель Микулы откатывает сцену.
    expect(shouldRestoreCheckpoint(state, events, dead)).toBe(true);
    // До появления крысы контрольной точки нет: это честное поражение.
    const before = createPrologueRunState("prologue_brushwood");
    expect(shouldRestoreCheckpoint(before, events, dead)).toBe(false);
  });

  it("keeps the outcome ongoing on death so the defeat card cannot flash first", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT as never, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const { state, ctx } = armMikula(kernel);
    const snap = kernel.getSnapshot();
    const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant")!;
    mikula.dead = true;
    mikula.hp = 0;
    kernel.restoreMatch(snap, kernel.getFog());
    const after = afterPrologueApply(
      kernel,
      { type: "END_TURN", playerId: "1" },
      [{ type: "ENTITY_DIED", entityId: mikula.id, causeOfDeath: "DAMAGE" }] as never,
      state,
      ctx,
    );
    expect(after.ratSpawned).toBe(true);
    expect(after.outcome).toBe("ongoing");
  });
});

describe("prologue scripted spawns reach the screen (0.20.37)", () => {
  it("hands the spawn event to the caller instead of dropping it", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT as never, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    expect(kernel.drainSpawnEvents()).toEqual([]);
    const compiled = compilePrologueLayout(M1_LAYOUT as never);
    const cell = compiled.markers.F![0]!;
    kernel.spawnScripted("forest_rat", 2, { x: cell.x, y: cell.y, z: 1 });
    const events = kernel.drainSpawnEvents();
    expect(events.some((event) => event.type === "ENTITY_SPAWNED")).toBe(true);
    // Накопитель опустошён: одно и то же событие не проигрывается дважды.
    expect(kernel.drainSpawnEvents()).toEqual([]);
  });

  it("accumulates the rat's arrival in the run state", () => {
    const match = createPrologueMatch({ layout: M1_LAYOUT as never, units: [MIKULA, RAT], seed: 701 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const { state } = armMikula(kernel);
    expect(state.pendingEvents.some((event) => event.type === "ENTITY_SPAWNED")).toBe(true);
    const spawned = state.pendingEvents.filter((event) => event.type === "ENTITY_SPAWNED") as Extract<
      GameEvent,
      { type: "ENTITY_SPAWNED" }
    >[];
    expect(spawned.map((event) => event.entity.configId)).toEqual(["forest_rat"]);
  });
});
