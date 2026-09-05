import { describe, expect, it } from "vitest";
import {
  createPrologueMatch,
  createPrologueRunState,
  createTacticsKernel,
  afterPrologueApply,
  clampPrologueCommand,
  compilePrologueLayout,
  gatePrologueCommand,
  revealPrologueExtract,
  matchOutcome,
  noteEnemyKill,
  pickScriptedCommand,
  shouldRestartPrologueMission,
  tickPrologueEnemyTurn,
  tickProloguePlayerTurn,
  weaponStatsFromRecord,
  type GameEvent,
} from "../src/index.js";
import {
  BOGATYR,
  BREACH,
  CLUB,
  FEDOT,
  M1_LAYOUT,
  M2_CRY_WAVE,
  M2_LAYOUT,
  M2_SCRIPT,
  MIKULA,
  RAT,
  STRELETS,
  TEETH,
  UPYR,
  ZNAHARKA,
  freeFedot,
  heroOf,
  m2Setup,
  m2SwarmSetup,
  ratsOf,
  runNavTurn,
} from "./prologue-sim.setup.js";

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
    state = afterPrologueApply(
      kernel,
      { type: "MOVE", actorId: mik.id, to: { x: stick.x, y: stick.y, z: 1 } },
      [{ type: "ENTITY_MOVED", entityId: mik.id, path: [{ x: stick.x, y: stick.y, z: 1 }], isDash: false, apSpent: 1 }],
      state,
      {
        missionId: "prologue_brushwood",
        hints: [],
        showHints: true,
        ratMarker: compiled.markers.F![0],
      },
    );
    const after = kernel.getSnapshot();
    const armed = after.entities.find((entity) => entity.configId === "mikula_peasant")!;
    expect(armed.weaponIds).toEqual(["club"]);
    expect(armed.weaponId).toBe("club");
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
    expect(gatePrologueCommand(state, { type: "ATTACK", actorId: mikula.id, targetId: 2, weaponId: "club" })).toBe(
      false,
    );
    expect(gatePrologueCommand(state, { type: "DEFEND", actorId: mikula.id })).toBe(true);
    expect(gatePrologueCommand(state, { type: "END_TURN", playerId: "1" })).toBe(false);
  });
});

// Р Р°СЃРєР»Р°РґРєР° Рњ2 В«РљСЂРёРє РІ С‡Р°С‰РµВ» (СЃРёРЅС…СЂРѕРЅРЅР° СЃ prologue_missions.json5, 0.20.45).

