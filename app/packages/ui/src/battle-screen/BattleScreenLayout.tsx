import { useBattleScreen } from "./context.js";
import { BattleTopBar } from "./BattleTopBar.js";
import { BattleRosterPanel } from "./BattleRosterPanel.js";
import { BattleBottomPanel } from "./BattleBottomPanel.js";
import { BattleDialogs } from "./BattleDialogs.js";
import { BattleReplayBar } from "./BattleReplayBar.js";
import { BattleTrainingLayer } from "./BattleTrainingLayer.js";
import { BattleAimCard } from "./BattleAimCard.js";

export function BattleScreenLayout() {
  const model = useBattleScreen();

  return (
    <div className={model.screenClassName}>
      <div ref={model.hostRef} className="battle-stage" />
      <div className="battle-hud">
        <BattleTrainingLayer />
        {model.isReplay ? <BattleReplayBar /> : null}
        <BattleTopBar />
        <BattleRosterPanel />
        <div className="battle-mid">
          {model.saveNotice ? (
            <p className="save-toast" role="status" aria-live="polite">
              <span className="save-toast-mark" aria-hidden="true">
                ✔
              </span>
              {model.t("battle.saved")}
            </p>
          ) : null}
          {model.log ? (
            <p className="battle-log" role="status">
              {model.log}
            </p>
          ) : null}
          <BattleAimCard />
        </div>
        <BattleBottomPanel />
      </div>
      <BattleDialogs />
    </div>
  );
}
