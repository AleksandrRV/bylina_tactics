import { BootScreen } from "./BootScreen.js";
import { MenuScreen } from "./MenuScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { useSessionState } from "./hooks.js";

export function Shell() {
  const { screen } = useSessionState();

  if (screen === "boot") return <BootScreen />;
  if (screen === "settings") return <SettingsScreen />;
  return <MenuScreen />;
}