describe("prologue script waits for its actor (0.20.45)", () => {
  it("keeps the queued bite until the rat has entered the field", () => {
    // РљСЂС‹СЃР° Рњ1 РІС‹С…РѕРґРёС‚ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ РїРѕРґР±РѕСЂР° РїР°Р»РєРё, Р° РіРµСЂРѕР№ РёРґС‘С‚ РґРѕ РЅРµС‘
    // РЅРµСЃРєРѕР»СЊРєРѕ С…РѕРґРѕРІ: РєР°Р¶РґС‹Р№ РїСѓСЃС‚РѕР№ С…РѕРґ РќР°РІРё РїСЂРѕР»РёСЃС‚С‹РІР°Р» Р±С‹ РѕС‡РµСЂРµРґСЊ,
    // Рё РѕР±РµС‰Р°РЅРЅС‹Р№ СЃС†РµРЅРѕР№ СѓРєСѓСЃ СЂР°Р·С‹РіСЂС‹РІР°Р»СЃСЏ Р±С‹ РѕР±С‹С‡РЅС‹Рј Р°Р»РіРѕСЂРёС‚РјРѕРј вЂ” СЃ
    // РѕР±С‹С‡РЅС‹Рј С€Р°РЅСЃРѕРј РїСЂРѕРјР°С…Р°.
    const layout = {
      rows: [".M......S.F.", "............"],
      legend: {
        M: { kind: "spawn", side: "player", unitId: "mikula_peasant" },
        S: { kind: "pickup", itemId: "stick", weaponId: "club" },
        F: { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
      },
    };
    const match = createPrologueMatch({ layout, units: [MIKULA, RAT], seed: 701 });
    // РҐРѕРґ РќР°РІРё: СЃС†РµРЅР°СЂРёР№ РІС‹Р±РёСЂР°РµС‚СЃСЏ РёРјРµРЅРЅРѕ РґР»СЏ Р°РєС‚РёРІРЅРѕР№ СЃС‚РѕСЂРѕРЅС‹.
    match.activeOwner = 2;
    const kernel = createTacticsKernel({
      initial: match,
      units: [MIKULA, RAT],
      weapons: { club: CLUB, teeth: TEETH },
      seed: 701,
      fogDisabled: true,
    });
    const script = {
      actions: [
        {
          unitId: "forest_rat",
          side: "enemy" as const,
          kind: "attack" as const,
          targetUnitId: "mikula_peasant",
          weaponId: "teeth",
          forceOutcome: "min" as const,
        },
        { kind: "endTurn" as const },
      ],
    };
    const state = { index: 0 };
    // РџСѓСЃС‚РѕР№ С…РѕРґ РќР°РІРё: РєСЂС‹СЃС‹ РЅР° РїРѕР»Рµ РЅРµС‚, РѕС‡РµСЂРµРґСЊ РѕР±СЏР·Р°РЅР° РѕСЃС‚Р°С‚СЊСЃСЏ РЅР° РјРµСЃС‚Рµ.
    const idle = pickScriptedCommand(kernel, script, state, { activeOwner: 2 });
    expect(idle.command).toBeNull();
    expect(idle.state.index).toBe(0);

    // РљСЂС‹СЃР° РІС‹С€Р»Р° вЂ” РѕР±РµС‰Р°РЅРЅС‹Р№ СѓРєСѓСЃ РЅР° РјРµСЃС‚Рµ, СЃ РїСЂРµРґРїРёСЃР°РЅРЅС‹Рј РёСЃС…РѕРґРѕРј.
    const mikula = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    // РљСЂС‹СЃР° РІС‹С…РѕРґРёС‚ СЂСЏРґРѕРј СЃ РіРµСЂРѕРµРј: СѓРєСѓСЃ РґРѕСЃС‚СѓРїРµРЅ СЃСЂР°Р·Сѓ.
    kernel.spawnScripted("forest_rat", 2, { x: mikula.x + 1, y: mikula.y, z: 1 });
    const decision = pickScriptedCommand(kernel, script, idle.state, { activeOwner: 2 });
    expect(decision.command?.type).toBe("ATTACK");
    expect(decision.forceOutcome).toBe("min");
  });
});

describe("prologue M2 ambush budget (0.20.45)", () => {
  it("cuts the dash in half: one AP stays for the stance", () => {
    const { kernel, state } = m2Setup();
    const mikula = heroOf(kernel);
    const cells = kernel.getReachable(mikula.id);
    const dash = cells.filter((cell) => cell.apCost === 2).sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
    const command = { type: "MOVE" as const, actorId: mikula.id, to: { x: dash.x, y: dash.y, z: 1 } };
    const clamped = clampPrologueCommand(kernel, state, command, ["mikula_peasant"]);
    if (clamped.type !== "MOVE") throw new Error("РѕР¶РёРґР°Р»Р°СЃСЊ РєРѕРјР°РЅРґР° РїРµСЂРµРјРµС‰РµРЅРёСЏ");
    // Р¦РµР»СЊ РЅРµ РґРѕСЃС‚РёРіРЅСѓС‚Р°, РЅРѕ РіРµСЂРѕР№ РЅРµ СЃС‚РѕРёС‚: СЂС‹РІРѕРє РѕР±СЂС‹РІР°РµС‚СЃСЏ РЅР° РїРѕР»РїСѓС‚Рё.
    expect(`${clamped.to.x},${clamped.to.y}`).not.toBe(`${dash.x},${dash.y}`);
    expect(`${clamped.to.x},${clamped.to.y}`).not.toBe(`${mikula.x},${mikula.y}`);
    expect(
      kernel.getReachable(mikula.id).find((cell) => cell.x === clamped.to.x && cell.y === clamped.to.y)?.apCost,
    ).toBe(1);
    // РћСЃС‚Р°РЅРѕРІРєР° вЂ” РЅР° РјР°СЂС€СЂСѓС‚Рµ: РѕРЅР° Р±Р»РёР¶Рµ Рє С†РµР»Рё, С‡РµРј РєР»РµС‚РєР° СЃС‚Р°СЂС‚Р°.
    const toward = Math.abs(clamped.to.x - dash.x) + Math.abs(clamped.to.y - dash.y);
    const fromStart = Math.abs(mikula.x - dash.x) + Math.abs(mikula.y - dash.y);
    expect(toward).toBeLessThan(fromStart);
    const applied = kernel.apply(clamped);
    expect(applied.ok).toBe(true);
    expect(heroOf(kernel).ap).toBe(1);
  });

  it("leaves an ordinary step, other actors and other missions alone", () => {
    const { kernel, state } = m2Setup();
    const mikula = heroOf(kernel);
    const step = kernel.getReachable(mikula.id).filter((cell) => cell.apCost === 1)[0]!;
    const command = { type: "MOVE" as const, actorId: mikula.id, to: { x: step.x, y: step.y, z: 1 } };
    // РћР±С‹С‡РЅС‹Р№ С€Р°Рі РІ Р±СЋРґР¶РµС‚Рµ: РєРѕРјР°РЅРґР° РЅРµ РїРµСЂРµРїРёСЃС‹РІР°РµС‚СЃСЏ.
    expect(clampPrologueCommand(kernel, state, command, ["mikula_peasant"])).toEqual(command);
    const dash = kernel.getReachable(mikula.id).filter((cell) => cell.apCost === 2)[0]!;
    const dashCommand = { type: "MOVE" as const, actorId: mikula.id, to: { x: dash.x, y: dash.y, z: 1 } };
    // Р—Р°СЃР°РґР° СѓР¶Рµ РїРѕР·Р°РґРё вЂ” Р±СЋРґР¶РµС‚ Р±РѕР»СЊС€Рµ РЅРµ РґРµСЂР¶РёС‚.
    expect(clampPrologueCommand(kernel, { ...state, ambushPending: false }, dashCommand, ["mikula_peasant"])).toEqual(
      dashCommand,
    );
    // Р§СѓР¶РѕР№ Р±РѕРµС† Р±СЋРґР¶РµС‚РѕРј РЅРµ СЃРІСЏР·Р°РЅ.
    expect(clampPrologueCommand(kernel, state, dashCommand, ["fedot_stranded"])).toEqual(dashCommand);
    // РќРµ РїРµСЂРµРјРµС‰РµРЅРёРµ вЂ” РЅРµ РЅР°С€Р° Р·Р°Р±РѕС‚Р°.
    const defend = { type: "DEFEND" as const, actorId: mikula.id };
    expect(clampPrologueCommand(kernel, state, defend, ["mikula_peasant"])).toEqual(defend);
  });
});

describe("prologue M2 wave and exit (0.20.45)", () => {
  it("lights the evacuation zone only after the swarm has run out", () => {
    const { kernel, ctx, state } = m2Setup({ adjacent: true });
    const mikula = heroOf(kernel);
    const fedot = kernel.getSnapshot().entities.find((entity) => entity.configId === "fedot_stranded")!;
    // РћСЃРІРѕР±РѕР¶РґРµРЅРёРµ: РѕСЃРѕР±РѕРµ РґРµР№СЃС‚РІРёРµ, РґРѕСЃС‚СѓРїРЅРѕРµ С‚РѕР»СЊРєРѕ СЂСЏРґРѕРј СЃ Р·Р°С…РІР°С‡РµРЅРЅС‹Рј.
    const freed = kernel.apply({ type: "INTERACT", actorId: mikula.id, targetId: fedot.id });
    expect(freed.ok).toBe(true);
    if (!freed.ok) return;
    const next = afterPrologueApply(
      kernel,
      { type: "INTERACT", actorId: mikula.id, targetId: fedot.id },
      freed.events,
      state,
      ctx,
    );
    // Р¤РµРґРѕС‚ РѕСЃРІРѕР±РѕР¶РґС‘РЅ Рё РІРѕР»РµРЅ С…РѕРґРёС‚СЊ.
    expect(next.fedotFreed).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.configId === "fedot_stranded")?.maxAp).toBe(2);
    // РЎС‚Р°СЏ РІС‹С€Р»Р° вЂ” РґРѕ С‡РµС‚С‹СЂС‘С… РєСЂС‹СЃ РёР· С‡Р°С‰Рё, Р° РЅРµ РЅРѕР»СЊ, РєР°Рє Р±С‹Р»Рѕ Р±С‹ Р±РµР·
    // РјР°СЂРєРµСЂРѕРІ (0.21.22: РїРѕС‚РѕР»РѕРє РїРѕСЃР»Рµ РѕСЃРІРѕР±РѕР¶РґРµРЅРёСЏ вЂ” С‡РµС‚С‹СЂРµ).
    expect(
      kernel.getSnapshot().entities.filter((entity) => entity.configId === "forest_rat" && !entity.dead).length,
    ).toBe(4);
    // Р’С‹С…РѕРґ РµС‰С‘ С‚С‘РјРµРЅ: РµРіРѕ РїРѕРєР°Р¶РµС‚ СЃС†РµРЅР°, Р° РЅРµ СЃР°РјРѕ РѕСЃРІРѕР±РѕР¶РґРµРЅРёРµ.
    expect(next.extractPending).toBe(true);
    expect(kernel.getSnapshot().grid.tiles.filter((tile) => tile.extract).length).toBe(0);
    // Р­РєСЂР°РЅ Р±РѕСЏ РѕС‚РєСЂС‹РІР°РµС‚ Р·РѕРЅСѓ РїРѕСЃР»Рµ СЃС†РµРЅС‹ СЃС‚Р°Рё вЂ” Рё С‚РѕР»СЊРєРѕ РµС‘ РєР»РµС‚РєРё.
    const revealed = revealPrologueExtract(kernel, next, ctx);
    expect(revealed.extractPending).toBe(false);
    expect(
      kernel
        .getSnapshot()
        .grid.tiles.filter((tile) => tile.extract)
        .map((tile) => `${tile.x},${tile.y}`)
        .sort(),
    ).toEqual(["0,0", "0,1", "0,2", "0,6", "0,7", "0,8"]);
    expect(kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")?.skillIds).toContain(
      "evacuate",
    );
  });

  it("opens the exit by itself if the screen missed the beat", () => {
    const { kernel, ctx, state } = m2Setup({ adjacent: true });
    const mikula = heroOf(kernel);
    const fedot = kernel.getSnapshot().entities.find((entity) => entity.configId === "fedot_stranded")!;
    // РћСЃРІРѕР±РѕР¶РґРµРЅРёРµ: РѕСЃРѕР±РѕРµ РґРµР№СЃС‚РІРёРµ, РґРѕСЃС‚СѓРїРЅРѕРµ С‚РѕР»СЊРєРѕ СЂСЏРґРѕРј СЃ Р·Р°С…РІР°С‡РµРЅРЅС‹Рј.
    const first = kernel.apply({ type: "INTERACT", actorId: mikula.id, targetId: fedot.id });
    if (!first.ok) throw new Error("РѕСЃРІРѕР±РѕР¶РґРµРЅРёРµ РЅРµ РїСЂРёРЅСЏС‚Рѕ");
    const pending = afterPrologueApply(
      kernel,
      { type: "INTERACT", actorId: mikula.id, targetId: fedot.id },
      first.events,
      state,
      ctx,
    );
    expect(pending.extractPending).toBe(true);
    const step = kernel.getSnapshot().entities.find((entity) => entity.configId === "mikula_peasant")!;
    const elsewhere = kernel
      .getReachable(mikula.id)
      .filter((cell) => `${cell.x},${cell.y}` !== `${step.x},${step.y}` && cell.apCost === 1)[0]!;
    const second = kernel.apply({ type: "MOVE", actorId: mikula.id, to: { x: elsewhere.x, y: elsewhere.y, z: 1 } });
    if (!second.ok) throw new Error("РІС‚РѕСЂРѕР№ С€Р°Рі РЅРµ РїСЂРёРЅСЏС‚");
    const recovered = afterPrologueApply(
      kernel,
      { type: "MOVE", actorId: mikula.id, to: { x: elsewhere.x, y: elsewhere.y, z: 1 } },
      second.events,
      pending,
      ctx,
    );
    // Р‘РµР· СЌС‚РѕР№ СЃС‚СЂР°С…РѕРІРєРё Р·РѕРЅР° РѕСЃС‚Р°Р»Р°СЃСЊ Р±С‹ С‚С‘РјРЅРѕР№ Рё РјРёСЃСЃРёСЋ РЅРµР»СЊР·СЏ Р±С‹Р»Рѕ Р±С‹
    // Р·Р°РІРµСЂС€РёС‚СЊ: СЏРґСЂРѕ РѕС‚РєСЂС‹РІР°РµС‚ РµС‘ РЅР° СЃР»РµРґСѓСЋС‰РµРј Р¶Рµ РїСЂРёРјРµРЅРµРЅРёРё РєРѕРјР°РЅРґС‹.
    expect(recovered.extractPending).toBe(false);
    expect(kernel.getSnapshot().grid.tiles.some((tile) => tile.extract)).toBe(true);
  });
});

