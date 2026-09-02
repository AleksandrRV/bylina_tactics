/**
 * Общая обвязка тестов тактического ядра для пролога.
 *
 * Вынесена из prologue-sim.test.ts, чтобы разбить его на тематические файлы
 * (prologue-m1.test.ts, prologue-m2.test.ts, ...) и переиспользовать
 * константы и хелперы между ними.
 */

import {
  compilePrologueLayout,
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  afterPrologueApply,
  tickPrologueEnemyTurn,
  weaponStatsFromRecord,
  type SpawnUnitConfig,
} from "../src/index.js";

/* ---------- Базовые сущности пролога ---------- */

export const MIKULA: SpawnUnitConfig = { id: "mikula_peasant", maxHealth: 8, maxAP: 2, mobility: 5, aim: 60, defense: 0, vision: 10, weapons: [] };
export const RAT: SpawnUnitConfig = { id: "forest_rat", maxHealth: 4, maxAP: 2, mobility: 6, aim: 50, defense: 0, vision: 10, weapons: ["teeth"] };
export const FEDOT: SpawnUnitConfig = { id: "fedot_stranded", maxHealth: 5, maxAP: 2, mobility: 4, aim: 40, defense: 0, vision: 8, weapons: [], skills: ["evacuate"] };
export const BOGATYR: SpawnUnitConfig = { id: "bogatyr", maxHealth: 12, maxAP: 2, mobility: 4, aim: 70, defense: 10, vision: 10, weapons: ["sword"] };
export const UPYR: SpawnUnitConfig = { id: "upyr", maxHealth: 6, maxAP: 2, mobility: 4, aim: 50, defense: 0, vision: 8, weapons: ["claws"] };
export const STRELETS: SpawnUnitConfig = { id: "strelets", maxHealth: 8, maxAP: 2, mobility: 5, aim: 70, defense: 0, vision: 12, weapons: ["bow"] };
export const ZNAHARKA: SpawnUnitConfig = { id: "znaharka", maxHealth: 8, maxAP: 2, mobility: 4, aim: 50, defense: 0, vision: 10, weapons: [] };

/* ---------- Общие виды оружия ---------- */

export const CLUB = weaponStatsFromRecord({ id: "club", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false, aimMod: 0, minDmg: 3, maxDmg: 5, crit: 10, critBonus: 1, envDmg: 0 });
export const TEETH = weaponStatsFromRecord({ id: "teeth", category: "melee", apCost: 1, endsTurn: true, range: 1, requiresLOS: false, aimMod: 0, minDmg: 2, maxDmg: 3, crit: 10, critBonus: 1, envDmg: 0 });

/* ---------- Раскладки поля (синхронны с prologue_missions.json5) ---------- */

export const M1_LAYOUT = {
  rows: [".t..W....t....W...t.", "..t.....t...t....t..", "..................F.", ".M..t.......t..t...S", "..t.....t.......t...", ".t..W....t....W..t.."],
  heights: ["11122221111111122111", "11122211111111112211", "11111211111111111111", "11111111111111111111", "11000011111000111111", "10000011100000011111"],
  legend: { ".": { kind: "ground" }, t: { kind: "decor", decor: "bush" }, W: { kind: "wall" }, M: { kind: "spawn", side: "player", unitId: "mikula_peasant" }, S: { kind: "pickup", itemId: "stick", weaponId: "club" }, F: { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true } },
};

export const M2_LAYOUT = {
  rows: ["Ett..c.StSWS", "E...c..StS.S", "E.M...t.....", "..c..t..t...", "........cF..", ".c....t..t..", "E...c....V..", "E......t...c", "Ett.....ttW."],
  legend: { M: { kind: "spawn", side: "player", unitId: "mikula_peasant" }, V: { kind: "stranded", unitId: "fedot_stranded", state: "immobile" }, F: { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true } },
};

/* ---------- Подкрепления и сценарий М2 (0.21.19) ---------- */

export const M2_CRY_WAVE = { enabled: true, mode: "onKill" as const, delayTurns: 0, pool: ["forest_rat"], perKill: 2, perTurnNoKill: 1, maxConcurrentEnemies: 4 };

