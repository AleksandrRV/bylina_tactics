import { describe, expect, it } from "vitest";
import {
  BOW,
  DEFAULT_TRAINING_UNITS,
  SWORD,
  compilePrologueLayout,
  createHintsManagerState,
  createLayoutMatch,
  createMissionScriptState,
  createMulberry32,
  createReinforcementsState,
  createTacticsKernel,
  createTelemetryLog,
  currentHint,
  dismissHint,
  enqueueHint,
  evaluateMissionTriggers,
  makeGrid,
  noteEnemyKill,
  pickScriptedCommand,
  previewAttack,
  recordTelemetry,
  resolveAttack,
  tickReinforcements,
  allowedPanel,
} from "../src/index.js";
import type { EntityState, MatchState } from "../src/types.js";

function fighter(id: number, owner: number, x: number, y: number, extra: Partial<EntityState> = {}): EntityState {
  return {
    id,
    configId: extra.configId ?? `u${id}`,
    owner,
    x,
    y,
    z: 1,
    dir: 1,
    ap: 2,
    maxAp: 2,
    mobility: 6,
    hp: extra.hp ?? 20,
    maxHp: 20,
    aim: 80,
    defense: 0,
    vision: 12,
    weaponId: extra.weaponId ?? "sword",
    weaponIds: extra.weaponIds ?? ["sword", "bow"],
    skillIds: extra.skillIds ?? [],
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: extra.defending ?? false,
    movementSpent: 0,
    ...extra,
  };
}

describe("forceOutcome combat channel", () => {
  it("force miss then honest rolls follow the seed", () => {
    const grid = makeGrid(8, 6, 1);
    const a = fighter(1, 1, 1, 1);
    const b = fighter(2, 2, 2, 1);
    const miss = resolveAttack(grid, [a, b], a, b, SWORD, createMulberry32(11), { forceOutcome: "miss" });
    expect(miss?.result).toBe("MISS");
    expect(miss?.damage).toBe(0);
    const hit = resolveAttack(grid, [a, b], a, b, SWORD, createMulberry32(11), { forceOutcome: "hit" });
    expect(hit?.result).toBe("HIT");
    expect(hit?.damage).toBeGreaterThan(0);
    const honestA = resolveAttack(grid, [a, b], a, b, SWORD, createMulberry32(99));
    const honestB = resolveAttack(grid, [a, b], a, b, SWORD, createMulberry32(99));
    expect(honestA).toEqual(honestB);
  });
});

describe("mission triggers", () => {
  const unit = fighter(1, 1, 2, 2, { configId: "mikula" });
  const match: MatchState = {
    turnNumber: 2,
    activeOwner: 1,
    grid: makeGrid(8, 6, 1),
    entities: [unit, fighter(2, 2, 5, 2, { configId: "rat" })],
  };

  it("fires each kind once", () => {
    const script = createMissionScriptState();
    const zone = evaluateMissionTriggers(
      match,
      [{ type: "ENTITY_MOVED", entityId: 1, path: [{ x: 1, y: 2, z: 1 }, { x: 3, y: 2, z: 1 }], isDash: false, apSpent: 1 }],
      [{ id: "z", kind: "OnZoneEnter", once: true, zone: { x0: 3, y0: 2, x1: 3, y1: 2 }, flag: "entered" }],
      script,
    );
    expect(zone.fired[0]?.flag).toBe("entered");
    const again = evaluateMissionTriggers(match, [{ type: "ENTITY_MOVED", entityId: 1, path: [{ x: 3, y: 2, z: 1 }], isDash: false, apSpent: 1 }], [{ id: "z", kind: "OnZoneEnter", once: true, zone: { x0: 3, y0: 2, x1: 3, y1: 2 } }], zone.state);
    expect(again.fired).toHaveLength(0);

    const adj = evaluateMissionTriggers(
      { ...match, entities: [fighter(1, 1, 5, 2, { configId: "mikula" }), fighter(2, 2, 5, 3, { configId: "fedot" })] },
      [],
      [{ id: "adj", kind: "OnUnitAdjacent", unitId: "mikula", otherUnitId: "fedot", once: true }],
      createMissionScriptState(),
    );
    expect(adj.fired.map((item) => item.triggerId)).toContain("adj");

    const turn = evaluateMissionTriggers(match, [{ type: "TURN_CHANGED", activePlayerId: "2", turnNumber: 3 }], [{ id: "t", kind: "OnTurnStart", side: "enemy", turnNumber: 3, once: true }], createMissionScriptState());
    expect(turn.fired).toHaveLength(1);

    const below = evaluateMissionTriggers(match, [], [{ id: "e", kind: "OnEnemyAliveBelow", n: 2, once: true }], createMissionScriptState());
    expect(below.fired).toHaveLength(1);

    const hp = evaluateMissionTriggers(
      { ...match, entities: [fighter(1, 1, 1, 1, { configId: "mikula", hp: 2 })] },
      [],
      [{ id: "h", kind: "OnUnitHpBelow", unitId: "mikula", percent: 20, once: true }],
      createMissionScriptState(),
    );
    expect(hp.fired).toHaveLength(1);

    const skill = evaluateMissionTriggers(match, [{ type: "SKILL_RESOLVED", sourceId: 1, skillId: "heal", success: true }], [{ id: "s", kind: "OnSkillUsed", skillId: "heal", unitId: "mikula", once: true }], createMissionScriptState());
    expect(skill.fired).toHaveLength(1);

    const pickup = evaluateMissionTriggers(
      { ...match, entities: [...match.entities, { ...fighter(9, 0, 3, 2, { configId: "stick" }), obstacle: false, maxAp: 0, ap: 0 }] },
      [{ type: "ENTITY_MOVED", entityId: 1, path: [{ x: 2, y: 2, z: 1 }, { x: 3, y: 2, z: 1 }], isDash: false, apSpent: 1 }],
      [{ id: "p", kind: "OnPickup", itemId: "stick", once: true }],
      createMissionScriptState(),
    );
    expect(pickup.fired).toHaveLength(1);

    const destroyed = evaluateMissionTriggers(match, [{ type: "COVER_DESTROYED", gridPos: { x: 1, y: 1, z: 1 }, newStatus: "NONE" }], [{ id: "d", kind: "OnObjectDestroyed", once: true }], createMissionScriptState());
    expect(destroyed.fired).toHaveLength(1);

    const interacted = evaluateMissionTriggers(match, [{ type: "SKILL_RESOLVED", sourceId: 1, skillId: "open", success: true }], [{ id: "i", kind: "OnObjectInteracted", once: true }], createMissionScriptState());
    expect(interacted.fired).toHaveLength(1);
  });
});