describe("prologue M2 reinforcements (0.21.19)", () => {
  it("РЅРµ РїСЂРёР±Р°РІР»СЏРµС‚ СЃРІРµСЂС… РїРѕС‚РѕР»РєР° Р·Р° С…РѕРґ РќР°РІРё, Р° РЅРµ Р·Р° РєР°Р¶РґСѓСЋ РєРѕРјР°РЅРґСѓ", () => {
    const { kernel, ctx, state } = m2SwarmSetup();
    const freed = freeFedot(kernel, ctx, state);
    expect(freed.waveArmed).toBe(true);
    expect(ratsOf(kernel), "СЃС‚Р°СЏ РґРѕСЃС‹РїР°Р»Р° РґРѕ РїРѕС‚РѕР»РєР°").toBe(4);

    kernel.apply({ type: "END_TURN", playerId: "1" });
    const turn = runNavTurn(kernel, ctx, freed);

    // Р§РµС‚С‹СЂРµ РєСЂС‹СЃС‹ СЃС‚Р°Рё СЃС‚РѕСЏС‚ Сѓ РїРѕС‚РѕР»РєР°: Р·Р° С…РѕРґ РЅРёС‡РµРіРѕ РЅРµ РїСЂРёР±Р°РІРёР»РѕСЃСЊ вЂ”
    // РїСЂРµР¶РґРµ Р·Р° СЌС‚РѕС‚ Р¶Рµ С…РѕРґ РІС‹С…РѕРґРёР»Рѕ РґРѕ РґРµРІСЏРЅРѕСЃС‚Р°, РїРѕ РєСЂС‹СЃРµ РЅР° РєРѕРјР°РЅРґСѓ РќР°РІРё.
    expect(ratsOf(kernel), "РїРѕС‚РѕР»РѕРє РґРµСЂР¶РёС‚СЃСЏ").toBe(4);
    expect(turn.commands, "С…РѕРґ РќР°РІРё РєРѕРЅРµС‡РµРЅ").toBeLessThan(96);
    expect(
      turn.ended,
      "С…РѕРґ РќР°РІРё Р·Р°РІРµСЂС€С‘РЅ РєРѕРјР°РЅРґРѕР№, Р° РЅРµ РїСЂРµРґРѕС…СЂР°РЅРёС‚РµР»РµРј",
    ).toBe(true);
    expect(kernel.getSnapshot().activeOwner, "С…РѕРґ РІРµСЂРЅСѓР»СЃСЏ РёРіСЂРѕРєСѓ").toBe(1);
  });

  it("СѓР±РёС‚Р°СЏ РєСЂС‹СЃР° РІРѕСЃРїРѕР»РЅСЏРµС‚СЃСЏ РґРѕ С‡РµС‚С‹СЂС‘С… Р·Р° С…РѕРґ РќР°РІРё", () => {
    const { kernel, ctx, state } = m2SwarmSetup();
    const freed = freeFedot(kernel, ctx, state);
    // РћРґРЅР° РєСЂС‹СЃР° РїР°Р»Р°: РЅР° РїРѕР»Рµ РѕСЃС‚Р°Р»РѕСЃСЊ С‚СЂРѕРµ, Р° СЃС‡С‘С‚С‡РёРє СѓР±РёР№СЃС‚РІ РІРµРґС‘С‚ РёС‚РѕРі
    // РєРѕРјР°РЅРґС‹ РёРіСЂРѕРєР° (В§7.2 Рї. 10).
    const snapshot = kernel.getSnapshot();
    const rat = snapshot.entities.find((entity) => entity.configId === "forest_rat" && !entity.dead)!;
    rat.dead = true;
    kernel.restoreMatch(snapshot, kernel.getFog());
    const killed = { ...freed, reinforcements: noteEnemyKill(freed.reinforcements) };

    kernel.apply({ type: "END_TURN", playerId: "1" });
    runNavTurn(kernel, ctx, killed);
    // РћСЃС‚Р°Р»РѕСЃСЊ С‚СЂРѕРµ Р¶РёРІС‹С…: РїРѕРґРєСЂРµРїР»РµРЅРёРµ РІРѕСЃРїРѕР»РЅСЏРµС‚ СѓР±РёС‚СѓСЋ РґРѕ РїРѕС‚РѕР»РєР°
    // С‡РµС‚С‹СЂС‘С…, Р° РЅРµ РґРѕР±Р°РІР»СЏРµС‚ РґРІРµ СЃРІРµСЂС… РЅРµРіРѕ.
    expect(ratsOf(kernel), "РїРѕС‚РѕР»РѕРє Р·Р°РїРѕР»РЅРµРЅ Р·Р°РЅРѕРІРѕ").toBe(4);
  });

  it("РґРµСЂР¶РёС‚ РїРѕС‚РѕР»РѕРє С‡РµС‚С‹СЂРµ РєСЂС‹СЃС‹ РЅР° РїРѕР»Рµ Рё РЅРµ РєСЂР°РґС‘С‚ С…РѕРґ РёРіСЂРѕРєР°", () => {
    const { kernel, ctx, state } = m2SwarmSetup();
    let current = freeFedot(kernel, ctx, state);
    // Р“РµСЂРѕР№ СЃС‚РѕРёС‚ РїРѕРґ СЃС‚Р°РµР№ Рё РЅРµ СѓР±РµРіР°РµС‚: Р·РґРѕСЂРѕРІСЊРµ РїРѕРґРЅСЏС‚Рѕ, С‡С‚РѕР±С‹ СЃС‡РёС‚Р°С‚СЊ
    // РїРѕРґРєСЂРµРїР»РµРЅРёСЏ, Р° РЅРµ С‚Рѕ, СЃРєРѕР»СЊРєРѕ С…РѕРґРѕРІ РѕРЅ РїСЂРѕРґРµСЂР¶РёС‚СЃСЏ Р±РµР· Р±РѕСЏ.
    const sturdy = kernel.getSnapshot();
    for (const entity of sturdy.entities) {
      if (entity.owner === 1) {
        entity.maxHp = 60;
        entity.hp = 60;
      }
    }
    kernel.restoreMatch(sturdy, kernel.getFog());
    for (let round = 0; round < 4; round += 1) {
      kernel.apply({ type: "END_TURN", playerId: "1" });
      const turn = runNavTurn(kernel, ctx, current);
      current = turn.state;
      expect(ratsOf(kernel), `РїРѕС‚РѕР»РѕРє СЃС‚Р°Рё РІ С…РѕРґСѓ ${round}`).toBeLessThanOrEqual(4);
      expect(turn.ended, `С…РѕРґ РќР°РІРё ${round} Р·Р°РІРµСЂС€С‘РЅ`).toBe(true);
      expect(kernel.getSnapshot().activeOwner, `С…РѕРґ ${round} РІРµСЂРЅСѓР»СЃСЏ РёРіСЂРѕРєСѓ`).toBe(1);
    }
  });
});

