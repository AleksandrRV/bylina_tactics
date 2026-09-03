/**
 * Экран тактического боя.
 *
 * После рефакторинга этот файл является только публичной точкой входа.
 * Вся логика экрана находится в `battle-screen/useBattleScreenModel.ts`,
 * а представление — в презентационных компонентах `battle-screen/*`.
 *
 * Публичный контракт сохранён: `BattleScreen` lazy-загружает именно
 * именованный экспорт `BattleScreenView`.
 */
import { BattleScreenContext } from "./battle-screen/context.js";
import { useBattleScreenModel } from "./battle-screen/useBattleScreenModel.js";
import { BattleScreenLayout } from "./battle-screen/BattleScreenLayout.js";
import "./battle.css";

export function BattleScreenView() {
  const model = useBattleScreenModel();

  return (
    <BattleScreenContext.Provider value={model}>
      <BattleScreenLayout />
    </BattleScreenContext.Provider>
  );
}
