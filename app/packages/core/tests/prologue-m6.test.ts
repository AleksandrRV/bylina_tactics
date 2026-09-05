import { describe, expect, it } from "vitest";
import {
  afterPrologueApply,
  compilePrologueLayout,
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  tickPrologueEnemyTurn,
} from "../src/index.js";
import {
  BOGATYR,
  CLAWS,
  CLUB,
  IDOL,
  KIKIMORA,
  NEEDLE,
  RAT,
  SLUG,
  SPIT,
  STRELETS,
  UPYR,
  ZNAHARKA,
} from "./prologue-sim.setup.js";

/**
 * Авторская раскладка М6 (12×10): идол в частоколе, западный проход,
 * двое упырей и две кикиморы, дружина на западе.
 */
const M6_LAYOUT = {
  rows: [
    "ttt.....tttt",
    "t..........t",
    "...c....CCC.",
    "M...U....ICK",
    "A.....U.CCC.",
    "V..e.....K..",
    "............",
    "t..........t",
    "tt..t....ttt",
    "tttttttttttt",
  ],
  heights: [
    "111111111111",
    "111111111111",
    "111111112221",
    "111111112221",
    "111111112221",
    "111111111111",
    "111111111111",
    "111111111111",
    "111111111111",
    "111111111111",
  ],
  legend: {
    ".": { kind: "ground" },
    t: { kind: "decor", decor: "bush" },
    c: { kind: "cover", coverType: 1 },
    C: { kind: "cover", coverType: 2 },
    e: { kind: "cover", coverType: 1, edge: 0 },
    M: { kind: "spawn", side: "player", unitId: "bogatyr", weapons: ["club"] },
    A: { kind: "spawn", side: "player", unitId: "strelets", weapons: ["bow"] },
    V: { kind: "spawn", side: "player", unitId: "znaharka", weapons: ["sling"] },
    U: { kind: "spawn", side: "enemy", unitId: "upyr" },
    K: { kind: "spawn", side: "enemy", unitId: "kikimora" },
    I: { kind: "spawn", side: "neutral", unitId: "idol" },
  },
};

const M6_HINTS = [
  { key: "m6.objective", textKey: "prologue.hint.m6.objective", once: true },
  { key: "m6.wave", textKey: "prologue.hint.m6.wave", once: true },
  { key: "ship.arrive", textKey: "prologue.hint.ship.arrive", once: true },
];

const M6_DEFAULT = {
  enabled: true,
  mode: "threshold" as const,
  thresholdEnemyCount: 5,
  delayTurns: 1,
  pool: ["forest_rat", "slug", "upyr", "kikimora"],
  countPerWave: 2,
  maxConcurrentEnemies: 8,
  spawnEdge: "north" as const,
  spawnCells: [
    { x: 4, y: 0 },
    { x: 5, y: 0 },
    { x: 6, y: 0 },
    { x: 7, y: 0 },
  ],
};

const UNITS = [BOGATYR, STRELETS, ZNAHARKA, UPYR, KIKIMORA, IDOL, RAT, SLUG];

function m6Ctx() {
  return {
    missionId: "prologue_barrow" as const,
    hints: M6_HINTS,
    showHints: true,
    reinforcements: M6_DEFAULT,
    script: { priority: [], actions: [] },
  };
}

function boot(options: { fogDisabled?: boolean } = {}) {
  const match = createPrologueMatch({
    layout: M6_LAYOUT,
    units: UNITS,
    seed: 706,
  });
  const kernel = createTacticsKernel({
    initial: match,
    units: UNITS,
    weapons: { club: CLUB, claws: CLAWS, needle: NEEDLE, spit: SPIT },
    seed: 706,
    fogDisabled: options.fogDisabled ?? true,
  });
  return { kernel, state: createPrologueRunState("prologue_barrow"), ctx: m6Ctx() };
}