describe("prologue script player actor", () => {
  it("forms a legal attack for a player-side unit and consumes forceOutcome", () => {
    const initial: MatchState = {
      turnNumber: 1,
      activeOwner: 1,
      grid: makeGrid(8, 6, 1),
      entities: [
        fighter(1, 1, 1, 1, { configId: "fedot", weaponId: "bow", weaponIds: ["bow"] }),
        fighter(2, 2, 4, 1, { configId: "upyr" }),
      ],
    };
    const kernel = createTacticsKernel({
      initial,
      weapons: { sword: SWORD, bow: BOW },
      seed: 3,
    });
    const decision = pickScriptedCommand(kernel, {
      actions: [{ unitId: "fedot", side: "player", kind: "attack", targetUnitId: "upyr", weaponId: "bow", forceOutcome: "hit" }],
    }, { index: 0 });
    expect(decision.command?.type).toBe("ATTACK");
    expect(decision.forceOutcome).toBe("hit");
    kernel.setForcedOutcome(decision.forceOutcome ?? null);
    const applied = kernel.apply(decision.command!);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      const combat = applied.events.find((event) => event.type === "COMBAT_RESOLVED");
      expect(combat && combat.type === "COMBAT_RESOLVED" && combat.result !== "MISS").toBe(true);
    }
    kernel.setForcedOutcome(null);
    const second = kernel.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "bow" });
    expect(second.ok || second.reason === "NO_AP" || second.reason === "ILLEGAL").toBe(true);
  });

  it("skips an illegal scripted step", () => {
    const kernel = createTacticsKernel({
      initial: {
        turnNumber: 1,
        activeOwner: 1,
        grid: makeGrid(8, 6, 1),
        entities: [fighter(1, 1, 1, 1, { configId: "mikula" })],
      },
      weapons: { sword: SWORD },
      seed: 1,
    });
    const decision = pickScriptedCommand(kernel, {
      actions: [{ unitId: "ghost", side: "player", kind: "attack", targetUnitId: "nobody" }, { unitId: "mikula", kind: "endTurn" }],
    }, { index: 0 });
    expect(decision.command).toBeNull();
  });
});

describe("layout compiler", () => {
  it("compiles pits, walls, extract and half cover", () => {
    const compiled = compilePrologueLayout({
      rows: [
        "E..P",
        ".McW",
        "....",
      ],
    });
    expect(compiled.grid.width).toBe(4);
    expect(compiled.grid.height).toBe(3);
    expect(compiled.grid.tiles.find((tile) => tile.x === 3 && tile.y === 0)?.pit).toBe(true);
    expect(compiled.grid.tiles.find((tile) => tile.x === 3 && tile.y === 1)?.blockLOS).toBe(true);
    expect(compiled.grid.tiles.find((tile) => tile.x === 0 && tile.y === 0)?.extract).toBe(true);
    expect(compiled.covers.some((cover) => cover.x === 2 && cover.y === 1 && cover.coverType === 1)).toBe(true);
    expect(compiled.markers.M?.[0]).toEqual({ x: 1, y: 1 });
    const match = createLayoutMatch({ rows: [".M.", ".F."] }, [
      { config: DEFAULT_TRAINING_UNITS.bogatyr!, owner: 1, marker: "M" },
    ]);
    expect(match.entities.some((entity) => entity.configId === "bogatyr")).toBe(true);
  });
});