export const M2_SCRIPT = {
  priority: [],
  actions: [
    { unitId: "forest_rat", side: "enemy" as const, kind: "attack" as const, targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "miss" as const },
    { unitId: "forest_rat", side: "enemy" as const, kind: "attack" as const, targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "hit" as const },
    { kind: "endTurn" as const },
  ],
};

/* ---------- Хелперы М2 ---------- */

export function m2Setup(options: { adjacent?: boolean } = {}): { kernel: ReturnType<typeof createTacticsKernel>; ctx: any; state: ReturnType<typeof createPrologueRunState> } {
  const match = createPrologueMatch({ layout: M2_LAYOUT, units: [MIKULA, FEDOT, RAT], seed: 702, hideExtract: true });
  if (options.adjacent) {
    const mikula = match.entities.find((e) => e.configId === "mikula_peasant")!;
    const fedot = match.entities.find((e) => e.configId === "fedot_stranded")!;
    fedot.x = mikula.x + 1;
    fedot.y = mikula.y;
  }
  const kernel = createTacticsKernel({ initial: match, units: [MIKULA, FEDOT, RAT], weapons: { club: CLUB, teeth: TEETH }, seed: 702, fogDisabled: true });
  const compiled = compilePrologueLayout(M2_LAYOUT);
  const ctx = { missionId: "prologue_cry", hints: [{ key: "m2.noise", textKey: "prologue.hint.m2.noise", once: true, forced: true, panelKey: "defend" }], showHints: true, ratMarker: compiled.markers.F?.[0], fedotWaveSpawns: compiled.markers.S, extractCells: compiled.extractCells };
  return { kernel, ctx, state: createPrologueRunState("prologue_cry") };
}

export function m2SwarmSetup() {
  const { kernel, ctx, state } = m2Setup({ adjacent: true });
  return { kernel, ctx: { ...ctx, script: M2_SCRIPT, reinforcements: M2_CRY_WAVE }, state };
}

export const heroOf = (kernel: ReturnType<typeof m2Setup>["kernel"]) =>
  kernel.getSnapshot().entities.find((e) => e.configId === "mikula_peasant")!;

export function freeFedot(
  kernel: ReturnType<typeof m2Setup>["kernel"],
  ctx: ReturnType<typeof m2Setup>["ctx"],
  state: ReturnType<typeof createPrologueRunState>,
) {
  const mikula = heroOf(kernel);
  let fedot = kernel.getSnapshot().entities.find((e) => e.configId === "fedot_stranded")!;
  if (Math.abs(mikula.x - fedot.x) + Math.abs(mikula.y - fedot.y) > 1) {
    const step = kernel.getReachable(mikula.id).filter((c) => c.apCost === 1 && Math.abs(c.x - fedot.x) + Math.abs(c.y - fedot.y) <= 1)[0]!;
    const applied = kernel.apply({ type: "MOVE", actorId: mikula.id, to: { x: step.x, y: step.y, z: 1 } });
    if (!applied.ok) throw new Error("step to Fedot not accepted");
  }
  fedot = kernel.getSnapshot().entities.find((e) => e.configId === "fedot_stranded")!;
  const command = { type: "INTERACT" as const, actorId: mikula.id, targetId: fedot.id };
  const applied = kernel.apply(command);
  if (!applied.ok) throw new Error("free Fedot not accepted: " + applied.reason);
  return afterPrologueApply(kernel, command, applied.events, state, ctx);
}

export function runNavTurn(
  kernel: ReturnType<typeof m2Setup>["kernel"],
  ctx: ReturnType<typeof m2Setup>["ctx"],
  state: ReturnType<typeof createPrologueRunState>,
) {
  let current = state;
  let commands = 0;
  let ended = false;
  for (let guard = 0; guard < 96; guard += 1) {
    const decision = tickPrologueEnemyTurn(kernel, current, ctx);
    current = decision.state;
    const applied = decision.command ? kernel.apply(decision.command) : kernel.apply({ type: "END_TURN", playerId: "2" });
    if (!decision.command) { ended = true; break; }
    commands += 1;
    if (!applied.ok) break;
    current = afterPrologueApply(kernel, decision.command, applied.events, current, ctx);
  }
  return { state: current, commands, ended };
}

export const ratsOf = (kernel: ReturnType<typeof m2Setup>["kernel"]): number =>
  kernel.getSnapshot().entities.filter((e) => e.configId === "forest_rat" && !e.dead).length;
