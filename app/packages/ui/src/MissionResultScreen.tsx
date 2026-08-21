import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

/** Медальон итога: восьмилучевое солнце победы / знак Нави при поражении. */
function VictoryEmblem() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index * Math.PI) / 4;
        const x1 = 12 + Math.cos(angle) * 6;
        const y1 = 12 + Math.sin(angle) * 6;
        const x2 = 12 + Math.cos(angle) * 10;
        const y2 = 12 + Math.sin(angle) * 10;
        return <path key={index} d={`M${x1} ${y1}L${x2} ${y2}`} />;
      })}
    </svg>
  );
}

function DefeatEmblem() {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.4" strokeDasharray="3.4 2.6" />
      <path d="M8.4 15.6 15.6 8.4M8.4 8.4l7.2 7.2" />
    </svg>
  );
}

export function MissionResultScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const { outcome } = useSessionState();
  const victory = outcome === "victory";
  const campaign = session.getCampaign();
  const state = campaign.getState();
  const last = state.lastResult;
  const previous = Math.max(0, state.darkness - (last?.darknessGained ?? 0));
  const gainedPercent = last ? Math.min(100, ((state.darkness - previous) / state.darknessMax) * 100) : 0;
  const previousPercent = Math.min(100, (previous / state.darknessMax) * 100);

  return (
    <div className="screen menu-screen mission-result-screen">
      <div className={`result-emblem is-${victory ? "victory" : "defeat"}`} role="img" aria-label={victory ? t("result.victory") : t("result.defeat")}>
        {victory ? <VictoryEmblem /> : <DefeatEmblem />}
      </div>
      <header className="menu-brand">
        <p className="eyebrow">
          {last ? `${t("campaign.mission")} · ${last.missionId}` : t("missionResult.title")}
        </p>
        <h1 className="display-title">{victory ? t("result.victory") : t("result.defeat")}</h1>
        <p className="muted">{victory ? t("missionResult.victoryHint") : t("missionResult.defeatHint")}</p>
      </header>

      {last && state.phase !== "lost" ? (
        <div className="darkness-summary" aria-label={t("campaign.darknessLabel")}>
          <div className="summary-line">
            <span>{t("missionResult.darknessGained", { value: last.darknessGained })}</span>
            <b>
              {state.darkness} / {state.darknessMax}
            </b>
          </div>
          <div className="darkness-bar" aria-hidden="true">
            <i style={{ width: `${previousPercent}%` }} />
            <b style={{ width: `${gainedPercent}%`, left: `${previousPercent}%` }} />
          </div>
        </div>
      ) : null}

      {state.phase === "lost" ? (
        <div className="loss-banner" role="alert">
          {t("campaign.lostBody", { value: state.darknessMax })}
        </div>
      ) : null}

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
