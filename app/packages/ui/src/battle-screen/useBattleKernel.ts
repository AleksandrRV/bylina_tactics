import { useMemo, useState } from "react";
import { defaultTrainingWeapons, weaponStatsFromRecord, type SkillStats, type WeaponStats } from "@bylina/core";
import { createBattleKernel } from "../battle-match.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";

export function useBattleKernel(base: BattleScreenBase, kinds: BattleKinds) {
  const { session, content, difficulty, matchSeed, activeMissionId, deployment } = base;

  const weapons = useMemo(() => {
    // Сборка оружия кампании/обучения/пролога/быстрого матча.
    // Порядок важен: тренировочные базовые → кампания/бестиарий → пролог.
    const base: Record<string, WeaponStats> = defaultTrainingWeapons();
    for (const record of content.weapons) {
      base[record.id] = weaponStatsFromRecord(record);
    }
    for (const record of content.prologueBestiary?.weapons ?? []) {
      base[record.id] = weaponStatsFromRecord(record);
    }
    return base;
  }, [content.weapons, content.prologueBestiary]);

  const skills = useMemo(() => {
    const result: Record<string, SkillStats> = {};
    for (const record of content.skills) result[record.id] = record as SkillStats;
    return result;
  }, [content.skills]);

  // Ядро боя создаётся один раз на монтаж экрана: вид боя сам решает, откуда
  // взять партию — из сохранения, журнала повтора, миссии или быстрого матча
  // (0.20.68). Привязка к сессии осталась здесь: решатель только читает.
  const [kernel] = useState(() => {
    const host = createBattleKernel({
      battleKind: kinds.battleKind,
      content,
      session,
      weapons,
      skills,
      matchSeed,
      difficulty,
      activeMissionId,
      deployment,
      isNetGuest: kinds.isNetGuest,
      prologueMission: kinds.prologueMission ?? null,
      trainingMission: kinds.trainingMission ?? null,
      replayJournal: kinds.replayJournal ?? null,
    });

    if (host) {
      session.bindTacticsHost(host);
    }

    return host;
  });

  return {
    kernel,
    weapons,
    skills,
  };
}

export type BattleKernelModel = ReturnType<typeof useBattleKernel>;
