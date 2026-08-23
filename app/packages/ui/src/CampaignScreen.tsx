import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ItemConfig, MissionConfig } from "@bylina/content";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState, useSettingsState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";
import { CampaignHint } from "./CampaignHint.js";
import { pendingCampaignHints, type CampaignHintId } from "./campaign-hints.js";

/** Классы дружины, доступные для обучения рекрута. */
const CLASS_IDS: readonly string[] = ["bogatyr", "strelets", "znaharka", "volkhv"];

type CampTab = "map" | "roster" | "chamber" | "forge";

/** Геометрические знаки-руны отметок: плоские формы вместо орнамента (ui-design §1). */
const RUNES: readonly string[] = ["✦", "▲", "◆", "⬢", "✶", "✵"];

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function itemName(itemId: string): string {
  return `item.${itemId}.name`;
}

function roadPath(missions: readonly MissionConfig[]): string {
  return missions.map((mission) => `${mission.x},${mission.y}`).join(" ");
}

/** Строка эффекта предмета для карточки Кузни и снаряжения. */
function itemEffectParts(item: ItemConfig, t: (key: string, vars?: Record<string, string | number>) => string): string[] {
  const parts: string[] = [];
  if (item.weaponId) parts.push(t(`weapon.${item.weaponId}.name`));
  if (item.aimMod) parts.push(`${item.aimMod > 0 ? "+" : ""}${item.aimMod} ${t("item.aim")}`);
  if (item.defenseMod) parts.push(`${item.defenseMod > 0 ? "+" : ""}${item.defenseMod} ${t("item.defense")}`);
  if (item.mobilityMod) parts.push(`${item.mobilityMod > 0 ? "+" : ""}${item.mobilityMod} ${t("item.mobility")}`);
  if (item.maxHpMod) parts.push(`${item.maxHpMod > 0 ? "+" : ""}${item.maxHpMod} ${t("item.maxHp")}`);
  return parts;
}

/* ---------- Геометрические иконки (плоские, в стиле игры) ---------- */

function CoinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2" />
    </svg>
  );
}

function HerbIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 14V6" />
      <path d="M8 7c-2.4 0-3.6-1.6-3.4-3.8 2.3-.2 3.7 1 3.4 3.8Z" />
      <path d="M8 9.5c2.4 0 3.6-1.6 3.4-3.8-2.3-.2-3.7 1-3.4 3.8Z" />
      <path d="M8 12c-1.9 0-2.8-1.2-2.6-2.9 1.7-.2 2.8.8 2.6 2.9Z" />
    </svg>
  );
}

function GemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M6 2.5h4l3 3.5-5 7.5L3 6l3-3.5Z" />
      <path d="M3 6h10M8 13.5 6.6 6M8 13.5 9.4 6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M10 2.5 16 5v5c0 3.6-2.4 6.2-6 7.5C6.4 16.2 4 13.6 4 10V5l6-2.5Z" />
      <path d="M7 10h6" />
    </svg>
  );
}

function HammerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 10.5 3 16l1.5 1.5 5.5-5.5" />
      <path d="m10 9 4.6-4.6a2.4 2.4 0 0 1 3.4 3.4L13.4 12.4 10 9Z" />
      <path d="M13 4.5 15.5 7" />
    </svg>
  );
}

function ChamberIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4.5h12M4 15.5h12" />
      <path d="M10 2v4M10 14v4" />
      <path d="M7 10h6" />
    </svg>
  );
}

function SwordsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
      <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
      <path d="M6 14 3.5 16.5 8 17l3-3" />
    </svg>
  );
}

function IdolIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2.5h8" />
      <path d="M7 2.5v3.5M13 2.5v3.5" />
      <path d="M5.5 6h9l-.8 9.5h-7.4L5.5 6Z" />
      <circle cx="10" cy="9.5" r="1.4" />
      <path d="M8.6 12.5h2.8M10 12.5v1.8" />
    </svg>
  );
}

function RescueIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5 15 4.5v4.6c0 3.4-2.2 6-5 7.4-2.8-1.4-5-4-5-7.4V4.5l5-2Z" />
      <path d="M10 6.5v4M8 8.5h4" />
    </svg>
  );
}

function ReconIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 10c2-4.5 4.5-6.5 7.5-6.5s5.5 2 7.5 6.5c-2 4.5-4.5 6.5-7.5 6.5S4.5 14.5 2.5 10Z" />
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 7.8v-2M12.2 10h2M10 12.2v2M7.8 10h-2" />
    </svg>
  );
}

function ShipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13.5h14l-1.8 3H4.8L3 13.5Z" />
      <path d="M10 3v10" />
      <path d="M10 3.5c2.8.8 3.6 2.6 3.4 5H10V3.5Z" />
      <path d="M6.5 9.5 5 6.8M13.5 9.5 15 6.8" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <circle cx="11" cy="11" r="9" />
      <path d="m14.8 7.2-1.7 5-5 1.7 1.7-5 5-1.7Z" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="10" cy="10" r="8" strokeDasharray="4 2.6" />
      <path d="M10 10 16 4" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AnvilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14h12" />
      <path d="M5 14v-3a5 5 0 0 1 10 0v3" />
      <path d="M3 11h14M10 6V4.2M7 4.2h6" />
    </svg>
  );
}

function RecruitSilhouette() {
  return (
    <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="32" cy="22" r="9" />
      <path d="M14 54c2-12 9-17 18-17s16 5 18 17" />
    </svg>
  );
}

function LevelPips({ level }: { level: number }) {
  return (
    <span className="level-pips" aria-hidden="true">
      {Array.from({ length: Math.min(level, 5) }, (_, index) => (
        <i key={index} className={index < level ? "on" : ""} />
      ))}
    </span>
  );
}

/* ---------- Экран -------------------------------------------------- */