describe("prologue M6 layout compiler", () => {
  it("places the idol at (9,3) inside a C palisade with a west gate", () => {
    const compiled = compilePrologueLayout(M6_LAYOUT);
    expect(compiled.grid.width).toBe(12);
    expect(compiled.grid.height).toBe(10);
    expect(compiled.markers.I).toEqual([{ x: 9, y: 3 }]);
    expect(compiled.markers.U).toEqual([
      { x: 4, y: 3 },
      { x: 6, y: 4 },
    ]);
    expect(compiled.markers.K).toEqual([
      { x: 11, y: 3 },
      { x: 9, y: 5 },
    ]);
    const palisade = compiled.covers.filter((cover) => cover.coverType === 2);
    expect(palisade.some((cover) => cover.x === 8 && cover.y === 3)).toBe(false);
    expect(palisade.some((cover) => cover.x === 9 && cover.y === 2)).toBe(true);
    expect(palisade.some((cover) => cover.x === 10 && cover.y === 3)).toBe(true);
    const idolTile = compiled.grid.tiles.find((tile) => tile.x === 9 && tile.y === 3);
    expect(idolTile?.z).toBe(2);
    for (const tile of compiled.grid.tiles) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const other = compiled.grid.tiles.find(
          (candidate) => candidate.x === tile.x + dx && candidate.y === tile.y + dy,
        );
        if (!other) continue;
        expect(Math.abs(other.z - tile.z), `скачок у (${tile.x},${tile.y})`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("prologue M6 barrow", () => {
  it("starts with the destroy objective, a inert idol and four living Nav", () => {
    const { kernel, state } = boot();
    expect(state.objectiveKey).toBe("prologue.objective.destroyIdol");
    expect(state.hints.queue).toContain("m6.objective");
    const snap = kernel.getSnapshot();
    expect(snap.objective).toEqual({ kind: "destroy", unitId: "idol" });
    const idol = snap.entities.find((entity) => entity.configId === "idol")!;
    expect(idol).toMatchObject({ owner: 0, ap: 0, maxAp: 0, countsForElimination: false, dead: false, x: 9, y: 3 });
    const nav = snap.entities.filter((entity) => !entity.dead && entity.owner === 2 && entity.coverType === 0);
    expect(nav.filter((entity) => entity.configId === "upyr")).toHaveLength(2);
    expect(nav.filter((entity) => entity.configId === "kikimora")).toHaveLength(2);
    expect(nav).toHaveLength(4);
  });

  it("telegraphs a wave on the first Nav turn then spawns two from the pool", () => {
    const { kernel, state, ctx } = boot();
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const before = kernel
      .getSnapshot()
      .entities.filter((entity) => !entity.dead && entity.owner === 2 && entity.coverType === 0).length;
    expect(before).toBe(4);
    const first = tickPrologueEnemyTurn(kernel, state, ctx);
    expect(first.state.reinforcements.telegraph.length).toBe(2);
    expect(first.state.hints.queue).toContain("m6.wave");
    const still = kernel
      .getSnapshot()
      .entities.filter((entity) => !entity.dead && entity.owner === 2 && entity.coverType === 0).length;
    expect(still).toBe(4);
    kernel.apply({ type: "END_TURN", playerId: "2" });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const second = tickPrologueEnemyTurn(kernel, first.state, ctx);
    const after = kernel
      .getSnapshot()
      .entities.filter((entity) => !entity.dead && entity.owner === 2 && entity.coverType === 0);
    expect(after.length).toBe(6);
    const spawned = after.filter((entity) => entity.configId === "forest_rat" || entity.configId === "slug");
    expect(spawned).toHaveLength(2);
    expect(spawned.every((entity) => entity.y === 0 && entity.x >= 4 && entity.x <= 7)).toBe(true);
    expect(second.state.reinforcements.telegraph).toEqual([]);
  });

  it("wins when the idol falls even if an upyr still lives, and queues ship.arrive", () => {
    const { kernel, state, ctx } = boot();
    const snap = kernel.getSnapshot();
    const idol = snap.entities.find((entity) => entity.configId === "idol")!;
    idol.dead = true;
    idol.hp = 0;
    const upyr = snap.entities.find((entity) => entity.configId === "upyr" && !entity.dead)!;
    kernel.restoreMatch(snap, kernel.getFog());
    const next = afterPrologueApply(
      kernel,
      { type: "ATTACK", actorId: 1, targetId: idol.id, weaponId: "club" },
      [{ type: "ENTITY_DIED", entityId: idol.id, causeOfDeath: "DAMAGE" }],
      state,
      ctx,
    );
    expect(next.outcome).toBe("victory");
    expect(next.mission.flags.idolFallen).toBe(true);
    expect(next.hints.queue).toContain("ship.arrive");
    const living = kernel.getSnapshot().entities.find((entity) => entity.id === upyr.id && !entity.dead);
    expect(living).toBeDefined();
  });
});