describe("prologue M3 wave", () => {
  const M3_LAYOUT = {
    rows: [".M...UP.", ".......R", "...SS...", ".A......"],
    legend: {
      M: { kind: "spawn", side: "player", unitId: "bogatyr" },
      U: { kind: "spawn", side: "enemy", unitId: "upyr" },
      P: { kind: "pit" },
      R: { kind: "spawn", side: "enemy", unitId: "upyr", scripted: true },
      S: { kind: "spawn", side: "enemy", unitId: "upyr", scripted: true },
      A: { kind: "spawn", side: "player", unitId: "strelets", scripted: true },
    },
  };

  function bootM3() {
    const match = createPrologueMatch({ layout: M3_LAYOUT, units: [BOGATYR, UPYR, STRELETS], seed: 703 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [BOGATYR, UPYR, STRELETS],
      weapons: {
        club: CLUB,
        teeth: TEETH,
        bow: weaponStatsFromRecord({
          id: "bow",
          category: "ranged",
          apCost: 1,
          endsTurn: true,
          range: 8,
          requiresLOS: true,
          aimMod: 0,
          minDmg: 3,
          maxDmg: 5,
          crit: 15,
          critBonus: 2,
          envDmg: 0,
        }),
      },
      skills: { breach: BREACH },
      seed: 703,
      fogDisabled: true,
    });
    const compiled = compilePrologueLayout(M3_LAYOUT);
    const ctx = {
      missionId: "prologue_glade" as const,
      hints: [
        { key: "m3.blow", textKey: "prologue.hint.m3.blow", once: true, forced: true, panelKey: "skill" },
        { key: "m3.pit", textKey: "prologue.hint.m3.pit", once: true },
        { key: "m3.more", textKey: "prologue.hint.m3.more", once: true },
        { key: "m3.shot", textKey: "prologue.hint.m3.shot", once: true },
      ],
      showHints: true,
      waveCells: compiled.markers.S,
      rusherCell: compiled.markers.R?.[0],
      allyCell: compiled.markers.A?.[0],
    };
    return { kernel, ctx, state: createPrologueRunState("prologue_glade"), compiled };
  }

  it("locks the hero to breach at the start", () => {
    const state = createPrologueRunState("prologue_glade");
    expect(state.forceSkillId).toBe("breach");
    expect(gatePrologueCommand(state, { type: "DEFEND", actorId: 1 })).toBe(false);
    expect(gatePrologueCommand(state, { type: "END_TURN", playerId: "1" })).toBe(false);
    expect(gatePrologueCommand(state, { type: "ATTACK", actorId: 1, targetId: 2, weaponId: "club" })).toBe(false);
    expect(gatePrologueCommand(state, { type: "USE_SKILL", actorId: 1, skillId: "breach", targetId: 2 })).toBe(true);
    // Рывок: подход к упырю разрешён — иначе замок умения оставлял героя
    // на четырёх клетках от цели.
    expect(gatePrologueCommand(state, { type: "MOVE", actorId: 1, to: { x: 4, y: 0, z: 1 } })).toBe(true);
  });

  it("knocks the first upyr into the pit and spawns a wounded rusher without Fedot", () => {
    const { kernel, ctx, state } = bootM3();
    expect(kernel.getSnapshot().entities.filter((entity) => entity.configId === "upyr")).toHaveLength(1);
    expect(kernel.getSnapshot().entities.some((entity) => entity.configId === "strelets")).toBe(false);
    const bogatyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "bogatyr")!;
    const upyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "upyr")!;
    expect(upyr.x - bogatyr.x).toBe(4);
    expect(upyr.y).toBe(bogatyr.y);
    const step = { x: upyr.x - 1, y: upyr.y, z: bogatyr.z };
    expect(gatePrologueCommand(state, { type: "MOVE", actorId: bogatyr.id, to: step }, kernel.getSnapshot())).toBe(
      true,
    );
    const walked = kernel.apply({ type: "MOVE", actorId: bogatyr.id, to: step });
    expect(walked.ok).toBe(true);
    kernel.setForcedOutcome("min");
    const applied = kernel.apply({ type: "USE_SKILL", actorId: bogatyr.id, skillId: "breach", targetId: upyr.id });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.events.some((event) => event.type === "ENTITY_DIED" && event.causeOfDeath === "FALL_INTO_PIT")).toBe(
      true,
    );
    const next = afterPrologueApply(
      kernel,
      { type: "USE_SKILL", actorId: bogatyr.id, skillId: "breach", targetId: upyr.id },
      applied.events,
      state,
      ctx,
    );
    expect(next.forceSkillId).toBeNull();
    expect(next.firstWave).toBe(true);
    expect(next.handOffPending).toBe(true);
    expect(next.fedotJoined).toBe(false);
    const after = kernel.getSnapshot();
    expect(after.entities.filter((entity) => entity.configId === "upyr" && !entity.dead)).toHaveLength(3);
    expect(after.entities.some((entity) => entity.configId === "strelets")).toBe(false);
    const rusher = after.entities.find((entity) => entity.id === next.rusherId && !entity.dead)!;
    expect(rusher.hp).toBe(Math.floor(rusher.maxHp / 2));
    expect(next.hints.queue).not.toContain("m3.pit");
    expect(next.hints.queue).not.toContain("m3.more");
    expect(next.hints.queue).not.toContain("m3.shot");
  });

  it("lets only the wounded upyr approach, then Fedot one-shots him from the ridge", () => {
    const { kernel, ctx, state } = bootM3();
    const bogatyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "bogatyr")!;
    const upyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "upyr")!;
    const step = { x: upyr.x - 1, y: upyr.y, z: bogatyr.z };
    const walked = kernel.apply({ type: "MOVE", actorId: bogatyr.id, to: step });
    if (!walked.ok) throw new Error("approach rejected");
    kernel.setForcedOutcome("min");
    const blow = kernel.apply({ type: "USE_SKILL", actorId: bogatyr.id, skillId: "breach", targetId: upyr.id });
    if (!blow.ok) throw new Error("breach rejected");
    let run = afterPrologueApply(
      kernel,
      { type: "USE_SKILL", actorId: bogatyr.id, skillId: "breach", targetId: upyr.id },
      blow.events,
      state,
      ctx,
    );
    kernel.apply({ type: "END_TURN", playerId: "1" });
    const healthyBefore = kernel
      .getSnapshot()
      .entities.filter((entity) => entity.configId === "upyr" && !entity.dead && entity.id !== run.rusherId)
      .map((entity) => `${entity.x},${entity.y}`);
    for (let guard = 0; guard < 8; guard += 1) {
      const decision = tickPrologueEnemyTurn(kernel, run, ctx);
      run = decision.state;
      if (!decision.command) {
        kernel.apply({ type: "END_TURN", playerId: "2" });
        break;
      }
      expect(decision.command.type).toBe("MOVE");
      if (decision.command.type === "MOVE") {
        expect(decision.command.actorId).toBe(run.rusherId);
      }
      const applied = kernel.apply(decision.command);
      if (!applied.ok) throw new Error("rusher move rejected");
      run = afterPrologueApply(kernel, decision.command, applied.events, run, ctx);
    }
    const healthyAfter = kernel
      .getSnapshot()
      .entities.filter((entity) => entity.configId === "upyr" && !entity.dead && entity.id !== run.rusherId)
      .map((entity) => `${entity.x},${entity.y}`);
    expect(healthyAfter).toEqual(healthyBefore);
    const rusher = kernel.getSnapshot().entities.find((entity) => entity.id === run.rusherId && !entity.dead)!;
    const hero = kernel.getSnapshot().entities.find((entity) => entity.configId === "bogatyr")!;
    expect(Math.abs(rusher.x - hero.x) + Math.abs(rusher.y - hero.y)).toBeLessThanOrEqual(1);
    expect(kernel.getSnapshot().entities.some((entity) => entity.configId === "strelets" && !entity.dead)).toBe(true);
    const shot = tickProloguePlayerTurn(kernel, run, ctx);
    expect(shot.forceOutcome).toBe("max");
    expect(shot.command?.type).toBe("ATTACK");
    if (shot.command?.type === "ATTACK") expect(shot.command.targetId).toBe(rusher.id);
    if (!shot.command) throw new Error("Fedot did not shoot");
    const fired = kernel.apply(shot.command);
    expect(fired.ok).toBe(true);
    if (!fired.ok) return;
    const afterShot = afterPrologueApply(kernel, shot.command, fired.events, shot.state, ctx);
    expect(afterShot.fedotJoined).toBe(true);
    expect(kernel.getSnapshot().entities.find((entity) => entity.id === run.rusherId)?.dead).toBe(true);
    expect(afterShot.hints.queue).toContain("m3.shot");
  });
});

