import { useMemo } from "react";
import { PLAYER_OWNER, type MatchState } from "@bylina/core";
import { useBattleRevision } from "../hooks.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";

/**
 * Постоянный пустой снимок для случая, когда сетевой снимок ещё не пришёл
 * (0.21.11): модульная константа, чтобы useMemo не зависел от создаваемого на
 * каждом рендере объекта-пустышки.
 */
const EMPTY_SNAPSHOT: MatchState = {
  turnNumber: 1,
  activeOwner: PLAYER_OWNER,
  grid: { width: 8, height: 6, tiles: [] },
  entities: [],
};

export function useBattleSnapshot(base: BattleScreenBase, kinds: BattleKinds) {
  const { session } = base;
  const { viewOwner, usesNetSnapshot } = kinds;

  // Ревизия боя (0.21.11, P1-1 часть 2): единственный признак устаревания
  // снимка. Меняется один раз на зафиксированное изменение боя — у локального
  // хоста это ревизия ядра, у сетевого ведомого/наблюдателя — счётчик
  // приходящих снимков. Запросы предпросмотра ревизию не двигают.
  const battleRevision = useBattleRevision(session);

  // Снимок вычисляется один раз на изменение боя (ревизия), а не на каждый
  // рендер: getBattleSnapshot отдаёт глубокую копию состояния (P1-1, 0.21.11).
  const snapshot = useMemo<MatchState>(() => {
    // Ревизия боя — намеренный триггер пересчёта снимка: память возвращает
    // свежий снимок один раз на зафиксированное изменение боя (0.21.11).
    void battleRevision;
    if (usesNetSnapshot) return session.getNetSnapshot() ?? EMPTY_SNAPSHOT;
    return session.getBattleSnapshot(viewOwner);
    // viewOwner/usesNetSnapshot зависят от активного владельца, который сам
    // меняется только вместе с боем; ревизия — основной признак устаревания.
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  // Видимость/разведка поля зависят от боя, а не от кадра: ревизия —
  // намеренный триггер пересчёта (тело читает только сервис), поэтому она
  // упоминается в теле, чтобы отношение «зависимость → пересчёт» было явным.
  const visibleCells = useMemo(() => {
    void battleRevision;
    return usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner);
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  const exploredCells = useMemo(() => {
    void battleRevision;
    return usesNetSnapshot ? session.getNetExplored() : session.getBattleExplored(viewOwner);
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  return {
    battleRevision,
    snapshot,
    visibleCells,
    exploredCells,
  };
}

export type BattleSnapshotModel = ReturnType<typeof useBattleSnapshot>;
