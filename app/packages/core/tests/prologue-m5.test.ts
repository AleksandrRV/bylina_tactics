import { describe, expect, it } from "vitest";
import {
  afterPrologueApply,
  compilePrologueLayout,
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  evaluateCover,
  hasLineOfSight,
  tickPrologueEnemyTurn,
} from "../src/index.js";
import { BOGATYR, CLUB, SLUG, SPIT, STRELETS, ZNAHARKA } from "./prologue-sim.setup.js";

/**
 * Учебное поле М5: гряда слизня, полка с просветом, ложбина отряда.
 * Компактнее авторской 14×16, но те же правила — укрытие, не замок.
 */
const M5_LAYOUT = {
  rows: [".G......", "........", "WW.WWWW.", "...C....", ".M......"],
  heights: ["22222222", "11111111", "11111111", "11111111", "00000000"],
  legend: {
    ".": { kind: "ground" },
    W: { kind: "wall" },
    C: { kind: "cover", coverType: 2 },
    e: { kind: "cover", coverType: 1, edge: 0 },
    M: { kind: "spawn", side: "player", unitId: "bogatyr", weapons: ["club"] },
    G: { kind: "spawn", side: "enemy", unitId: "slug" },
  },
};

const M5_HINTS = [
  { key: "m5.slug", textKey: "prologue.hint.m5.slug", once: true },
  { key: "m5.breach", textKey: "prologue.hint.m5.breach", once: true },
];

function boot(options: { fogDisabled?: boolean } = {}) {
  const match = createPrologueMatch({
    layout: M5_LAYOUT,
    units: [BOGATYR, STRELETS, ZNAHARKA, SLUG],
    seed: 705,
  });
  const kernel = createTacticsKernel({
    initial: match,
    units: [BOGATYR, STRELETS, ZNAHARKA, SLUG],
    weapons: { club: CLUB, spit: SPIT },
    seed: 705,
    fogDisabled: options.fogDisabled ?? true,
  });
  return { kernel, state: createPrologueRunState("prologue_road"), ctx: m5Ctx() };
}

function m5Ctx() {
  return {
    missionId: "prologue_road" as const,
    hints: M5_HINTS,
    showHints: true,
  };
}

describe("prologue M5 layout compiler", () => {
  it("compiles full cover, north-edge half cover and keeps a gap in the shelf", () => {
    const compiled = compilePrologueLayout({
      rows: [".C.e.", "WW.WW"],
      heights: ["11111", "11111"],
    });
    const full = compiled.covers.find((cover) => cover.x === 1 && cover.y === 0);
    const edge = compiled.covers.find((cover) => cover.x === 3 && cover.y === 0);
    expect(full).toMatchObject({ coverType: 2, obstacle: true });
    expect(edge).toMatchObject({ coverType: 1, obstacle: false, edge: 0 });
    expect(compiled.grid.tiles.find((tile) => tile.x === 2 && tile.y === 1)?.blockLOS).toBe(false);
    expect(compiled.grid.tiles.find((tile) => tile.x === 1 && tile.y === 1)?.blockLOS).toBe(true);
  });
});

