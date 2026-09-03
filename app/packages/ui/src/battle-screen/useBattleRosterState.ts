import { useMemo, useRef } from "react";
import { PLAYER_OWNER } from "@bylina/core";
import { cellKey } from "../cell-interaction.js";
import { buildEnemyStrip, rememberEnemies, type RememberedEnemy } from "../enemy-strip.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattleRosterState(base: BattleScreenBase, kinds: BattleKinds, snapshotModel: BattleSnapshotModel) {
  const { snapshot, visibleCells } = snapshotModel;
  const { isSpectator, viewOwner, mission, enemyOwner } = kinds;

  // В дружине — только бойцы (0.20.45). Увязший в трясине Федот выходит
  // из списка: пока он immobile (maxAp 0), управлять им нельзя, и пустая
  // карточка с пустой шкалой ОД обещала бы игроку второго бойца, которого
  // у него нет. На поле он виден, а цель миссии названа в шапке.
  const roster = snapshot.entities.filter(
    (entity) =>
      (isSpectator ? entity.owner === 1 || entity.owner === 2 : entity.owner === viewOwner) &&
      entity.coverType === 0 &&
      (entity.dead || entity.maxAp > 0),
  );

  // Показывать портреты противников только если они в зоне видимости
  // (или уже мертвы и были видны). В поочерёдной игре — противники активной
  // стороны; у наблюдателя — все бойцы обеих сторон.
  const knownEnemies = useMemo(
    () =>
      snapshot.entities.filter((entity) => {
        if (entity.owner !== enemyOwner || entity.coverType !== 0) return false;
        if (isSpectator && entity.owner !== 1 && entity.owner !== 2) return false;
        // Снимок стороны содержит только видимых чужих юнитов (math §8.3):
        // погибший противник остаётся в полосе, пока его клетка наблюдаема.
        return visibleCells.has(cellKey(entity.x, entity.y));
      }),
    [snapshot.entities, enemyOwner, isSpectator, visibleCells],
  );

  /**
   * Запомненные противники (0.20.42). Снимок стороны отдаёт только тех,
   * кого дружина видит сейчас, поэтому вышедший из поля зрения противник
   * просто исчез бы из полосы — игрок терял бы счёт врагам. Портрет
   * остаётся, но призрён: камеру к такому врагу вести некуда.
   */
  const seenEnemiesRef = useRef(new Map<number, RememberedEnemy>());
  rememberEnemies(knownEnemies, seenEnemiesRef.current);
  const enemyStrip = buildEnemyStrip(seenEnemiesRef.current, knownEnemies);

  const objectiveEntity = mission
    ? snapshot.entities.find((entity) =>
        mission.type === "destroy"
          ? entity.configId === mission.objectiveUnitId
          : mission.type === "rescue"
            ? entity.configId === mission.escorteeUnitId
            : false,
      )
    : undefined;

  const sideKey = isSpectator
    ? "net.spectator"
    : kinds.battleKind === "pvp" || kinds.battleKind === "pvpNet"
      ? viewOwner === 1
        ? "pvp.side1"
        : "pvp.side2"
      : snapshot.activeOwner !== PLAYER_OWNER
        ? "field.sideEnemy"
        : "field.sidePlayer";

  return {
    roster,
    knownEnemies,
    enemyStrip,
    seenEnemiesRef,
    objectiveEntity,
    sideKey,
  };
}

export type BattleRosterModel = ReturnType<typeof useBattleRosterState>;
