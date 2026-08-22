import { describe, expect, it } from "vitest";
import type { AppScreen } from "@bylina/session";
import { screenComponent } from "../src/Shell.js";
import { BattleScreen } from "../src/BattleScreen.js";
import { BootScreen } from "../src/BootScreen.js";
import { CampaignScreen } from "../src/CampaignScreen.js";
import { DeploymentScreen } from "../src/DeploymentScreen.js";
import { DifficultyScreen } from "../src/DifficultyScreen.js";
import { MenuScreen } from "../src/MenuScreen.js";
import { MissionResultScreen } from "../src/MissionResultScreen.js";
import { PvpRoomScreen } from "../src/PvpRoomScreen.js";
import { ReplayScreen } from "../src/ReplayScreen.js";
import { ResultScreen } from "../src/ResultScreen.js";
import { SettingsScreen } from "../src/SettingsScreen.js";
import { TrainingScreen } from "../src/TrainingScreen.js";

/**
 * Маршрутизация экранов сессии (0.19.2): каждый экран обязан открывать
 * ожидаемый компонент. Регрессия: экран trainingBattle не обрабатывался
 * и выбрасывал игрока в главное меню (0.19.0).
 */
describe("screenComponent", () => {
  const cases: [AppScreen, unknown][] = [
    ["boot", BootScreen],
    ["menu", MenuScreen],
    ["settings", SettingsScreen],
    ["difficulty", DifficultyScreen],
    ["result", ResultScreen],
    ["deployment", DeploymentScreen],
    ["campaign", CampaignScreen],
    ["missionResult", MissionResultScreen],
    ["pvpRoom", PvpRoomScreen],
    ["replays", ReplayScreen],
    ["training", TrainingScreen],
    ["trainingBattle", BattleScreen],
    ["battle", BattleScreen],
  ];

  it.each(cases)("screen %s opens the expected component", (screen, component) => {
    expect(screenComponent(screen)).toBe(component);
  });
});
