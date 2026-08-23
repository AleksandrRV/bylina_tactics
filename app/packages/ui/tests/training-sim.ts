import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import {
  createMissionMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  weaponStatsFromRecord,
  pickScriptedEnemyCommand,
  ENEMY_OWNER,
  PLAYER_OWNER,
  livingOf,
  matchOutcome,
  type Command,
  type GameEvent,
  type MatchState,
  type ReachableCell,
  type SkillStats,
  type TacticsKernel,
  type TrainingEnemyScriptState,
  type WeaponStats,
} from "@bylina/core";
import type { TrainingMissionConfig } from "@bylina/content";
import {
  resolveTrainingDirective,
  trainingCommandAllowed,
  trainingStepCompleted,
  type TrainingDirectiveView,
  type TrainingScenarioDeps,
} from "../src/training-scenario.js";
import { trainingHintsSorted } from "../src/training-progress.js";

/** Семена сессии: окружение миссий фиксировано (session.startTrainingMission). */
export const SESSION_SEEDS: Record<string, number> = { movement: 101, combat: 46, skills: 303 };

export function dataTree(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../content/data");
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

export interface TrainingRig {
  kernel: TacticsKernel;
  mission: TrainingMissionConfig;
  skills: Record<string, SkillStats>;
  hints: ReturnType<typeof trainingHintsSorted>;
  deps: TrainingScenarioDeps;
}

export function makeRig(missionId: string, seedOverride?: number): TrainingRig {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.training.missions.find((m) => m.id === missionId);
  if (!mission) throw new Error(`no training mission ${missionId}`);
  const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
  for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);
  const skills: Record<string, SkillStats> = {};
  for (const s of parsed.data.skills) skills[s.id] = s as unknown as SkillStats;
  const seed = seedOverride ?? SESSION_SEEDS[missionId]!;
  const kernel = createTacticsKernel({
    initial: createMissionMatch({
      units: parsed.data.units,
      map: mission.map,
      playerSlots: mission.playerSlots,
      enemies: mission.enemies,
      seed,
    }),
    weapons,
    skills,
    units: parsed.data.units,
    seed,
  });
  const deps: TrainingScenarioDeps = {
    snapshot: kernel.getSnapshot(),
    reachable: (actorId) => kernel.getReachable(actorId),
    hitPreview: (actorId, targetId, weaponId) => kernel.getHitPreview(actorId, targetId, weaponId),
    skillPreview: (actorId, skillId, targetId, pos) => kernel.getSkillPreview(actorId, skillId, targetId, pos),
    skills,
  };
  return { kernel, mission, skills, hints: trainingHintsSorted(mission.hints), deps };
}

export function refreshDeps(rig: TrainingRig): TrainingScenarioDeps {
  rig.deps.snapshot = rig.kernel.getSnapshot();
  return rig.deps;
}

/** Команда игрока, точно соответствующая указанию (что разрешено сценарием). */
export function commandFromDirective(view: TrainingDirectiveView): Command {
  const d = view.directive;
  switch (d.kind) {
    case "noop":
      throw new Error("noop directive has no command");
    case "move":
      return { type: "MOVE", actorId: d.actorId, to: d.cell };
    case "attack":
      return { type: "ATTACK", actorId: d.actorId, targetId: d.targetId, weaponId: d.weaponId };
    case "skill":
      return {
        type: "USE_SKILL",
        actorId: d.actorId,
        skillId: d.skillId,
        targetId: d.targetId,
        targetPos: d.cell,
      };
    case "defend":
      return { type: "DEFEND", actorId: d.actorId };
    case "overwatch":
      return { type: "OVERWATCH", actorId: d.actorId };
    case "endTurn":
      return { type: "END_TURN", playerId: String(PLAYER_OWNER) };
  }
}

export interface MissionRun {
  over: "victory" | "defeat" | null;
  visited: string[];
  notes: { poison: number; resurrect: number; summon: number };
  rejected: Command[];
  turns: number;
  /** Все шаги выполнены (для миссии без противника — это победа). */
  stepsDone: boolean;
}

export interface RunOptions {
  /** Имитация «непослушного» игрока: команды подменяются этими до хода. */
  intruder?: (rig: TrainingRig, view: TrainingDirectiveView) => Command | null;
}

/**
 * Полный прогон миссии строгого сценария: игрок исполняет ТОЛЬКО указания
 * (каждая команда проходит финальную проверку trainingCommandAllowed — ту же,
 * что и интерфейс), Навь действует по сценарию миссии. Возвращает итог,
 * порядок шагов, сработавшие реактивные плашки и отклонённые команды.
 */