describe("prologue M4 vasilisa", () => {
  const SLING = weaponStatsFromRecord({
    id: "sling",
    category: "ranged",
    apCost: 1,
    endsTurn: true,
    range: 5,
    requiresLOS: true,
    aimMod: 0,
    minDmg: 2,
    maxDmg: 4,
    crit: 10,
    critBonus: 1,
    envDmg: 0,
  });
  const layout = {
    rows: [
      "t.HH.tHHH..HHt",
      "..HH..HHH..HH.",
      "...z.........t",
      "M...U..K.t..t.",
      "A.....U...Kc..",
      ".t.c....c....t",
      "HH..t...t.HH..",
      "HH.t..W..tHHtt",
      "ttt.t...tttttt",
    ],
    legend: {
      M: { kind: "spawn", side: "player", unitId: "bogatyr" },
      A: { kind: "spawn", side: "player", unitId: "strelets" },
      U: { kind: "spawn", side: "enemy", unitId: "upyr" },
      z: { kind: "spawn", side: "player", unitId: "znaharka", scripted: true },
    },
  };

  it("compiles multi-cell huts as walls next to the squad", () => {
    const compiled = compilePrologueLayout(layout);
    const hut = compiled.grid.tiles.find((tile) => tile.x === 2 && tile.y === 0)!;
    const boulder = compiled.grid.tiles.find((tile) => tile.x === 6 && tile.y === 7)!;
    const door = compiled.markers.z?.[0];
    expect(hut.blockLOS).toBe(true);
    expect(hut.feature).toBe("hut");
    expect(boulder.blockLOS).toBe(true);
    expect(boulder.feature).toBeUndefined();
    expect(door).toEqual({ x: 3, y: 2 });
    expect(compiled.grid.tiles.filter((tile) => tile.feature === "hut")).toHaveLength(22);
    const bogatyr = compiled.markers.M?.[0] ?? { x: 0, y: 3 };
    expect(Math.abs((door?.x ?? 99) - bogatyr.x) + Math.abs((door?.y ?? 99) - bogatyr.y)).toBeLessThanOrEqual(4);
  });

  it("joins a turn after poison or crossing x>=8, not twice, with a sling from the hut", () => {
    const match = createPrologueMatch({ layout, units: [BOGATYR, STRELETS, ZNAHARKA, UPYR], seed: 704 });
    expect(match.entities.some((entity) => entity.configId === "znaharka")).toBe(false);
    const kernel = createTacticsKernel({
      initial: match,
      units: [BOGATYR, STRELETS, ZNAHARKA, UPYR],
      weapons: { club: CLUB, sling: SLING },
      seed: 704,
    });
    const compiled = compilePrologueLayout(layout);
    const ctx = { missionId: "prologue_village", hints: [], showHints: true, healerCell: compiled.markers.z?.[0] };
    let state = createPrologueRunState("prologue_village");
    const bogatyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "bogatyr")!;
    state = afterPrologueApply(
      kernel,
      { type: "MOVE", actorId: bogatyr.id, to: { x: 8, y: 3, z: 1 } },
      [
        {
          type: "ENTITY_MOVED",
          entityId: bogatyr.id,
          path: [
            { x: 0, y: 3, z: 1 },
            { x: 8, y: 3, z: 1 },
          ],
          isDash: false,
          apSpent: 1,
        },
      ],
      state,
      ctx,
    );
    expect(state.vasilisaPending).toBe(true);
    expect(state.vasilisaJoined).toBe(false);
    expect(kernel.getSnapshot().entities.some((entity) => entity.configId === "znaharka")).toBe(false);
    state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "2" }, [], state, ctx);
    expect(state.vasilisaJoined).toBe(false);
    state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, [], state, ctx);
    expect(state.vasilisaJoined).toBe(true);
    expect(state.vasilisaPending).toBe(false);
    const healers = kernel.getSnapshot().entities.filter((entity) => entity.configId === "znaharka");
    expect(healers).toHaveLength(1);
    expect(healers[0]?.weaponIds).toContain("sling");
    expect(healers[0]?.weaponId).toBe("sling");
    expect(healers[0]?.x).toBe(3);
    expect(healers[0]?.y).toBe(2);
    state = afterPrologueApply(
      kernel,
      { type: "USE_SKILL", actorId: 2, skillId: "poison_needles", targetId: bogatyr.id },
      [
        {
          type: "STATUS_CHANGED",
          entityId: bogatyr.id,
          status: "POISON",
          applied: true,
          duration: 2,
          magnitude: 1,
          sourceId: 99,
        },
      ],
      state,
      ctx,
    );
    expect(kernel.getSnapshot().entities.filter((entity) => entity.configId === "znaharka")).toHaveLength(1);
  });

  it("holds the healer until the player ends the poisoned turn", () => {
    const match = createPrologueMatch({ layout, units: [BOGATYR, STRELETS, ZNAHARKA, UPYR], seed: 704 });
    const kernel = createTacticsKernel({
      initial: match,
      units: [BOGATYR, STRELETS, ZNAHARKA, UPYR],
      weapons: { club: CLUB, sling: SLING },
      seed: 704,
    });
    const compiled = compilePrologueLayout(layout);
    const ctx = { missionId: "prologue_village", hints: [], showHints: true, healerCell: compiled.markers.z?.[0] };
    const bogatyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "bogatyr")!;
    let state = afterPrologueApply(
      kernel,
      { type: "USE_SKILL", actorId: 2, skillId: "poison_needles", targetId: bogatyr.id },
      [
        {
          type: "STATUS_CHANGED",
          entityId: bogatyr.id,
          status: "POISON",
          applied: true,
          duration: 2,
          magnitude: 1,
          sourceId: 99,
        },
      ],
      createPrologueRunState("prologue_village"),
      ctx,
    );
    expect(state.vasilisaPending).toBe(true);
    expect(state.vasilisaJoined).toBe(false);
    expect(kernel.getSnapshot().entities.some((entity) => entity.configId === "znaharka")).toBe(false);
    state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "2" }, [], state, ctx);
    expect(state.vasilisaJoined).toBe(false);
    state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, [], state, ctx);
    expect(state.vasilisaJoined).toBe(true);
    expect(kernel.getSnapshot().entities.filter((entity) => entity.configId === "znaharka")).toHaveLength(1);
  });
});

