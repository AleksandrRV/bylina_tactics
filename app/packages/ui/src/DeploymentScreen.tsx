import { useEffect, useMemo, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function RecruitSilhouette() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="32" cy="22" r="9" />
      <path d="M14 54c2-12 9-17 18-17s16 5 18 17" />
    </svg>
  );
}

export function DeploymentScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const { activeMissionId } = useSessionState();
  const campaign = session.getCampaign();
  const mission = activeMissionId ? campaign.getMission(activeMissionId) : undefined;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0);

  useEffect(
    () =>
      campaign.subscribe(() => {
        setTick((value) => value + 1);
      }),
    [campaign],
  );

  const fighters = useMemo(
    () => campaign.getState().fighters.filter((fighter) => fighter.alive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign, activeMissionId],
  );

  const deployMin = content.campaign.deployMin;
  const deployMax = content.campaign.deployMax;
  const penalty = content.campaign.woundPenalty;
  const count = selected.size;
  const canConfirm = count >= deployMin && count <= deployMax;

  const toggle = (fighterId: number): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(fighterId)) {
        next.delete(fighterId);
      } else if (next.size < deployMax) {
        next.add(fighterId);
      }
      return next;
    });
  };

  return (
    <div className="screen deployment-screen">
      <header className="deployment-head">
        <p className="eyebrow">{t("campaign.mission")} · {activeMissionId ?? ""}</p>
        <h1 className="display-title">{t("deployment.title")}</h1>
        <p className="muted">
          {t("deployment.hint", { min: deployMin, max: deployMax })}
          {mission ? ` — ${t("campaign.type.purge")}` : ""}
        </p>
      </header>

      <div className="deployment-grid" role="list" aria-label={t("deployment.listLabel")}>
        {fighters.map((fighter) => {
          const face = unitPortrait(fighter.unitId);
          const isRecruit = fighter.unitId === content.campaign.recruitUnitId;
          const picked = selected.has(fighter.id);
          return (
            <button
              key={fighter.id}
              type="button"
              role="listitem"
              className={`deploy-card${picked ? " is-picked" : ""}${fighter.wounded ? " is-wounded" : ""}`}
              aria-pressed={picked}
              onClick={() => toggle(fighter.id)}
            >
              <span className="deploy-face">
                {face ? (
                  <img src={face} alt="" draggable={false} />
                ) : isRecruit ? (
                  <RecruitSilhouette />
                ) : (
                  <span className="deploy-face-empty" aria-hidden="true" />
                )}
                {fighter.wounded ? <span className="wound-badge" title={t("deployment.woundedHint", { aim: penalty.aim, defense: penalty.defense, mobility: penalty.mobility })} /> : null}
              </span>
              <span className="deploy-meta">
                <span className="deploy-name">{fighter.name}</span>
                <span className="deploy-class">
                  {isRecruit ? t("roster.recruit") : t(unitName(fighter.unitId))}
                </span>
                <span className="deploy-hp">
                  {t("battle.hp", { current: fighter.hp, max: fighter.maxHp })}
                </span>
                {fighter.wounded ? (
                  <span className="deploy-wound-note">{t("deployment.wounded")}</span>
                ) : null}
              </span>
              <span className="pick-mark" aria-hidden="true">✓</span>
            </button>
          );
        })}
      </div>

      <footer className="deployment-foot">
        <p className="deployment-count" aria-live="polite">
          {t("deployment.count", { current: count, min: deployMin, max: deployMax })}
        </p>
        <div className="deployment-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => session.leaveCampaignMission()}
          >
            {t("deployment.back")}
          </button>
          <button
            type="button"
            className="btn btn-primary deploy-confirm"
            disabled={!canConfirm}
            onClick={() => {
              if (canConfirm) session.confirmDeployment([...selected]);
            }}
          >
            {t("deployment.confirm")}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
