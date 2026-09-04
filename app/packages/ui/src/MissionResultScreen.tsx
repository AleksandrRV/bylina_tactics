import { useEffect, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

/** Медальон итога: восьмилучевое солнце победы / знак Нави при поражении. */
function VictoryEmblem() {
  return (
    <svg
      width="52"
      height="52"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
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
    <svg
      width="52"
      height="52"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9.4" strokeDasharray="3.4 2.6" />
      <path d="M8.4 15.6 15.6 8.4M8.4 8.4l7.2 7.2" />
    </svg>
  );
}

function SkullIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="9" r="6.4" />
      <path d="M7 9h.01M13 9h.01M10 15v2M7.5 17.5h5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2" />
    </svg>
  );
}

function HerbIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 14V6" />
      <path d="M8 7c-2.4 0-3.6-1.6-3.4-3.8 2.3-.2 3.7 1 3.4 3.8Z" />
      <path d="M8 9.5c2.4 0 3.6-1.6 3.4-3.8-2.3-.2-3.7 1-3.4 3.8Z" />
      <path d="M8 12c-1.9 0-2.8-1.2-2.6-2.9 1.7-.2 2.8.8 2.6 2.9Z" />
    </svg>
  );
}

function GemIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M6 2.5h4l3 3.5-5 7.5L3 6l3-3.5Z" />
      <path d="M3 6h10M8 13.5 6.6 6M8 13.5 9.4 6" />
    </svg>
  );
}

function XpBar({
  gain,
}: {
  gain: {
    name: string;
    xpBefore: number;
    xpAfter: number;
    levelBefore: number;
    levelAfter: number;
    leveled: boolean;
    gained: number;
  };
}) {
  const XP_MAX = 100;
  const beforePct = Math.min(100, Math.max(0, (gain.xpBefore / XP_MAX) * 100));
  const targetPct = gain.leveled ? 100 : Math.min(100, Math.max(0, (gain.xpAfter / XP_MAX) * 100));
  const [pct, setPct] = useState(beforePct);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setPct(targetPct);
      if (gain.leveled) window.setTimeout(() => setFlash(true), 900);
    }, 120);
    return () => window.clearTimeout(id);
  }, [targetPct, gain.leveled]);
  return (
    <div className={`xp-row${gain.leveled ? " is-leveled" : ""}${flash ? " is-flash" : ""}`}>
      <div className="xp-row-head">
        <span className="xp-name">{gain.name}</span>
        <span className="xp-levels">
          Ур. {gain.levelBefore}
          {gain.levelAfter !== gain.levelBefore ? ` → ${gain.levelAfter}` : ""}
          {gain.leveled ? <span className="xp-badge">↗</span> : null}
        </span>
        <span className="xp-values">
          {gain.leveled ? `${XP_MAX}/${XP_MAX}` : `${gain.xpAfter}/${XP_MAX}`}
          {gain.gained > 0 ? <span className="xp-gain">+{gain.gained}</span> : null}
        </span>
      </div>
      <div className="xp-bar" aria-hidden="true">
        <div className="xp-bar-track" />
        <div
          className="xp-bar-fill"
          style={{ width: `${pct}%`, transition: "width 820ms cubic-bezier(0.22,1,0.36,1)" }}
        />
        {gain.leveled ? <span className="xp-bar-shine" /> : null}
      </div>
    </div>
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
  const lostByRoster = state.phase === "lost" && last && state.fighters.every((fighter) => !fighter.alive);
  const isPrologue = last?.missionId?.startsWith("prologue_") ?? state.chapter === "prologue";

  return (
    <div className="screen menu-screen mission-result-screen">
      <div
        className={`result-emblem is-${victory ? "victory" : "defeat"}`}
        role="img"
        aria-label={victory ? t("result.victory") : t("result.defeat")}
      >
        {victory ? <VictoryEmblem /> : <DefeatEmblem />}
      </div>
      <header className="menu-brand">
        <p className="eyebrow">{last ? `${t("campaign.mission")} · ${last.missionId}` : t("missionResult.title")}</p>
        <h1 className="display-title">{victory ? t("result.victory") : t("result.defeat")}</h1>
        <p className="muted">{victory ? t("missionResult.victoryHint") : t("missionResult.defeatHint")}</p>
      </header>

      {last ? (
        <div className="roster-outcomes" aria-label={t("missionResult.rosterOutcomes")}>
          {last.fallen.length > 0 ? (
            <div className="outcome-group is-fallen">
              <span className="outcome-icon">
                <SkullIcon />
              </span>
              <div>
                <p className="outcome-title">{t("missionResult.fallen")}</p>
                <p className="outcome-names">{last.fallen.join(", ")}</p>
              </div>
            </div>
          ) : null}
          {last.wounded.length > 0 ? (
            <div className="outcome-group is-wounded">
              <span className="outcome-icon">
                <CrossIcon />
              </span>
              <div>
                <p className="outcome-title">{t("missionResult.wounded")}</p>
                <p className="outcome-names">{last.wounded.join(", ")}</p>
              </div>
            </div>
          ) : null}
          {last.leveledUp.length > 0 ? (
            <div className="outcome-group is-level">
              <span className="outcome-icon">
                <ArrowUpIcon />
              </span>
              <div>
                <p className="outcome-title">{t("missionResult.leveledUp")}</p>
                <p className="outcome-names">{last.leveledUp.join(", ")}</p>
              </div>
            </div>
          ) : null}
          {last.newRecruit ? (
            <div className="outcome-group is-recruit">
              <span className="outcome-icon">✦</span>
              <div>
                <p className="outcome-title">{t("missionResult.newRecruit")}</p>
                <p className="outcome-names">{last.newRecruit}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {last?.xpGains && last.xpGains.length > 0 ? (
        <div className="xp-section" aria-label={t("missionResult.xp") ?? "Опыт"}>
          <p className="xp-section-title">{t("missionResult.xp") ?? "Опыт бойцов"}</p>
          {last.xpGains.map((gain) => (
            <XpBar key={gain.fighterId} gain={gain} />
          ))}
        </div>
      ) : null}

      {!isPrologue && last && (last.rewards.gold > 0 || last.rewards.herbs > 0 || last.rewards.artifacts > 0) ? (
        <div className="rewards-strip" aria-label={t("missionResult.rewards")}>
          <span className="rewards-title">{t("missionResult.rewards")}</span>
          {last.rewards.gold > 0 ? (
            <span className="cost-chip gold reward-gain">
              <CoinIcon />+{last.rewards.gold}
            </span>
          ) : null}
          {last.rewards.herbs > 0 ? (
            <span className="cost-chip herbs reward-gain">
              <HerbIcon />+{last.rewards.herbs}
            </span>
          ) : null}
          {last.rewards.artifacts > 0 ? (
            <span className="cost-chip artifacts reward-gain">
              <GemIcon />+{last.rewards.artifacts}
            </span>
          ) : null}
        </div>
      ) : null}

      {!isPrologue && last && state.phase !== "lost" ? (
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
          {lostByRoster ? t("campaign.lostRosterBody") : t("campaign.lostBody", { value: state.darknessMax })}
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