describe("prologue M5 road", () => {
  it("starts with the road objective and four living slugs on the ridge", () => {
    const wide = {
      rows: [
        "t.G..G..G..G.t",
        "t..W...W...W.t",
        "..C...C...C...",
        "tW..c....W.c.t",
        "...W..e...W...",
        "t.C..W..c..C.t",
        ".W..c..W..c...",
        "WW.WW..WW.WWW.",
        "t..e....e..W.t",
        "..W..C...W....",
        "tc...W..c...ct",
        "..e....W..e...",
        "tW..c...C..W.t",
        "..c..W....c...",
        "...M.......P.t",
        "t..AV.ttttttt.",
      ],
      heights: [
        "22222222222222",
        "22222222222222",
        "11111111111111",
        "11111111111111",
        "11111111111111",
        "11111111111111",
        "11111111111111",
        "11111111111111",
        "00000000000000",
        "00000000000000",
        "00000000000000",
        "00000000000000",
        "00000000000000",
        "00000000000000",
        "00000000000000",
        "00000000000000",
      ],
      legend: {
        M: { kind: "spawn", side: "player", unitId: "bogatyr", weapons: ["club"] },
        A: { kind: "spawn", side: "player", unitId: "strelets", weapons: ["bow"] },
        V: { kind: "spawn", side: "player", unitId: "znaharka", weapons: ["sling"] },
        G: { kind: "spawn", side: "enemy", unitId: "slug" },
      },
    };
    const compiled = compilePrologueLayout(wide);
    expect(compiled.markers.G).toEqual([
      { x: 2, y: 0 },
      { x: 5, y: 0 },
      { x: 8, y: 0 },
      { x: 11, y: 0 },
    ]);
    expect(compiled.grid.tiles.find((tile) => tile.x === 11 && tile.y === 14)?.pit).toBe(true);
    const tiers = new Set(compiled.grid.tiles.map((tile) => tile.z));
    expect([...tiers].sort()).toEqual([0, 1, 2]);
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
    const state = createPrologueRunState("prologue_road");
    expect(state.objectiveKey).toBe("prologue.objective.clearRoad");
  });

  it("keeps a LOS gap through the shelf so adjacent wall cover is not a lock", () => {
    const compiled = compilePrologueLayout(M5_LAYOUT);
    const slug = compiled.markers.G![0]!;
    const peek = { x: 2, y: 3 };
    expect(compiled.grid.tiles.find((tile) => tile.x === 2 && tile.y === 2)?.blockLOS).toBe(false);
    expect(
      hasLineOfSight(compiled.grid, slug.x, slug.y, 2, peek.x, peek.y, 1),
      "просвет полки обязан оставлять луч",
    ).toBe(true);
  });

  it("gives full cover from the adjacent shelf wall while the gap keeps LOS", () => {
    const { kernel } = boot();
    const snap = kernel.getSnapshot();
    const bogatyr = snap.entities.find((entity) => entity.configId === "bogatyr")!;
    bogatyr.x = 2;
    bogatyr.y = 3;
    bogatyr.z = 1;
    kernel.restoreMatch(snap, kernel.getFog());
    const after = kernel.getSnapshot();
    const attacker = after.entities.find((entity) => entity.configId === "slug")!;
    const target = after.entities.find((entity) => entity.configId === "bogatyr")!;
    const cover = evaluateCover(attacker, target, after.entities, after.grid, {
      melee: false,
      ignoreHalfCover: false,
      flyingTarget: false,
    });
    expect(cover.coverType).toBe(2);
    expect(cover.penalty).toBe(50);
    expect(hasLineOfSight(after.grid, attacker.x, attacker.y, attacker.z, target.x, target.y, target.z)).toBe(true);
  });

  it("stands and spits when the hero peeks, then queues the slug hint", () => {
    const { kernel, state, ctx } = boot();
    const placed = kernel.getSnapshot();
    const bogatyr = placed.entities.find((entity) => entity.configId === "bogatyr")!;
    bogatyr.x = 2;
    bogatyr.y = 3;
    bogatyr.z = 1;
    kernel.restoreMatch(placed, kernel.getFog());
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const slug = kernel.getSnapshot().entities.find((entity) => entity.configId === "slug" && !entity.dead)!;
    const before = { x: slug.x, y: slug.y };
    const decision = tickPrologueEnemyTurn(kernel, state, ctx);
    expect(decision.command?.type).toBe("ATTACK");
    if (decision.command?.type !== "ATTACK") throw new Error("slug did not spit");
    expect(decision.command.weaponId).toBe("spit");
    expect(decision.forceOutcome).toBe("min");
    const applied = kernel.apply(decision.command);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const next = afterPrologueApply(kernel, decision.command, applied.events, decision.state, ctx);
    expect(next.hints.queue).toContain("m5.slug");
    const still = kernel.getSnapshot().entities.find((entity) => entity.id === slug.id)!;
    expect({ x: still.x, y: still.y }).toEqual(before);
  });

  it("does not crawl off the ridge when there is no shot", () => {
    const { kernel, state, ctx } = boot();
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const slug = kernel.getSnapshot().entities.find((entity) => entity.configId === "slug")!;
    const before = { x: slug.x, y: slug.y };
    const decision = tickPrologueEnemyTurn(kernel, state, ctx);
    expect(decision.command).toBeNull();
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === slug.id)).toMatchObject(before);
  });

  it("wins when the last slug dies and queues the breach hint", () => {
    const { kernel, state, ctx } = boot();
    const snap = kernel.getSnapshot();
    const slugs = snap.entities.filter((entity) => entity.configId === "slug");
    for (const slug of slugs) {
      slug.dead = true;
      slug.hp = 0;
    }
    kernel.restoreMatch(snap, kernel.getFog());
    const next = afterPrologueApply(
      kernel,
      { type: "END_TURN", playerId: "1" },
      [{ type: "ENTITY_DIED", entityId: slugs[0]!.id, causeOfDeath: "DAMAGE" }],
      state,
      ctx,
    );
    expect(next.outcome).toBe("victory");
    expect(next.hints.queue).toContain("m5.breach");
  });

  it("hides the ridge from the starting valley in fog", () => {
    const { kernel } = boot({ fogDisabled: false });
    const visible = kernel.getVisibleCells(1);
    const slug = kernel.getSnapshot().entities.find((entity) => entity.configId === "slug")!;
    expect(visible.has(`${slug.x},${slug.y}`)).toBe(false);
  });
});
