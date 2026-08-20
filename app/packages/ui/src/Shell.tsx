import { BattleScreen } from "./BattleScreen.js";
import { BootScreen } from "./BootScreen.js";
import { FieldScreen } from "./FieldScreen.js";
import { MenuScreen } from "./MenuScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { useSessionState } from "./hooks.js";

export function Shell() {
  const { screen } = useSessionState();

  if (screen === "boot") return <BootScreen />;
  if (screen === "settings") return <SettingsScreen />;
  if (screen === "field") return <FieldScreen />;
  if (screen === "battle") return <BattleScreen />;
  return <MenuScreen />;
}
