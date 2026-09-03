import { useMemo } from "react";
import { PLAYER_OWNER } from "@bylina/core";
import { useBattleNetwork } from "../useBattleNetwork.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";

export function useBattleKinds(base: BattleScreenBase) {
  const { session, content, battleKind, activeMissionId } = base;

  const isReplay = battleKind === "replay";
  const replayJournal = session.get().replayJournal;

  const isTraining = battleKind === "training";
  const isPrologue = battleKind === "prologue";

  const trainingMission = isTraining
    ? content.training.missions.find((mission) => mission.id === session.get().trainingMissionId)
    : undefined;

  const prologueMission = isPrologue
    ? content.prologue.missions.find((mission) => mission.id === session.get().prologueMissionId)
    : undefined;

  const mission =
    battleKind === "campaign" && activeMissionId ? session.getCampaign().getMission(activeMissionId) : undefined;

  const network = useBattleNetwork(session, battleKind);
  const { isNetGuest, isSpectator } = network;

  // Поочерёдная игра: каждый рендер показывает сторону, чей сейчас ход
  // (скрытие панели чужой стороны и туман стороны при передаче устройства).
  // Сетевой ведомый всегда видит только свою сторону; ведущий — активную.
  const netOwner = battleKind === "pvpNet" ? session.get().netOwner : null;

  const pvpActive =
    battleKind === "pvp" || battleKind === "pvpNet"
      ? isNetGuest || isSpectator
        ? netOwner
        : session.getBattleFullSnapshot()?.activeOwner ?? PLAYER_OWNER
      : null;

  const viewOwner = pvpActive ?? PLAYER_OWNER;

  const usesNetSnapshot = battleKind === "pvpNet" && Boolean(isNetGuest);

  const side = useMemo(() => ({ viewOwner, isSpectator, isReplay }), [viewOwner, isSpectator, isReplay]);

  // Владелец вражеской стороны: у ведущего — противник активной стороны.
  const enemyOwner = viewOwner === 1 ? 2 : 1;

  return {
    battleKind,
    isReplay,
    replayJournal,
    isTraining,
    isPrologue,
    trainingMission,
    prologueMission,
    mission,
    isNetGuest,
    isSpectator,
    netOwner,
    pvpActive,
    viewOwner,
    enemyOwner,
    usesNetSnapshot,
    side,
  };
}

export type BattleKinds = ReturnType<typeof useBattleKinds>;