describe("prologue death restarts the mission", () => {
  it("restarts on any player combatant death, even before a scene beat", () => {
    const match = {
      turnNumber: 2,
      activeOwner: 1,
      grid: { width: 4, height: 4, tiles: [] },
      entities: [
        {
          id: 1,
          configId: "bogatyr",
          owner: 1,
          dead: true,
          coverType: 0,
          x: 0,
          y: 0,
          z: 1,
          dir: 1,
          ap: 0,
          maxAp: 2,
          mobility: 4,
          hp: 0,
          maxHp: 12,
          aim: 70,
          defense: 0,
          vision: 10,
          weaponId: "sword",
          obstacle: true,
          flying: false,
          overwatch: false,
          defending: false,
          movementSpent: 0,
        },
      ],
    };
    const wave = createPrologueRunState("prologue_glade");
    wave.firstWave = true;
    expect(
      shouldRestartPrologueMission(
        wave,
        [{ type: "ENTITY_DIED", entityId: 1, causeOfDeath: "DAMAGE" }],
        match as never,
      ),
    ).toBe(true);
    const start = createPrologueRunState("prologue_glade");
    expect(
      shouldRestartPrologueMission(
        start,
        [{ type: "ENTITY_DIED", entityId: 1, causeOfDeath: "DAMAGE" }],
        match as never,
      ),
    ).toBe(true);
  });
});

