import { useCallback } from "react";
import { ENEMY_OWNER, PLAYER_OWNER, type GameEvent } from "@bylina/core";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";

export function useBattleOutcomeGate(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  prologue: BattlePrologueModel,
) {
  const { session, deployment, outcomeGate, activeMissionId } = base;
  const { isReplay, isTraining, isPrologue, battleKind, mission } = kinds;
  const { snapshot } = snapshotModel;

  const finishFromEvents = useCallback(
    (events: GameEvent[]): void => {
      const ended = events.find((event) => event.type === "MATCH_ENDED");
      if (!ended || ended.type !== "MATCH_ENDED") return;
      // Повтор: партия не «завершается»; обучение завершает экран отдельным эффектом.
      if (isReplay || isTraining || isPrologue) return;
      if (battleKind === "pvp" || battleKind === "pvpNet") {
        const winner =
          ended.winnerPlayerId === String(PLAYER_OWNER) ? 1 : ended.winnerPlayerId === String(ENEMY_OWNER) ? 2 : null;
        if (winner) outcomeGate.report(() => session.finishPvpMatch(winner));
        return;
      }
      const outcome = ended.winnerPlayerId === String(PLAYER_OWNER) ? "victory" : "defeat";
      if (battleKind === "campaign") {
        // Исходы бойцов высадки: сопоставление по явной метке rosterIndex,
        // а не по порядку идентификаторов. Метка не зависит от призывов,
        // иллюзий и удалённых с поля сущностей.
        // Полный снимок ведущего: гибель генерала фиксируется даже вне обзора
        // стороны игрока (сокращённый снимок не содержит чужих сущностей вне
        // поля зрения — иначе окончательная гибель не была бы учтена).
        const full = session.getBattleFullSnapshot();
        const final = session.getBattleSnapshot(PLAYER_OWNER);
        const generalDeaths = (mission?.generals ?? []).filter((generalId) => {
          // Генералы спавнятся ядром с id ≥ 500 (match.ts): гибель рядового
          // с тем же configId не засчитывается генералу.
          const general = full?.entities.find(
            (entity) => entity.configId === generalId && entity.owner === ENEMY_OWNER && entity.id >= 500,
          );
          return general?.dead === true;
        });
        const participants = deployment.map((fighterId, index) => {
          const entity = final.entities.find(
            (candidate) =>
              candidate.owner === PLAYER_OWNER && candidate.coverType === 0 && candidate.rosterIndex === index,
          );
          if (entity) return { fighterId, survived: !entity.dead, hp: entity.hp };
          // Эвакуированный боец (разведка) выжил: здоровье на момент ухода
          // зафиксировано ядром в состоянии боя (0.13.0).
          const extracted = (final.extracted ?? []).find((entry) => entry.rosterIndex === index);
          if (extracted) return { fighterId, survived: true, hp: extracted.hp };
          return { fighterId, survived: false, hp: 0 };
        });
        outcomeGate.report(() => session.finishCampaignMission(outcome, participants, generalDeaths));
        return;
      }
      outcomeGate.report(() => session.finishMatch(outcome));
    },
    [
      activeMissionId,
      battleKind,
      deployment,
      isPrologue,
      isReplay,
      isTraining,
      mission,
      outcomeGate,
      session,
      snapshot,
    ],
  );

  return {
    finishFromEvents,
  };
}

export type BattleOutcomeModel = ReturnType<typeof useBattleOutcomeGate>;
