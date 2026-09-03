import { useEffect, useMemo, useState } from "react";
import { pendingCampaignHints, type CampaignHintId } from "../campaign-hints.js";
import type { TacticsKernel } from "@bylina/core";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattleCampaignHints(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  kernel: TacticsKernel | null,
) {
  const { session, hintSettings, campaignHintsDone, setSaveNotice, saveNotice } = base;
  const { battleKind, mission } = kinds;
  const { snapshot } = snapshotModel;

  // Боевые туториалы кампании (0.20.0/0.20.1): «первый бой», «первый леший»,
  // «первая кикимора», «появление генерала». Показываются один раз, отключаются
  // настройкой подсказок; «первый бой» — модальной карточкой, остальные — баннерами,
  // не блокирующими поле.
  const battleWantedHints = useMemo(
    () =>
      pendingCampaignHints({
        showHints: hintSettings.showHints,
        done: campaignHintsDone ?? [],
        onCampaignMap: false,
        lockedCount: 0,
        hasWounded: false,
        rosterTabActive: false,
        forgeTabActive: false,
        onDeployment: false,
        onBattle: battleKind === "campaign" && Boolean(mission),
        enemyTypes: mission?.enemies.map((entry) => entry.unitId) ?? [],
        onBattleWithGeneral: Boolean(mission?.generals?.length),
      }),
    [hintSettings.showHints, campaignHintsDone, battleKind, mission],
  );

  const [battleHintQueue, setBattleHintQueue] = useState<CampaignHintId[]>([]);

  useEffect(() => {
    setBattleHintQueue((previous) => {
      const next = [...previous];
      for (const id of battleWantedHints) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
    // Реагируем на смену набора показываемых подсказок (ключ-идентификатор), а
    // не на новый массив battleWantedHints каждый рендер; setBattleHintQueue —
    // стабильный сеттер. kernel в зависимостях не нужен телу, но оставлен как
    // якорь времени жизни экрана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleWantedHints.join(","), kernel]);

  const activeBattleHint = hintSettings.showHints
    ? (battleHintQueue.find((id) => !session.isCampaignHintShown(id)) ?? null)
    : null;

  const closeBattleHint = (): void => {
    if (!activeBattleHint) return;
    session.markCampaignHintShown(activeBattleHint);
    setBattleHintQueue((previous) => previous.filter((id) => id !== activeBattleHint));
  };

  // Уведомление о записи в начале хода стороны кампании (ui-design §8).
  useEffect(() => {
    if (battleKind !== "campaign") return;
    setSaveNotice(true);
    const timer = window.setTimeout(() => setSaveNotice(false), 1600);
    return () => window.clearTimeout(timer);
  }, [snapshot.turnNumber, battleKind, setSaveNotice]);

  return {
    battleWantedHints,
    battleHintQueue,
    setBattleHintQueue,
    activeBattleHint,
    closeBattleHint,
    saveNotice,
  };
}

export type BattleCampaignHintsModel = ReturnType<typeof useBattleCampaignHints>;
