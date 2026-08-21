import { useEffect, useMemo, useState } from "react";
import type { MissionConfig } from "@bylina/content";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

/**
 * Отметки точек на карте царства. Выпуск 0.10.0 не хранит координаты в
 * конфигурации: положения вычисляются детерминированно из порядка точек.
 */
const WAYPOINTS: readonly { x: number; y: number }[] = [
  { x: 14, y: 66 },
  { x: 32, y: 44 },
  { x: 50, y: 64 },
  { x: 66, y: 38 },
  { x: 84, y: 56 },
  { x: 72, y: 20 },
];

function markerPosition(index: number): { x: number; y: number } {
  return WAYPOINTS[index % WAYPOINTS.length] ?? { x: 50, y: 50 };
}

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

export function CampaignScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const campaign = session.getCampaign();
  const state = campaign.getState();
  const missions = campaign.getMissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(
    () =>
      campaign.subscribe(() => {
        setTick((value) => value + 1);
      }),
    [campaign],
  );

  const byId = useMemo(() => {
    const map = new Map<string, MissionConfig>();
    for (const mission of missions) map.set(mission.id, mission);
    return map;
  }, [missions]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const selectedPoint = selectedId ? state.missions.find((point) => point.id === selectedId) : undefined;
  const resources = { gold: 0, herbs: 0, artifacts: 0 };

  // Корабль стоит у передовой точки: первой открытой, иначе у последней пройденной.
  const frontIndex = state.missions.findIndex((point) => point.status === "open");
  const shipPosition = markerPosition(
    frontIndex >= 0
      ? frontIndex
      : Math.max(0, state.missions.length - 1),
  );

  return (
    <div className="screen campaign-screen">
      <header className="campaign-top">
        <div className="top-controls">
          <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
            {t("campaign.toMenu")}
          </button>
        </div>
        <div className="campaign-darkness" aria-label={t("campaign.darknessLabel")}>
          <span className="campaign-darkness-name">{t("campaign.darkness")}</span>
          <span className="campaign-darkness-value">
            {state.darkness} / {state.darknessMax}
          </span>
          <div className="darkness-bar" aria-hidden="true">
            <i style={{ width: `${(state.darkness / state.darknessMax) * 100}%` }} />
          </div>
        </div>
        <div className="campaign-resources" aria-label={t("campaign.resourcesLabel")}>
          <span className="resource gold" title={t("campaign.gold")}>
            {t("campaign.gold")} {resources.gold}
          </span>
          <span className="resource herbs" title={t("campaign.herbs")}>
            {t("campaign.herbs")} {resources.herbs}
          </span>
          <span className="resource artifacts" title={t("campaign.artifacts")}>
            {t("campaign.artifacts")} {resources.artifacts}
          </span>
        </div>
      </header>

      <div className="campaign-map" role="region" aria-label={t("campaign.mapLabel")}>
        <div className="map-land" aria-hidden="true" />
        {missions.map((mission, index) => {
          const point = state.missions.find((candidate) => candidate.id === mission.id);
          const position = markerPosition(index);
          const status = point?.status ?? "locked";
          return (
            <button
              key={mission.id}
              type="button"
              className={`map-marker is-${status}${selectedId === mission.id ? " is-selected" : ""}`}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              aria-label={t(`campaign.marker.${status}`, { mission: mission.id })}
              disabled={status === "locked"}
              onClick={() => {
                setSelectedId(mission.id);
              }}
            >
              <span className="marker-dot" aria-hidden="true" />
              {status === "done" ? <span className="marker-check" aria-hidden="true">✓</span> : null}
              {status === "locked" ? <span className="marker-question" aria-hidden="true">?</span> : null}
            </button>
          );
        })}
        <div
          className="ship-marker"
          aria-hidden="true"
          title={t("campaign.ship")}
          style={{ left: `${shipPosition.x}%`, top: `${shipPosition.y}%` }}
        >
          <span className="ship-icon">▲</span>
        </div>
      </div>

      <aside className="mission-panel" aria-live="polite">
        {selected && selectedPoint ? (
          <div className="mission-card">
            <p className="eyebrow">{t("campaign.mission")} · {selected.id}</p>
            <h2 className="mission-title">
              {selected.type === "purge" ? t("campaign.type.purge") : selected.type}
            </h2>
            {selectedPoint.status === "done" ? (
              <p className="mission-status done">{t("campaign.done")}</p>
            ) : null}
            <dl className="mission-facts">
              <div className="fact-row">
                <dt>{t("campaign.foes")}</dt>
                <dd>
                  {selected.enemies.map((entry) => (
                    <span key={entry.unitId} className="foe-chip">
                      {t(unitName(entry.unitId))} ×{entry.count}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="fact-row">
                <dt>{t("campaign.reward")}</dt>
                <dd className="muted">{t("campaign.rewardEmpty")}</dd>
              </div>
              <div className="fact-row">
                <dt>{t("campaign.darknessGrowth")}</dt>
                <dd>
                  {t("campaign.darknessOnVictory", { value: selected.darknessOnVictory })}
                  {" · "}
                  {t("campaign.darknessOnDefeat", { value: selected.darknessOnDefeat })}
                </dd>
              </div>
            </dl>
            {selectedPoint.status === "open" ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (session.startCampaignMission(selected.id)) {
                    setSelectedId(null);
                  }
                }}
              >
                {t("campaign.start")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="muted">{t("campaign.pickMission")}</p>
        )}
      </aside>

      <nav className="campaign-tabs" aria-label={t("campaign.tabsLabel")}>
        <button type="button" className="campaign-tab" disabled title={t("campaign.tabSoon", { version: "0.11.0" })}>
          {t("campaign.tabRoster")}
        </button>
        <button type="button" className="campaign-tab" disabled title={t("campaign.tabSoon", { version: "0.12.0" })}>
          {t("campaign.tabForge")}
        </button>
        <button type="button" className="campaign-tab" disabled title={t("campaign.tabSoon", { version: "0.12.0" })}>
          {t("campaign.tabChamber")}
        </button>
      </nav>

      {state.phase === "lost" ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card" role="dialog" aria-modal="true" aria-labelledby="campaign-lost-title">
            <h2 id="campaign-lost-title">{t("campaign.lostTitle")}</h2>
            <p>{t("campaign.lostBody", { value: state.darknessMax })}</p>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.goTo("menu")}>
              {t("campaign.toMenu")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
