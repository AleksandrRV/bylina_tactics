import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

export function MissionResultScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const { outcome } = useSessionState();
  const victory = outcome === "victory";
  const campaign = session.getCampaign();
  const state = campaign.getState();
  const last = state.lastResult;

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("missionResult.title")}</p>
        <h1 className="display-title">{victory ? t("result.victory") : t("result.defeat")}</h1>
        {last ? (
          <p className="muted">
            {t("missionResult.darknessGained", { value: last.darknessGained })}
            {" · "}
            {t("campaign.darknessValue", { current: state.darkness, max: state.darknessMax })}
          </p>
        ) : null}
        {state.phase === "lost" ? <p className="mission-loss">{t("campaign.lostBody", { value: state.darknessMax })}</p> : null}
      </header>
      <nav className="menu-nav">
        {state.phase === "lost" ? (
          <button type="button" className="btn btn-primary" onClick={() => session.goTo("menu")}>
            {t("result.toMenu")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => session.backToCampaign()}>
            {t("missionResult.toMap")}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          {t("result.toMenu")}
        </button>
      </nav>
    </div>
  );
}