export function CampaignScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const campaign = session.getCampaign();
  const state = campaign.getState();
  const missions = campaign.getMissions();
  const items = campaign.getItems();
  const settings = useSettingsState();
  const { campaignHintsDone } = useSessionState();
  const [tab, setTab] = useState<CampTab>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trainingId, setTrainingId] = useState<number | null>(null);
  const [scanKey, setScanKey] = useState<number>(0);
  const [justOpened, setJustOpened] = useState<string[]>([]);
  /** Пустое сканирование: в радиусе нет закрытых точек (0.19.2). */
  const [scanMissed, setScanMissed] = useState(false);
  /** Очередь туториалов «первого раза» (0.20.0): показываются по одному. */
  const [hintQueue, setHintQueue] = useState<CampaignHintId[]>([]);
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
  const isRecruitUnit = (unitId: string): boolean => unitId === content.campaign.recruitUnitId;

  const resources = state.resources;
  const scanCost = content.campaign.scan.cost;
  const canScan =
    resources.gold >= scanCost.gold
    && resources.herbs >= scanCost.herbs
    && resources.artifacts >= scanCost.artifacts;
  const lockedCount = state.missions.filter((point) => point.status === "locked").length;

  const shipPosition = state.shipPosition;
  const woundedFighters = state.fighters.filter((fighter) => fighter.alive && fighter.wounded);
  const training = trainingId !== null ? state.fighters.find((fighter) => fighter.id === trainingId) : undefined;

  // Туториалы «первого раза» (0.20.0): желаемые по условиям экрана, ещё не
  // показанные и при включённой настройке подсказок — добавляются в очередь.
  const wantedHints = useMemo(
    () => pendingCampaignHints({
      showHints: settings.showHints,
      done: campaignHintsDone ?? [],
      onCampaignMap: tab === "map",
      lockedCount,
      hasWounded: woundedFighters.length > 0,
      rosterTabActive: tab === "roster",
      forgeTabActive: tab === "forge",
      onDeployment: false,
      onBattleWithGeneral: false,
      onBattle: false,
      enemyTypes: [],
    }),
    [settings.showHints, campaignHintsDone, tab, lockedCount, woundedFighters.length],
  );
  useEffect(() => {
    setHintQueue((previous) => {
      const next = [...previous];
      for (const id of wantedHints) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }, [wantedHints.join(",")]);

  // Активный туториал: только при включённой настройке подсказок и только
  // непоказанные (0.20.0). Проверка showHints защищает и от элементов,
  // уже успевших попасть в очередь до выключения настройки.
  const activeHintId = settings.showHints
    ? (hintQueue.find((id) => !session.isCampaignHintShown(id)) ?? null)
    : null;
  const closeHint = (): void => {
    if (!activeHintId) return;
    session.markCampaignHintShown(activeHintId);
    setHintQueue((previous) => previous.filter((id) => id !== activeHintId));
  };

  const doScan = (): void => {
    const result = campaign.scan();
    if (result && result.opened.length > 0) {
      setScanKey((value) => value + 1);
      setJustOpened(result.opened);
      window.setTimeout(() => setJustOpened([]), 1400);
      setScanMissed(false);
      return;
    }
    // Пустое сканирование запасы не тратит (0.19.2): показываем плашку,
    // что в радиусе нет закрытых точек.
    setScanMissed(true);
    window.setTimeout(() => setScanMissed(false), 1400);
  };

  const itemById = useMemo(() => {
    const map = new Map<string, ItemConfig>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  // Иконка выхода из стратегического режима в главное меню (доработка).
  function ExitToMenuIcon() {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 4H6v16h7" />
        <path d="M16 8l4 4-4 4" />
        <path d="M10 12h9" />
      </svg>
    );
  }

  return (
    <div className="screen campaign-screen">
      <header className="campaign-top">
        <button
          type="button"
          className="campaign-exit-btn"
          onClick={() => session.goTo("menu")}
          title={t("campaign.toMenu")}
          aria-label={t("campaign.toMenu")}
        >
          <ExitToMenuIcon />
          {t("campaign.toMenu")}
        </button>
        <div className="campaign-title-block">
          <p className="eyebrow">{t("campaign.kingdom")}</p>
          <h1>{t("menu.campaign")}</h1>
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
            <CoinIcon />
            {resources.gold}
          </span>
          <span className="resource herbs" title={t("campaign.herbs")}>
            <HerbIcon />
            {resources.herbs}
          </span>
          <span className="resource artifacts" title={t("campaign.artifacts")}>
            <GemIcon />
            {resources.artifacts}
          </span>
        </div>
      </header>

      {tab === "map" ? (
        <>
          <div className="map-toolbar">
            <p className="map-toolbar-note">
              {lockedCount > 0
                ? t("scan.hint", { radius: content.campaign.scan.radius })
                : t("scan.allOpen")}
            </p>
            <button
              type="button"
              className={`scan-btn${canScan && lockedCount > 0 ? "" : " is-disabled"}`}
              disabled={!canScan || lockedCount === 0}
              onClick={doScan}
              title={t("scan.cost", { gold: scanCost.gold, herbs: scanCost.herbs, artifacts: scanCost.artifacts })}
            >
              <RadarIcon />
              {t("scan.action")}
              <span className="scan-cost" aria-hidden="true">
                {scanCost.gold > 0 ? <span className="cost-chip gold"><CoinIcon />{scanCost.gold}</span> : null}
                {scanCost.herbs > 0 ? <span className="cost-chip herbs"><HerbIcon />{scanCost.herbs}</span> : null}
                {scanCost.artifacts > 0 ? <span className="cost-chip artifacts"><GemIcon />{scanCost.artifacts}</span> : null}
              </span>
            </button>
          </div>

          <div
            className={`campaign-map${scanKey > 0 ? " is-scanning" : ""}`}
            role="region"
            aria-label={t("campaign.mapLabel")}
            style={{ "--ship-x": `${shipPosition.x}%`, "--ship-y": `${shipPosition.y}%` } as CSSProperties}
          >
            {/* Декоративный рельеф: река, горы, леса, дорога между точками */}
            <svg className="map-terrain" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M-4 58 C 14 46 26 62 40 54 C 54 46 58 28 78 24 C 88 22 98 30 106 22"
                fill="none"
                stroke="rgba(120, 160, 180, 0.16)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M-4 58 C 14 46 26 62 40 54 C 54 46 58 28 78 24 C 88 22 98 30 106 22"
                fill="none"
                stroke="rgba(120, 160, 180, 0.08)"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path d="M62 8 69 21 55 21Z" fill="#222c36" />
              <path d="M69 4 76 18 62 18Z" fill="#26323e" />
              <path d="M76 7 83 19 69 19Z" fill="#222c36" />
              <path d="M69 4 71.5 9.5 66.5 9.5Z" fill="#3c4c5c" />
              <path d="M6 78 11 89 1 89Z" fill="#1e2a22" />
              <path d="M13 74 19 86 7 86Z" fill="#223027" />
              <path d="M20 80 26 92 14 92Z" fill="#1e2a22" />
              <path d="M27 76 33 87 21 87Z" fill="#223027" />
              <polyline
                points={roadPath(missions)}
                fill="none"
                stroke="rgba(224, 179, 74, 0.16)"
                strokeWidth="0.5"
                strokeDasharray="1.6 1.8"
                strokeLinecap="round"
              />
            </svg>
            <div className="map-fog" aria-hidden="true" />
            {/* Волна сканирования от корабля */}
            {scanKey > 0 ? <div key={scanKey} className="scan-wave" aria-hidden="true" /> : null}
            {scanMissed ? <p className="scan-toast" role="status">{t("scan.nothing")}</p> : null}

            {missions.map((mission, index) => {
              const point = state.missions.find((candidate) => candidate.id === mission.id);
              const status = point?.status ?? "locked";
              const rune = RUNES[index % RUNES.length] ?? "✦";
              const isNewlyOpen = justOpened.includes(mission.id);
              return (
                <button
                  key={mission.id}
                  type="button"
                  className={`map-marker is-${status}${selectedId === mission.id ? " is-selected" : ""}${isNewlyOpen ? " is-revealed" : ""}`}
                  style={{ left: `${mission.x}%`, top: `${mission.y}%` }}
                  aria-label={t(`campaign.marker.${status}`, { mission: mission.id })}
                  disabled={status === "locked"}
                  onClick={() => {
                    setSelectedId(mission.id);
                  }}
                >
                  <span className="marker-medallion" aria-hidden="true">
                    {status === "done" ? "✓" : status === "locked" ? "?" : rune}
                  </span>
                  <span className="marker-label" aria-hidden="true">
                    {mission.id.replace("clearing_", "C")}
                  </span>
                </button>
              );
            })}

            <div
              className="ship-marker"
              aria-hidden="true"
              title={t("campaign.ship")}
              style={{ left: `${shipPosition.x}%`, top: `${shipPosition.y}%` }}
            >
              <span className="ship-glyph">
                <ShipIcon />
              </span>
            </div>
          </div>

          <aside className="mission-panel" aria-live="polite">
            {selected && selectedPoint ? (
              <div className={`mission-card is-${selected.type}${selectedPoint.status === "done" ? " is-done" : ""}`}>
                <div className="mission-head">
                  <span className={`mission-type-icon is-${selected.type}`} aria-hidden="true">
                    {selected.type === "destroy" ? <IdolIcon /> : selected.type === "rescue" ? <RescueIcon /> : selected.type === "recon" ? <ReconIcon /> : <SwordsIcon />}
                  </span>
                  <div>
                    <p className="mission-id">{selected.id}</p>
                    <h2 className="mission-title">
                      {t(`campaign.type.${selected.type}`)}
                    </h2>
                  </div>
                </div>
                {selectedPoint.status === "done" ? <p className="mission-status done">{t("campaign.done")}</p> : null}
                <dl className="mission-facts">
                  {selected.objectiveUnitId ? (
                    <div className="fact-row">
                      <dt>{t("campaign.objective")}</dt>
                      <dd>
                        <span className="foe-chip objective-chip">{t(unitName(selected.objectiveUnitId))}</span>
                      </dd>
                    </div>
                  ) : null}
                  {selected.escorteeUnitId ? (
                    <div className="fact-row">
                      <dt>{t("campaign.escortee")}</dt>
                      <dd>
                        <span className="foe-chip escortee-chip">{t(unitName(selected.escorteeUnitId))}</span>
                      </dd>
                    </div>
                  ) : null}
                  <div className="fact-row">
                    <dt>{t("campaign.foes")}</dt>
                    <dd>
                      {selected.enemies.map((entry) => (
                        <span key={entry.unitId} className={`foe-chip ${entry.unitId}`}>
                          {t(unitName(entry.unitId))} ×{entry.count}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div className="fact-row">
                    <dt>{t("campaign.reward")}</dt>
                    <dd>
                      <span className="reward-chips" aria-label={t("campaign.reward")}>
                        {selected.rewards.gold > 0 ? <span className="cost-chip gold"><CoinIcon />{selected.rewards.gold}</span> : null}
                        {selected.rewards.herbs > 0 ? <span className="cost-chip herbs"><HerbIcon />{selected.rewards.herbs}</span> : null}
                        {selected.rewards.artifacts > 0 ? <span className="cost-chip artifacts"><GemIcon />{selected.rewards.artifacts}</span> : null}
                      </span>
                    </dd>
                  </div>
                  <div className="fact-row">
                    <dt>{t("campaign.darknessGrowth")}</dt>
                    <dd>
                      <span className="darkness-growth">
                        <span
                          className="growth-victory"
                          title={t("campaign.darknessOnVictory", { value: selected.darknessOnVictory })}
                        >
                          +{selected.darknessOnVictory}
                        </span>
                        <span
                          className="growth-defeat"
                          title={t("campaign.darknessOnDefeat", { value: selected.darknessOnDefeat })}
                        >
                          +{selected.darknessOnDefeat}
                        </span>
                      </span>
                    </dd>
                  </div>
                </dl>
                {selectedPoint.status === "open" ? (
                  <div className="mission-actions">
                    <button
                      type="button"
                      className="campaign-start-btn"
                      onClick={() => {
                        if (session.startCampaignMission(selected.id)) {
                          setSelectedId(null);
                        }
                      }}
                    >
                      {t("campaign.start")}
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mission-empty">
                <CompassIcon />
                <p>{t("campaign.pickMission")}</p>
              </div>
            )}
          </aside>
        </>
      ) : null}

      {tab === "roster" ? (
        <div className="roster-panel" aria-label={t("campaign.tabRoster")}>
          <div className="panel-head">
            <h2>{t("campaign.tabRoster")}</h2>
            <p className="muted">
              {t("roster.count", { current: state.fighters.filter((fighter) => fighter.alive).length, max: content.campaign.rosterCap })}
            </p>
          </div>
          <div className="fighter-list">
            {state.fighters.map((fighter) => {
              const face = unitPortrait(fighter.unitId);
              const recruit = isRecruitUnit(fighter.unitId);
              const canTrain = fighter.alive && recruit && fighter.level >= content.campaign.classUnlockLevel;
              const penalty = content.campaign.woundPenalty;
              const equipped = fighter.equippedItemId ? itemById.get(fighter.equippedItemId) : undefined;
              return (
                <div
                  key={fighter.id}
                  className={`fighter-row${!fighter.alive ? " is-fallen" : ""}${fighter.wounded ? " is-wounded" : ""}`}
                >
                  <span className="fighter-face">
                    {face ? (
                      <img src={face} alt="" draggable={false} />
                    ) : recruit ? (
                      <RecruitSilhouette />
                    ) : (
                      <span className="deploy-face-empty" aria-hidden="true" />
                    )}
                  </span>
                  <span className="fighter-info">
                    <span className="fighter-name">
                      {fighter.name}
                      {!fighter.alive ? <span className="fallen-tag">{t("roster.fallen")}</span> : null}
                      {fighter.wounded ? (
                        <span className="wounded-tag" title={t("roster.woundedHint", { aim: penalty.aim, defense: penalty.defense, mobility: penalty.mobility })}>
                          {t("roster.wounded")}
                        </span>
                      ) : null}
                    </span>
                    <span className="fighter-class">
                      {recruit ? t("roster.recruit") : t(unitName(fighter.unitId))}
                    </span>
                    <span className="fighter-hp">
                      {fighter.alive
                        ? t("battle.hp", { current: fighter.hp, max: fighter.maxHp })
                        : t("roster.fallenHp")}
                    </span>
                    {equipped ? (
                      <span className="equip-chip" title={itemEffectParts(equipped, t).join(", ")}>
                        <AnvilIcon />
                        {t(itemName(equipped.id))}
                      </span>
                    ) : null}
                  </span>
                  <span className="fighter-level">
                    <LevelPips level={fighter.level} />
                    <span className="level-label">{t("roster.level", { level: fighter.level })}</span>
                  </span>
                  {canTrain ? (
                    <button type="button" className="btn btn-primary train-btn" onClick={() => setTrainingId(fighter.id)}>
                      {t("roster.train")}
                    </button>
                  ) : null}
                  {fighter.alive && !recruit && !fighter.wounded && !equipped ? (
                    <span className="fighter-ready" aria-hidden="true" title={t("roster.ready")}>
                      ✓
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "chamber" ? (
        <div className="roster-panel" aria-label={t("campaign.tabChamber")}>
          <div className="panel-head">
            <h2>{t("campaign.tabChamber")}</h2>
            <p className="muted">
              {woundedFighters.length > 0
                ? t("chamber.count", { current: woundedFighters.length })
                : t("chamber.empty")}
            </p>
            {woundedFighters.length > 1 ? (
              <button
                type="button"
                className="btn btn-primary heal-btn heal-all-btn"
                onClick={() => {
                  for (const fighter of woundedFighters) campaign.healFighter(fighter.id);
                }}
              >
                <CrossIcon />
                {t("chamber.healAll")}
              </button>
            ) : null}
          </div>
          {woundedFighters.length > 0 ? (
            <div className="fighter-list">
              {woundedFighters.map((fighter) => {
                const face = unitPortrait(fighter.unitId);
                const recruit = isRecruitUnit(fighter.unitId);
                return (
                  <div key={fighter.id} className="fighter-row is-wounded">
                    <span className="fighter-face">
                      {face ? (
                        <img src={face} alt="" draggable={false} />
                      ) : recruit ? (
                        <RecruitSilhouette />
                      ) : (
                        <span className="deploy-face-empty" aria-hidden="true" />
                      )}
                    </span>
                    <span className="fighter-info">
                      <span className="fighter-name">
                        {fighter.name}
                        <span className="wounded-tag">{t("roster.wounded")}</span>
                      </span>
                      <span className="fighter-class">
                        {recruit ? t("roster.recruit") : t(unitName(fighter.unitId))}
                      </span>
                      <span className="fighter-hp">
                        {t("battle.hp", { current: fighter.hp, max: fighter.maxHp })}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary heal-btn"
                      onClick={() => campaign.healFighter(fighter.id)}
                    >
                      <CrossIcon />
                      {t("chamber.heal")}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mission-empty">
              <CrossIcon />
              <p>{t("chamber.emptyBody")}</p>
            </div>
          )}
        </div>
      ) : null}

      {tab === "forge" ? (
        <div className="roster-panel forge-panel" aria-label={t("campaign.tabForge")}>
          <div className="panel-head">
            <h2>{t("campaign.tabForge")}</h2>
            <p className="muted">
              {t("forge.inventory", { current: state.inventory.length })}
            </p>
          </div>
          <div className="forge-grid">
            {items.map((item) => {
              const crafted = state.inventory.includes(item.id);
              const affordable =
                resources.gold >= item.cost.gold
                && resources.herbs >= item.cost.herbs
                && resources.artifacts >= item.cost.artifacts;
              const parts = itemEffectParts(item, t);
              return (
                <div key={item.id} className={`forge-card${crafted ? " is-crafted" : ""}`}>
                  <span className="forge-icon" aria-hidden="true">
                    {item.weaponId ? <SwordsIcon /> : <GemIcon />}
                  </span>
                  <span className="forge-name">{t(itemName(item.id))}</span>
                  <span className="forge-effects">{parts.join(" · ")}</span>
                  <span className="forge-cost" aria-label={t("forge.cost")}>
                    {item.cost.gold > 0 ? <span className="cost-chip gold"><CoinIcon />{item.cost.gold}</span> : null}
                    {item.cost.herbs > 0 ? <span className="cost-chip herbs"><HerbIcon />{item.cost.herbs}</span> : null}
                    {item.cost.artifacts > 0 ? <span className="cost-chip artifacts"><GemIcon />{item.cost.artifacts}</span> : null}
                  </span>
                  {crafted ? (
                    <span className="crafted-tag">{t("forge.crafted")}</span>
                  ) : (
                    <button
                      type="button"
                      className="craft-btn"
                      disabled={!affordable}
                      onClick={() => campaign.craftItem(item.id)}
                    >
                      <AnvilIcon />
                      {t("forge.craft")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {state.inventory.length > 0 ? (
            <p className="forge-note">
              {t("forge.equipHint")}
            </p>
          ) : null}
        </div>
      ) : null}

      <nav className="campaign-tabs" aria-label={t("campaign.tabsLabel")}>
        <button
          type="button"
          className={`campaign-tab${tab === "map" ? " is-active" : ""}`}
          onClick={() => setTab("map")}
        >
          <CompassIcon />
          {t("campaign.tabMap")}
        </button>
        <button
          type="button"
          className={`campaign-tab${tab === "roster" ? " is-active" : ""}`}
          onClick={() => setTab("roster")}
        >
          <ShieldIcon />
          {t("campaign.tabRoster")}
        </button>
        <button
          type="button"
          className={`campaign-tab${tab === "chamber" ? " is-active" : ""}`}
          onClick={() => setTab("chamber")}
        >
          <ChamberIcon />
          {t("campaign.tabChamber")}
          {woundedFighters.length > 0 ? <span className="tab-alert" aria-label={t("chamber.count", { current: woundedFighters.length })}>{woundedFighters.length}</span> : null}
        </button>
        <button
          type="button"
          className={`campaign-tab${tab === "forge" ? " is-active" : ""}`}
          onClick={() => setTab("forge")}
        >
          <HammerIcon />
          {t("campaign.tabForge")}
          {state.inventory.length > 0 ? <span className="tab-alert forge-alert" aria-label={t("forge.inventory", { current: state.inventory.length })}>{state.inventory.length}</span> : null}
        </button>
      </nav>

      {activeHintId ? (
        <CampaignHint key={activeHintId} hintId={activeHintId} onClose={closeHint} />
      ) : null}

      {training ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card train-card" role="dialog" aria-modal="true" aria-labelledby="train-title">
            <h2 id="train-title">{t("roster.trainTitle", { name: training.name })}</h2>
            <p className="muted">{t("roster.trainHint")}</p>
            <div className="class-grid">
              {CLASS_IDS.map((classId) => {
                const face = unitPortrait(classId);
                return (
                  <button
                    key={classId}
                    type="button"
                    className="class-card"
                    onClick={() => {
                      if (campaign.assignClass(training.id, classId)) setTrainingId(null);
                    }}
                  >
                    {face ? <img src={face} alt="" draggable={false} /> : <span className="deploy-face-empty" aria-hidden="true" />}
                    <span>{t(unitName(classId))}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="hud-btn" onClick={() => setTrainingId(null)}>
              {t("common.close")}
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === "lost" ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card campaign-lost-card" role="dialog" aria-modal="true" aria-labelledby="campaign-lost-title">
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
