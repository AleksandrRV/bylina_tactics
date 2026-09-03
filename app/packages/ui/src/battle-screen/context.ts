import { createContext, useContext } from "react";
import type { BattleScreenModel } from "./useBattleScreenModel.js";

export const BattleScreenContext = createContext<BattleScreenModel | null>(null);

export function useBattleScreen(): BattleScreenModel {
  const model = useContext(BattleScreenContext);

  if (!model) {
    throw new Error("BattleScreen components must be rendered inside BattleScreenContext.Provider");
  }

  return model;
}
