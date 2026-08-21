import { BattleScreen } from "./BattleScreen.js";
import { BootScreen } from "./BootScreen.js";
import { CampaignScreen } from "./CampaignScreen.js";
import { DeploymentScreen } from "./DeploymentScreen.js";
import { DifficultyScreen } from "./DifficultyScreen.js";
import { MenuScreen } from "./MenuScreen.js";
import { MissionResultScreen } from "./MissionResultScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { useSessionState } from "./hooks.js";

export function Shell() {
  const { screen } = useSessionState();

  if (screen === "boot") return <BootScreen />;
  if (screen === "settings") return <SettingsScreen />;
  if (screen === "difficulty") return <DifficultyScreen />;
  if (screen === "result") return <ResultScreen />;
  if (screen === "deployment") return <DeploymentScreen />;
  if (screen === "campaign") return <CampaignScreen />;
  if (screen === "missionResult") return <MissionResultScreen />;
  if (screen === "battle") return <BattleScreen />;
  return <MenuScreen />;
}
