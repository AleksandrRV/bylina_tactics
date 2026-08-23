import { lazy } from "react";

/**
 * Battle implementation (PixiJS and battle orchestration) is loaded only when
 * a battle route is opened, keeping it out of the application entry chunk.
 */
export const BattleScreen = lazy(async () => ({
  default: (await import("./BattleScreenView.js")).BattleScreenView,
}));