describe("reinforcements", () => {
  const base = (): MatchState => ({
    turnNumber: 1,
    activeOwner: 2,
    grid: makeGrid(8, 6, 1),
    entities: [
      fighter(1, 1, 1, 1),
      fighter(2, 2, 6, 1, { configId: "rat" }),
      fighter(3, 2, 6, 2, { configId: "rat" }),
      fighter(4, 2, 6, 3, { configId: "rat" }),
      fighter(5, 2, 6, 4, { configId: "rat" }),
    ],
  });

  it("threshold: telegraph then spawn after delay, cap 8", () => {
    const config = {
      pool: ["rat"],
      thresholdEnemyCount: 5,
      delayTurns: 1,
      countPerWave: 2,
      maxConcurrentEnemies: 8,
      spawnEdge: "north" as const,
    };
    const first = tickReinforcements(base(), config, createReinforcementsState());
    expect(first.telegraph.length).toBeGreaterThan(0);
    expect(first.spawns).toHaveLength(0);
    const second = tickReinforcements(base(), config, first.state);
    expect(second.spawns.length).toBe(2);
  });

  it("onKill +2 / no kill +1 with ceiling", () => {
    const config = {
      mode: "onKill" as const,
      pool: ["rat"],
      delayTurns: 0,
      maxConcurrentEnemies: 8,
      perKill: 2,
      perTurnNoKill: 1,
      spawnEdge: "east" as const,
    };
    const killed = tickReinforcements(base(), config, noteEnemyKill(createReinforcementsState()));
    expect(killed.spawns.length).toBe(2);
    const idle = tickReinforcements(base(), config, createReinforcementsState());
    expect(idle.spawns.length).toBe(1);
  });
});

describe("hints manager", () => {
  const catalog = [
    { key: "m1.endTurn", textKey: "m1.endTurn", once: true, panelKey: "end_turn" },
    { key: "m2.noise", textKey: "m2.noise", once: true, forced: true, panelKey: "defend" },
  ];

  it("shows once; showHints false keeps forced stance", () => {
    let state = createHintsManagerState();
    state = enqueueHint(state, catalog[0]!, { showHints: false });
    expect(currentHint(state, catalog)).toBeNull();
    state = enqueueHint(state, catalog[1]!, { showHints: false });
    expect(currentHint(state, catalog)?.key).toBe("m2.noise");
    expect(allowedPanel(state, catalog)).toBe("defend");
    state = dismissHint(state, "m2.noise");
    state = enqueueHint(state, catalog[1]!, { showHints: true });
    expect(currentHint(state, catalog)).toBeNull();
  });
});

describe("kernel restore, fogDisabled, consume-once force", () => {
  it("restores snapshot literally and does not consume force twice", () => {
    const initial: MatchState = {
      turnNumber: 1,
      activeOwner: 1,
      grid: makeGrid(8, 6, 1),
      entities: [fighter(1, 1, 1, 1), fighter(2, 2, 2, 1)],
    };
    const kernel = createTacticsKernel({ initial, weapons: { sword: SWORD }, seed: 4, fogDisabled: true });
    expect(kernel.getVisibleCells(1).size).toBe(8 * 6);
    kernel.setForcedOutcome("miss");
    const first = kernel.apply({ type: "ATTACK", actorId: 1, targetId: 2, weaponId: "sword" });
    expect(first.ok && first.events.some((event) => event.type === "COMBAT_RESOLVED" && event.result === "MISS")).toBe(true);
    const snap = kernel.getSnapshot();
    kernel.apply({ type: "END_TURN", playerId: "1" });
    kernel.restoreMatch(snap, kernel.getFog());
    expect(kernel.getSnapshot().turnNumber).toBe(snap.turnNumber);
    expect(kernel.getSnapshot().activeOwner).toBe(1);
  });
});

describe("telemetry", () => {
  it("records local events", () => {
    let log = createTelemetryLog();
    log = recordTelemetry(log, { type: "hint_shown", key: "m1.endTurn" });
    log = recordTelemetry(log, { type: "restart_pressed", missionId: "prologue_brushwood" });
    expect(log.events).toHaveLength(2);
  });
});

describe("previewAttack still available with force unused", () => {
  it("does not change preview", () => {
    const grid = makeGrid(8, 6, 1);
    const a = fighter(1, 1, 1, 1);
    const b = fighter(2, 2, 2, 1);
    expect(previewAttack(grid, [a, b], a, b, SWORD).available).toBe(true);
  });
});
