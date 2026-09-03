/**
 * Сборка партии для экрана боя (0.20.68).
 *
 * Экран боя решал, откуда взять партию, одним блоком на сто сорок строк:
 * пролог, обучение, повтор, сетевой ведомый, восстановление из сохранения,
 * поочерёдная игра, кампания, быстрый матч. У каждого — своё начальное
 * состояние и свой набор настроек ядра (зерно, туман, состав юнитов). Блок
 * стоял первым, что видел читатель экрана, хотя к интерфейсу не относился:
 * он готовил правила, а не изображение.
 *
 * Тело вынесено в решатель: `createBattleKernel` по виду боя выбирает рецепт
 * начального состояния и отдаёт готовое ядро. Решатель читает состояние
 * сессии, но не меняет его — привязка ядра осталась в экране, поэтому сборку
 * партии можно проверить без React.
 */

import {
  createMissionMatch,
  createPvpMatch,
  createQuickMatch,
  createTacticsKernel,
  type MatchState,
  type RosterMods,
  type SkillStats,
  type TacticsKernel,
  type WeaponStats,
} from "@bylina/core";
import type { ContentBundle } from "@bylina/content";
import type { SessionApi, SessionState } from "@bylina/session";
import { initPrologueMatch, prologueUnits } from "./prologue-battle.js";

/** Вид боя: тип не экспортируется, выводится из состояния сессии. */
type BattleKind = SessionState["battleKind"];
/** Миссия пролога в том виде, в каком её принимает сценарий. */
type PrologueMission = Parameters<typeof initPrologueMatch>[0];
/** Учебная миссия пролога — элемент комплекта содержания. */
type TrainingMission = ContentBundle["training"]["missions"][number];
/** Журнал повтора из состояния сессии. */
type ReplayJournal = NonNullable<SessionState["replayJournal"]>;
/** Настройки ядра без оружия и умений: их собирает экран. */
type KernelRecipe = Omit<Parameters<typeof createTacticsKernel>[0], "weapons" | "skills">;

/** Всё, что решателю нужно, чтобы собрать партию. */
export interface BattleMatchDeps {
  battleKind: BattleKind;
  content: ContentBundle;
  session: SessionApi;
  weapons: Record<string, WeaponStats>;
  skills: Record<string, SkillStats>;
  /** Зерно из состояния сессии: без него партии берут своё зерно по виду боя. */
  matchSeed: SessionState["matchSeed"];
  difficulty: SessionState["difficulty"];
  activeMissionId: SessionState["activeMissionId"];
  /** Состав высадки кампании: идентификаторы бойцов из состояния сессии. */
  deployment: SessionState["deployment"];
  /** Сетевой ведомый правил не исполняет (0.15.0). */
  isNetGuest: boolean;
  prologueMission: PrologueMission | null;
  trainingMission: TrainingMission | null;
  replayJournal: ReplayJournal | null;
}

/**
 * Собрать ядро для экрана боя. `null` — только сетевой ведомый: правила
 * исполняет ведущий (0.15.0), снимок приходит по каналу.
 */
export function createBattleKernel(deps: BattleMatchDeps): TacticsKernel | null {
  const recipe = battleRecipe(deps);
  if (!recipe) return null;
  return createTacticsKernel({ ...recipe, weapons: deps.weapons, skills: deps.skills });
}

/** Рецепт начального состояния по виду боя. */
function battleRecipe(deps: BattleMatchDeps): KernelRecipe | null {
  const special = specialRecipe(deps);
  if (special) return special;
  if (deps.isNetGuest) return null;
  // Восстановление партии (сохранение 0.13.0): снимок из состояния сессии.
  // Чтение идемпотентно — инициализатор вызывается повторно в StrictMode.
  const restored = deps.session.get().restoredMatch;
  if (restored) {
    return { initial: restored, units: deps.content.units, fog: deps.session.get().restoredFog };
  }
  return { initial: freshMatch(deps), units: deps.content.units };
}

/**
 * Пролог, обучение и повтор берут партию не из общего порядка: у них своя
 * миссия или журнал. Без миссии (без журнала) вид боя общему порядку не
 * помеха — партия собирается как для быстрого матча.
 */
function specialRecipe(deps: BattleMatchDeps): KernelRecipe | null {
  if (deps.battleKind === "prologue" && deps.prologueMission) return prologueRecipe(deps, deps.prologueMission);
  if (deps.battleKind === "training" && deps.trainingMission) return trainingRecipe(deps, deps.trainingMission);
  if (deps.battleKind === "replay" && deps.replayJournal) return replayRecipe(deps, deps.replayJournal);
  return null;
}

function prologueRecipe(deps: BattleMatchDeps, mission: PrologueMission): KernelRecipe {
  const seed = deps.matchSeed || 701;
  return {
    initial: deps.session.get().restoredMatch ?? initPrologueMatch(mission, deps.content, seed),
    units: prologueUnits(deps.content),
    seed,
    fog: deps.session.get().restoredFog,
    fogDisabled: mission.fog === false,
  };
}

