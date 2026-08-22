import type { AppScreen } from "@bylina/session";
import { BattleScreen } from "./BattleScreen.js";
import { BootScreen } from "./BootScreen.js";
import { CampaignScreen } from "./CampaignScreen.js";
import { DeploymentScreen } from "./DeploymentScreen.js";
import { DifficultyScreen } from "./DifficultyScreen.js";
import { MenuScreen } from "./MenuScreen.js";
import { MissionResultScreen } from "./MissionResultScreen.js";
import { PvpRoomScreen } from "./PvpRoomScreen.js";
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
export function screenComponent(screen: AppScreen): () => React.JSX.Element {
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
  const { screen } = useSessionState();
  const Component = screenComponent(screen);
  return <Component />;
}
