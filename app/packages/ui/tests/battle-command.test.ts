/**
 * Единый канал команд боевого экрана (0.20.64): куда уходит команда и что
 * сцена пролога делает с её итогами. Прежде обе цепочки решений жили внутри
 * `applyCommand` и проверялись только живыми прогонами пролога и обучения.
 */

import { describe, expect, it } from "vitest";
import type { Command, GameEvent, MatchState } from "@bylina/core";
import {
  prologueAftermath,
  routeCommand,
  type CommandRoutingContext,
  type PrologueAftermathInput,
} from "../src/battle-command.js";
import type { PrologueRunState } from "../src/prologue-battle.js";

const move: Command = { type: "MOVE", actorId: 1, to: { x: 2, y: 0, z: 1 } };
const defend: Command = { type: "DEFEND", actorId: 1 };

function makeContext(overrides: Partial<CommandRoutingContext> = {}): CommandRoutingContext {
  return {
    isSpectator: false,
    isReplay: false,
    outcomePending: false,
    isPvp: false,
    isNetGuest: false,
    isTraining: false,
    trainingAllows: () => true,
    trainingDenial: () => "move",
    isPrologue: false,
    clampPrologue: null,
    prologueAllows: null,
    ...overrides,
  };
}

/** Состояние сцены пролога: ровно те поля, которые читает разбор итога. */
function run(overrides: Record<string, unknown> = {}): PrologueRunState {
  return {
    pendingEvents: [],
    extracted: [],
    outcome: "ongoing",
    ...overrides,
  } as unknown as PrologueRunState;
}

function makeAftermath(overrides: Partial<PrologueAftermathInput> = {}): PrologueAftermathInput {
  return {
    next: run(),
    events: [] as GameEvent[],
    snapshot: {
      turnNumber: 1,
      activeOwner: 1,
      grid: { width: 8, height: 6, tiles: [] },
      entities: [],
    } as unknown as MatchState,
    ...overrides,
  };
}

/** Смерть бойца — повод начать миссию заново (core/prologue-run). */
const death = [{ type: "ENTITY_DIED", id: 1 }] as unknown as GameEvent[];
const spawn = [{ type: "ENTITY_SPAWNED", id: 7 }] as unknown as GameEvent[];

describe("battle command routing (0.20.64)", () => {
  it("drops the command when the input is closed", () => {
    for (const state of [
      { isSpectator: true },
      { isReplay: true },
      { outcomePending: true },
    ] as Partial<CommandRoutingContext>[]) {
      expect(routeCommand(move, makeContext(state)), `состояние ${JSON.stringify(state)}`).toEqual({
        kind: "drop",
      });
    }
  });

  it("sends the command to the host in pvp and net battles", () => {
    expect(routeCommand(move, makeContext({ isPvp: true })), "поочерёдный бой").toEqual({ kind: "sendPvp" });
    expect(routeCommand(move, makeContext({ isNetGuest: true })), "сетевой гость").toEqual({ kind: "sendNet" });
  });

  it("applies the command locally with the scenario unchanged", () => {
    expect(routeCommand(defend, makeContext())).toEqual({ kind: "apply", command: defend });
  });

  it("denies a command the training directive does not prescribe", () => {
    const ctx = makeContext({
      isTraining: true,
      trainingAllows: (command) => command.type === "DEFEND",
      trainingDenial: (command) => (command.type === "MOVE" ? "move" : "defend"),
    });
    expect(routeCommand(defend, ctx), "предписанная стойка").toEqual({ kind: "apply", command: defend });
    expect(routeCommand(move, ctx), "постороннее действие").toEqual({
      kind: "denyTraining",
      action: "move",
    });
  });

  it("applies the command shortened by the prologue scene", () => {
    // Сцена М2 обрывает рывок (0.20.45): герою оставляют одно ОД на стойку.
    const shortened: Command = { type: "MOVE", actorId: 1, to: { x: 1, y: 0, z: 1 } };
    const ctx = makeContext({ isPrologue: true, clampPrologue: () => shortened });
    expect(routeCommand(move, ctx)).toEqual({ kind: "apply", command: shortened });
    // Исполняется укороченная команда, а не исходная — проверка запрета идёт
    // по ней же (шум выдал бы героя раньше времени).
    expect(routeCommand(move, { ...ctx, prologueAllows: (command) => command !== shortened })).toEqual({
      kind: "denyPrologue",
    });
  });
});

describe("prologue aftermath (0.20.64)", () => {
  it("keeps the state and does nothing on an ordinary command", () => {
    const next = run();
    expect(prologueAftermath(makeAftermath({ next }))).toEqual({ kind: "none", state: next });
  });

  it("restarts the mission from the beginning when a player combatant dies", () => {
    const next = run();
    const fallen = makeAftermath({
      next,
      events: death,
      snapshot: {
        ...makeAftermath().snapshot,
        entities: [{ id: 1, owner: 1, coverType: 0, dead: true, configId: "hero" }],
      } as unknown as MatchState,
    });
    expect(prologueAftermath(fallen)).toEqual({ kind: "restart", state: next });
  });

  it("hands the staged spawns to the scene and empties the queue", () => {
    // Сущность уже создана ядром, но на поле её показывает сцена (0.20.39).
    const next = run({ pendingEvents: spawn });
    const result = prologueAftermath(makeAftermath({ next }));
    expect(result.kind).toBe("spawnBeats");
    expect(result.kind === "spawnBeats" && result.events).toEqual(spawn);
    expect(result.state.pendingEvents, "очередь выхода опустела").toEqual([]);
  });
});