describe("prologue player script", () => {
  it("holds Fedot's shot until the wounded rusher is adjacent", () => {
    const layout = {
      rows: [".M...", ".....", "U....", "....A"],
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
      weapons: {
        club: CLUB,
        teeth: TEETH,
        bow: weaponStatsFromRecord({
          id: "bow",
          category: "ranged",
          apCost: 1,
          endsTurn: true,
          range: 8,
          requiresLOS: true,
          aimMod: 0,
          minDmg: 3,
          maxDmg: 5,
          crit: 15,
          critBonus: 2,
          envDmg: 0,
        }),
      },
      seed: 705,
      fogDisabled: true,
    });
    kernel.spawnScripted("strelets", 1, { x: 2, y: 2, z: 1 });
    const upyr = kernel.getSnapshot().entities.find((entity) => entity.configId === "upyr")!;
    const state = createPrologueRunState("prologue_glade");
    state.forceSkillId = null;
    state.firstWave = true;
    state.rusherId = upyr.id;
    const idle = tickProloguePlayerTurn(kernel, state, {
      missionId: "prologue_glade",
      hints: [],
      showHints: true,
    });
    expect(idle.command).toBeNull();
    const placed = kernel.getSnapshot();
    const bogatyr = placed.entities.find((entity) => entity.configId === "bogatyr")!;
    const rusher = placed.entities.find((entity) => entity.id === upyr.id)!;
    rusher.x = bogatyr.x + 1;
    rusher.y = bogatyr.y;
    rusher.hp = Math.floor(rusher.maxHp / 2);
    kernel.restoreMatch(placed, kernel.getFog());
    const decision = tickProloguePlayerTurn(kernel, state, {
      missionId: "prologue_glade",
      hints: [],
      showHints: true,
    });
    expect(decision.forceOutcome).toBe("max");
    expect(decision.command?.type).toBe("ATTACK");
    if (decision.command?.type === "ATTACK") expect(decision.command.targetId).toBe(upyr.id);
  });
});

/* ---------- M1: РєСЂС‹СЃР° РєР°Рє РїРѕР»РЅРѕС†РµРЅРЅС‹Р№ РїСЂРѕС‚РёРІРЅРёРє (0.20.37) ---------- */

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
      // РЎРёРЅС…СЂРѕРЅРЅРѕ СЃ prologue_missions.json5 (0.20.40): СѓРєСѓСЃ РѕР±СЏР·Р°РЅ
      // СЃРѕСЃС‚РѕСЏС‚СЊСЃСЏ, РЅРѕ СЌС‚Рѕ РјРёРЅРёРјР°Р»СЊРЅС‹Р№ СѓСЂРѕРЅ Р·СѓР±РѕРІ.
      forceOutcome: "min",
      onlyIf: "targetAlive",
    },
    { kind: "endTurn" },
  ],
};