function trainingRecipe(deps: BattleMatchDeps, mission: TrainingMission): KernelRecipe {
  const seed = deps.matchSeed || 1;
  return {
    initial: createMissionMatch({
      units: deps.content.units,
      map: mission.map,
      playerSlots: mission.playerSlots,
      enemies: mission.enemies,
      loadouts: deps.content.training.loadouts,
      seed,
    }),
    units: deps.content.units,
    seed,
  };
}

function replayRecipe(deps: BattleMatchDeps, journal: ReplayJournal): KernelRecipe {
  return {
    initial: createPvpMatch({
      units: journal.options.units,
      map: journal.options.map,
      side1: journal.options.side1,
      side2: journal.options.side2,
      objective: journal.options.objective,
      loadouts: journal.options.loadouts,
      seed: journal.options.seed,
    }),
    units: deps.content.units,
    seed: journal.options.seed,
  };
}

/** Партия общего порядка: поочерёдная игра, кампания или быстрый матч. */
function freshMatch(deps: BattleMatchDeps): MatchState {
  const seed = deps.matchSeed || 1;
  if (deps.battleKind === "pvp" || deps.battleKind === "pvpNet") return pvpMatch(deps, seed);
  // Кампания без выбранной миссии не собирается: это быстрый матч.
  if (deps.battleKind === "campaign" && deps.activeMissionId) return campaignMatch(deps, deps.activeMissionId, seed);
  return quickMatch(deps, seed);
}

function pvpMatch(deps: BattleMatchDeps, seed: number): MatchState {
  // Составы сторон из комнаты сбора, поле режима (0.14.0); сетевой ведущий
  // строит ту же партию локально (0.15.0).
  const sides = deps.session.getPvpSides();
  if (!sides) throw new Error("PvP sides are missing");
  return createPvpMatch({
    units: deps.content.units,
    map: deps.content.pvp.map ?? deps.content.quickMatch.map,
    side1: sides.side1,
    side2: sides.side2,
    objective: deps.session.get().pvpObjective ?? "elimination",
    loadouts: deps.content.pvp.loadouts,
    seed,
  });
}

function campaignMatch(deps: BattleMatchDeps, missionId: string, seed: number): MatchState {
  const mission = deps.session.getCampaign().getMission(missionId);
  if (!mission) throw new Error(`Unknown campaign mission: ${missionId}`);
  return createMissionMatch({
    units: deps.content.units,
    map: mission.map,
    playerSlots: deploymentSlots(deps),
    enemies: mission.enemies,
    generals: mission.generals,
    excludedGenerals: deps.session.getCampaign().getState().deadGenerals,
    objective:
      mission.type === "destroy"
        ? { kind: "destroy", unitId: mission.objectiveUnitId! }
        : mission.type === "rescue"
          ? { kind: "rescue", unitId: mission.escorteeUnitId! }
          : mission.type === "recon"
            ? { kind: "recon" }
            : undefined,
    seed,
  });
}

/** Высадка кампании: раны бойца и надетый предмет меняют его характеристики. */
function deploymentSlots(deps: BattleMatchDeps): ({ unitId: string; hp: number } & RosterMods)[] {
  const penalty = deps.content.campaign.woundPenalty;
  const fighters = deps.session.getCampaign().getState().fighters;
  const items = deps.session.getCampaign().getItems();
  return deps.deployment.map((fighterId) => {
    const fighter = fighters.find((candidate) => candidate.id === fighterId);
    if (!fighter || !fighter.alive) throw new Error(`Unknown fighter in deployment: ${fighterId}`);
    const mods: RosterMods = fighter.wounded
      ? { aimMod: penalty.aim, defenseMod: penalty.defense, mobilityMod: penalty.mobility }
      : {};
    // Снаряжение: оружие и модификаторы предмета добавляются к высадке.
    const item = fighter.equippedItemId ? items.find((entry) => entry.id === fighter.equippedItemId) : undefined;
    if (item) {
      mods.aimMod = (mods.aimMod ?? 0) + (item.aimMod ?? 0);
      mods.defenseMod = (mods.defenseMod ?? 0) + (item.defenseMod ?? 0);
      mods.mobilityMod = (mods.mobilityMod ?? 0) + (item.mobilityMod ?? 0);
      if (item.maxHpMod) mods.maxHpMod = (mods.maxHpMod ?? 0) + item.maxHpMod;
      if (item.weaponId) mods.extraWeaponIds = [item.weaponId];
    }
    return { unitId: fighter.unitId, hp: fighter.hp, ...mods };
  });
}

function quickMatch(deps: BattleMatchDeps, seed: number): MatchState {
  const count =
    deps.content.quickMatch.difficulties.find((item) => item.id === deps.difficulty)?.enemyCount ??
    deps.content.quickMatch.difficulties[0]?.enemyCount ??
    3;
  return createQuickMatch({
    units: deps.content.units,
    map: deps.content.quickMatch.map,
    playerSlots: deps.content.quickMatch.playerSlots,
    enemyPool: deps.content.quickMatch.enemyPool,
    loadouts: deps.content.quickMatch.loadouts,
    enemyCount: count,
    seed,
  });
}