export function runMission(missionId: string, options: RunOptions = {}): MissionRun {
  const rig = makeRig(missionId);
  const visited: string[] = [];
  const notes = { poison: 0, resurrect: 0, summon: 0 };
  const rejected: Command[] = [];
  let step = 0;
  let over: "victory" | "defeat" | null = null;
  let turns = 0;
  const hasEnemies = rig.mission.enemies.length > 0;
  const scriptState: TrainingEnemyScriptState = { index: 0 };

  const track = (events: GameEvent[]): void => {
    for (const event of events) {
      if (event.type === "STATUS_CHANGED" && event.status === "POISON" && event.applied) notes.poison += 1;
      if (event.type === "ENTITY_SPAWNED" && event.cause === "RESURRECTION") notes.resurrect += 1;
      if (event.type === "ENTITY_SPAWNED" && event.cause === "SUMMON") notes.summon += 1;
    }
  };

  const stepsDone = (): boolean => step >= rig.hints.length;

  for (let guard = 0; guard < 400 && !over; guard += 1) {
    const snap = rig.kernel.getSnapshot();
    const outcome = matchOutcome(snap);
    if (hasEnemies ? outcome === "victory" : stepsDone()) {
      over = "victory";
      break;
    }
    if (outcome === "defeat") {
      over = "defeat";
      break;
    }
    if (snap.activeOwner === PLAYER_OWNER) {
      // Ход игрока: выполнять указания до конца хода стороны. Миссия без
      // противника по правилам ядра «выиграна» с самого начала — исход ядра
      // для неё не критерий (как в BattleScreen), критерий — шаги.
      for (let inner = 0; inner < 24; inner += 1) {
        const s2 = rig.kernel.getSnapshot();
        if (s2.activeOwner !== PLAYER_OWNER) break;
        if (hasEnemies && matchOutcome(s2) !== "ongoing") break;
        if (stepsDone()) break;
        const hint = rig.hints[step]!;
        const view = resolveTrainingDirective(hint, refreshDeps(rig));
        if (!view) {
          // Невыполнимый шаг пропускается — как в BattleScreen.
          visited.push(`${hint.until}:skip`);
          step += 1;
          continue;
        }
        if (view.directive.kind === "noop") {
          visited.push(hint.until);
          step += 1;
          continue;
        }
        const intruded = options.intruder?.(rig, view) ?? null;
        const command = intruded ?? commandFromDirective(view);
        if (!trainingCommandAllowed(view, command)) {
          // Финальная проверка отклонила команду — так же поступил бы UI.
          rejected.push(command);
          if (intruded) continue;
          throw new Error(`directive command rejected by scenario gate: ${JSON.stringify(command)}`);
        }
        if (intruded) continue; // непослушная команда отвергнута — шаг не двигается
        const applied = rig.kernel.apply(command);
        if (!applied.ok) throw new Error(`kernel rejected directive command: ${JSON.stringify(command)} → ${applied.reason}`);
        track(applied.events);
        if (trainingStepCompleted(hint, applied.events, rig.kernel.getSnapshot())) {
          visited.push(hint.until);
          step += 1;
        }
      }
      // Смена хода: шаг end_turn делает это сам; если сторона игрока всё ещё
      // активна при невыполненных шагах — сценарий сломан (застрял).
      const s3 = rig.kernel.getSnapshot();
      if (s3.activeOwner === PLAYER_OWNER && !stepsDone()) {
        throw new Error(`scenario stuck at step ${step} (${rig.hints[step]?.until})`);
      }
      if (s3.activeOwner === PLAYER_OWNER && stepsDone() && hasEnemies && matchOutcome(s3) !== "victory") {
        throw new Error("steps exhausted before victory in an enemy mission");
      }
      turns += 1;
    } else if (snap.activeOwner === ENEMY_OWNER) {
      for (let inner = 0; inner < 24; inner += 1) {
        const s2 = rig.kernel.getSnapshot();
        if (s2.activeOwner !== ENEMY_OWNER) break;
        if (matchOutcome(s2) !== "ongoing") break;
        const decision = pickScriptedEnemyCommand(rig.kernel, rig.mission.enemyScript, scriptState);
        scriptState.index = decision.state.index;
        const applied = decision.command
          ? rig.kernel.apply(decision.command)
          : rig.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        if (!applied.ok) {
          rig.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
          break;
        }
        track(applied.events);
        if (!decision.command) break;
      }
      turns += 1;
    } else {
      break;
    }
  }

  if (!over) {
    const outcome = matchOutcome(rig.kernel.getSnapshot());
    const players = livingOf(rig.kernel.getSnapshot(), PLAYER_OWNER).length;
    const enemies = livingOf(rig.kernel.getSnapshot(), ENEMY_OWNER).length;
    if (outcome === "victory") over = "victory";
    else if (outcome === "defeat" || players === 0) over = "defeat";
    else over = enemies === 0 && hasEnemies ? "victory" : null;
  }

  return { over, visited, notes, rejected, turns, stepsDone: stepsDone() };
}

/** Снимок MissionState после первого хода противника (для проверок сценария). */
export function snapshotAfterEnemyTurn(missionId: string): MatchState {
  const rig = makeRig(missionId);
  const state: TrainingEnemyScriptState = { index: 0 };
  // Игрок пропускает ход (в тесте важна лишь Навь).
  rig.kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
  for (let guard = 0; guard < 24; guard += 1) {
    const snap = rig.kernel.getSnapshot();
    if (snap.activeOwner !== ENEMY_OWNER) break;
    const decision = pickScriptedEnemyCommand(rig.kernel, rig.mission.enemyScript, state);
    state.index = decision.state.index;
    const applied = decision.command
      ? rig.kernel.apply(decision.command)
      : rig.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    if (!applied.ok) break;
    if (!decision.command) break;
  }
  return rig.kernel.getSnapshot();
}

/** Достижимые клетки бойца (для конструирования «непослушных» команд). */
export function reachableOf(kernel: TacticsKernel, actorId: number): ReachableCell[] {
  return kernel.getReachable(actorId);
}
