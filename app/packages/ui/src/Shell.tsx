import { isBattleScreen, type AppScreen } from "@bylina/session";
import { Suspense, type ComponentType } from "react";
import { BattleScreen } from "./BattleScreen.js";
import { BootScreen } from "./BootScreen.js";
import { CampaignScreen } from "./CampaignScreen.js";
import { DeploymentScreen } from "./DeploymentScreen.js";
import { DifficultyScreen } from "./DifficultyScreen.js";
import { MenuScreen } from "./MenuScreen.js";
import { MissionResultScreen } from "./MissionResultScreen.js";
import { PvpRoomScreen } from "./PvpRoomScreen.js";
import { LevelUpScreen } from "./LevelUpScreen.js";
import { ReplayScreen } from "./ReplayScreen.js";
import { TrainingScreen } from "./TrainingScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { useSessionState } from "./hooks.js";

/**
 * Чистое соответствие экрана сессии компоненту (0.19.2): вынесено из Shell,
 * чтобы маршрутизацию можно было покрыть автоматическими проверками без
 * среды обозревателя. Неизвестный экран завершается главным меню.
 */
export function screenComponent(screen: AppScreen): ComponentType {
  switch (screen) {
    case "boot":
      return BootScreen;
    case "settings":
      return SettingsScreen;
    case "difficulty":
      return DifficultyScreen;
    case "result":
      return ResultScreen;
    case "deployment":
      return DeploymentScreen;
    case "campaign":
      return CampaignScreen;
    case "missionResult":
      return MissionResultScreen;
    case "pvpRoom":
      return PvpRoomScreen;
    case "replays":
      return ReplayScreen;
    case "levelup":
      return LevelUpScreen;
    case "training":
      return TrainingScreen;
    // Экран сражения обучения обрабатывается тем же компонентом, что и бой.
    case "trainingBattle":
    case "battle":
      return BattleScreen;
    default:
      return MenuScreen;
  }
}

export function Shell() {
  const { screen, battleEpoch } = useSessionState();
  const Component = screenComponent(screen);
  // Сражение монтируется заново на каждую «эпоху» боя (0.20.38): ядро
  // партии, счётчик хода, подсказка обучения и карточка миссии живут в
  // состоянии экрана. Переход «итог миссии пролога → следующая миссия»
  // не покидает экран боя, поэтому без ключа экран продолжал бы прежнюю
  // партию: миссии пролога показывали итог, не начавшись.
  const key = isBattleScreen(screen) ? `battle-${battleEpoch ?? 0}` : screen;
  return (
    <Suspense fallback={<div className="boot-screen" />}>
      <Component key={key} />
    </Suspense>
  );
}