/** Р”РѕР№С‚Рё РґРѕ РїР°Р»РєРё Рё РїРѕРґРѕР±СЂР°С‚СЊ РµС‘: РєСЂС‹СЃР° РїРѕСЏРІР»СЏРµС‚СЃСЏ СЃРєСЂРёРїС‚РѕРІРѕ. */
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
      if (applied.ok)
        state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, applied.events, state, ctx);
      break;
    }
    const reach = kernel.getReachable(mikula.id);
    const best = [...reach].sort(
      (a, b) =>
        Math.floor(Math.hypot(a.x - stick.x, a.y - stick.y)) - Math.floor(Math.hypot(b.x - stick.x, b.y - stick.y)),
    )[0];
    if (!best) {
      const applied = kernel.apply({ type: "END_TURN", playerId: "1" });
      if (applied.ok)
        state = afterPrologueApply(kernel, { type: "END_TURN", playerId: "1" }, applied.events, state, ctx);
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
    // РџСЂРѕС‚РёРІРЅРёРєР° РµС‰С‘ РЅРµС‚: С‚СѓРјР°РЅ РќР°РІРё РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚.
    expect(kernel.getVisibleCells(2).size).toBe(0);
    const compiled = compilePrologueLayout(M1_FOG_OFF_LAYOUT as never);
    kernel.spawnScripted("forest_rat", 2, { x: compiled.markers.F![0]!.x, y: compiled.markers.F![0]!.y, z: 1 });
    // РЎС‚РѕСЂРѕРЅР° РїРѕСЏРІРёР»Р°СЃСЊ вЂ” С‚СѓРјР°РЅ РґР»СЏ РЅРµС‘ СЃРѕР·РґР°РЅ Рё (РїСЂРё fogDisabled) СЂР°СЃРєСЂС‹С‚.
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
      // РРіСЂРѕРє РЅРёС‡РµРіРѕ РЅРµ РґРµР»Р°РµС‚ вЂ” С‚РѕР»СЊРєРѕ Р·Р°РІРµСЂС€Р°РµС‚ С…РѕРґ.
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
          // Р РµР·СѓР»СЊС‚Р°С‚ Рё СѓСЂРѕРЅ: РїРµСЂРІС‹Р№ СѓРґР°СЂ РѕР±СЏР·Р°РЅ Р±С‹С‚СЊ РјРёРЅРёРјР°Р»СЊРЅС‹Рј (0.20.40).
          if (event.type === "COMBAT_RESOLVED") outcomes.push(`${event.result}:${event.damageDealt}`);
        }
        if (!decision.command) break;
      }
    }

    // РљСЂС‹СЃР° Р±СЊС‘С‚ РєР°Р¶РґС‹Р№ С…РѕРґ: Р°Р»РіРѕСЂРёС‚Рј РЅРµ РІС‹РґР°С‘С‚ РЅРё РѕРґРЅРѕР№ РѕС‚РІРµСЂРіРЅСѓС‚РѕР№ РєРѕРјР°РЅРґС‹.
    expect(rejections).toEqual([]);
    expect(overwatch).toBe(false);
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
    // РџРµСЂРІС‹Р№ СЃРєСЂРёРїС‚РѕРІС‹Р№ СѓРґР°СЂ вЂ” РјРёРЅРёРјР°Р»СЊРЅС‹Р№ СѓСЂРѕРЅ Р·СѓР±РѕРІ (0.20.40): СѓРєСѓСЃ
    // СЃРѕСЃС‚РѕСЏР»СЃСЏ, РЅРѕ СѓС‡РµР±РЅС‹Р№ Р±РѕР№ РЅРµ РєР°Р»РµС‡РёС‚ РіРµСЂРѕСЏ СЃР»СѓС‡Р°Р№РЅС‹Рј РјР°РєСЃРёРјСѓРјРѕРј.
    expect(outcomes[0]).toBe("HIT:2");
    // Р”Р°Р»СЊС€Рµ С‡РµСЃС‚РЅС‹Рµ РєРѕСЃС‚Рё: Р·Р° РѕСЃС‚Р°РІС€РёРµСЃСЏ С…РѕРґС‹ РњРёРєСѓР»Р° РїРѕР»СѓС‡Р°РµС‚ РµС‰С‘ СѓСЂРѕРЅ.
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
    // РЎРµРІРµСЂРЅС‹Рµ РІСЃС…РѕР»РјР»РµРЅРёСЏ.
    expect(at(4, 0).z).toBe(2);
    // РўСЂРѕРїР° РњРёРєСѓР»С‹ Рё РєР»РµС‚РєР° РїР°Р»РєРё вЂ” СЂРѕРІРЅС‹Р№ СЏСЂСѓСЃ.
    expect(at(1, 3).z).toBe(1);
    expect(at(19, 3).z).toBe(1);
    // РўРѕС‡РєР° РІС‹С…РѕРґР° РєСЂС‹СЃС‹ вЂ” С‚РѕС‚ Р¶Рµ СЏСЂСѓСЃ, С‡С‚Рѕ Рё РєР»РµС‚РєР° РїР°Р»РєРё: Р±РµР· РїРѕРїСЂР°РІРєРё Рє РјРµС‚РєРѕСЃС‚Рё.
    expect(at(18, 2).z).toBe(at(19, 3).z);
    // РќРёР·РёРЅР° СЃСѓС…РѕРіРѕ СЂСѓС‡СЊСЏ РЅР° СЋРіРµ.
    expect(at(3, 5).z).toBe(0);
    // Р’Р°Р»СѓРЅС‹ Р±Р»РѕРєРёСЂСѓСЋС‚ РѕР±Р·РѕСЂ Рё РїСЂРѕС…РѕРґ.
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
    // 18 РєР»РµС‚РѕРє РїРѕ РїСЂСЏРјРѕР№: РїРѕР»РЅС‹Р№ СЂС‹РІРѕРє (РґРѕ 10) РЅРµ РґРѕСЃС‚Р°С‘С‚ вЂ” РІС‚РѕСЂРѕРјСѓ С…РѕРґСѓ РµСЃС‚СЊ С‡РµРјСѓ СѓС‡РёС‚СЊ.
    expect(Math.floor(Math.hypot(stick.x - mikula.x, stick.y - mikula.y))).toBeGreaterThanOrEqual(18);
    expect(kernel.getReachable(mikula.id).some((cell) => cell.x === stick.x && cell.y === stick.y)).toBe(false);
    // РњР°СЂС€СЂСѓС‚ Рє РїР°Р»РєРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚: РјРёСЃСЃРёСЏ РїСЂРѕС…РѕРґРёРјР°.
    expect(kernel.getReachable(mikula.id).length).toBeGreaterThan(0);
  });
});

describe("prologue M1 death restart (0.20.37)", () => {
  function deadMikulaSnapshot(kernel: ReturnType<typeof createTacticsKernel>) {
    const snap = kernel.getSnapshot();
    const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant")!;
    return {
      mikula,
      events: [{ type: "ENTITY_DIED", entityId: mikula.id, causeOfDeath: "DAMAGE" }] as never[],
      match: {
        ...snap,
        entities: snap.entities.map((entity) => (entity.id === mikula.id ? { ...entity, hp: 0, dead: true } : entity)),
      },
    };
  }

  it("marks the rat as spawned once so a later pickup does not add another", () => {
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

  it("restarts the mission from the beginning when Mikula dies", () => {
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
    // РљРѕРЅС‚СЂРѕР»СЊРЅР°СЏ С‚РѕС‡РєР° Р°РєС‚РёРІРЅР° вЂ” РіРёР±РµР»СЊ РњРёРєСѓР»С‹ РѕС‚РєР°С‚С‹РІР°РµС‚ СЃС†РµРЅСѓ.
    expect(shouldRestartPrologueMission(state, events, dead)).toBe(true);
    // Р”Рѕ РїРѕСЏРІР»РµРЅРёСЏ РєСЂС‹СЃС‹ РєРѕРЅС‚СЂРѕР»СЊРЅРѕР№ С‚РѕС‡РєРё РЅРµС‚: СЌС‚Рѕ С‡РµСЃС‚РЅРѕРµ РїРѕСЂР°Р¶РµРЅРёРµ.
    const before = createPrologueRunState("prologue_brushwood");
    expect(shouldRestartPrologueMission(before, events, dead)).toBe(true);
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
    // РќР°РєРѕРїРёС‚РµР»СЊ РѕРїСѓСЃС‚РѕС€С‘РЅ: РѕРґРЅРѕ Рё С‚Рѕ Р¶Рµ СЃРѕР±С‹С‚РёРµ РЅРµ РїСЂРѕРёРіСЂС‹РІР°РµС‚СЃСЏ РґРІР°Р¶РґС‹.
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
