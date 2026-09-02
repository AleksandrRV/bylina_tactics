import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ItemConfig, MissionConfig } from "@bylina/content";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState, useSettingsState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";
import { CampaignHint } from "./CampaignHint.js";
import { pendingCampaignHints, type CampaignHintId } from "./campaign-hints.js";
import {
  AnvilIcon,
  ChamberIcon,
  CoinIcon,
  CompassIcon,
  CrossIcon,
  GemIcon,
  HammerIcon,
  HerbIcon,
  IdolIcon,
  LevelPips,
  MissionTypeIcon,
  RadarIcon,
  ReconIcon,
  RecruitSilhouette,
  RescueIcon,
  ShieldIcon,
  ShipIcon,
  SwordsIcon,
} from "./CampaignScreen.icons.js";

/** РљР»Р°СЃСЃС‹ РґСЂСѓР¶РёРЅС‹, РґРѕСЃС‚СѓРїРЅС‹Рµ РґР»СЏ РѕР±СѓС‡РµРЅРёСЏ СЂРµРєСЂСѓС‚Р°. */
const CLASS_IDS: readonly string[] = ["bogatyr", "strelets", "znaharka", "volkhv"];

type CampTab = "map" | "roster" | "chamber" | "forge";

type ShipFlight = {
  key: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

/**
 * Р­С‚Р°Рї 4.1 (РїСЂР°РІРєР° РїРѕ СЂРµРІСЊСЋ): РїСЂСЏРјРѕР№ РїСѓС‚СЊ РєРѕСЂР°Р±Р»СЏ СЃРѕРІРїР°РґР°РµС‚ СЃ Р»РёРЅРёРµР№
 * РјР°СЂС€СЂСѓС‚Р°; РїСѓС‚СЊ РѕС‚РґР°С‘С‚СЃСЏ РІ SVG РґР»СЏ СЃР»РµРґР°.
 */
function flightArc(flight: ShipFlight): { path: string } {
  return {
    path: `M ${flight.from.x} ${flight.from.y} L ${flight.to.x} ${flight.to.y}`,
  };
}

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function itemName(itemId: string): string {
  return `item.${itemId}.name`;
}

/* ---------- Р­РєСЂР°РЅ -------------------------------------------------- */

/** РЎС‚СЂРѕРєР° СЌС„С„РµРєС‚Р° РїСЂРµРґРјРµС‚Р° РґР»СЏ РєР°СЂС‚РѕС‡РєРё РљСѓР·РЅРё Рё СЃРЅР°СЂСЏР¶РµРЅРёСЏ. */
function itemEffectParts(
  item: ItemConfig,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  const parts: string[] = [];
  if (item.weaponId) parts.push(t(`weapon.${item.weaponId}.name`));
  if (item.aimMod) parts.push(`${item.aimMod > 0 ? "+" : ""}${item.aimMod} ${t("item.aim")}`);
  if (item.defenseMod) parts.push(`${item.defenseMod > 0 ? "+" : ""}${item.defenseMod} ${t("item.defense")}`);
  if (item.mobilityMod) parts.push(`${item.mobilityMod > 0 ? "+" : ""}${item.mobilityMod} ${t("item.mobility")}`);
  if (item.maxHpMod) parts.push(`${item.maxHpMod > 0 ? "+" : ""}${item.maxHpMod} ${t("item.maxHp")}`);
  return parts;
}

/* ---------- Р“РµРѕРјРµС‚СЂРёС‡РµСЃРєРёРµ РёРєРѕРЅРєРё РІС‹РЅРµСЃРµРЅС‹ РІ CampaignScreen.icons.tsx ---------- */
/* ---------- Р­РєСЂР°РЅ -------------------------------------------------- */

export function CampaignScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const campaign = session.getCampaign();
  const state = campaign.getState();
  const sandboxOpen = state.chapter !== "prologue";
  const missions = campaign.getMissions();
  const items = campaign.getItems();
  const settings = useSettingsState();
  const { campaignHintsDone } = useSessionState();
  const [tab, setTab] = useState<CampTab>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trainingId, setTrainingId] = useState<number | null>(null);
  const [scanKey, setScanKey] = useState<number>(0);
  const [justOpened, setJustOpened] = useState<string[]>([]);
  /** РџСѓСЃС‚РѕРµ СЃРєР°РЅРёСЂРѕРІР°РЅРёРµ: РІ СЂР°РґРёСѓСЃРµ РЅРµС‚ Р·Р°РєСЂС‹С‚С‹С… С‚РѕС‡РµРє (0.19.2). */
  const [scanMissed, setScanMissed] = useState(false);
  /** РћС‡РµСЂРµРґСЊ С‚СѓС‚РѕСЂРёР°Р»РѕРІ В«РїРµСЂРІРѕРіРѕ СЂР°Р·Р°В» (0.20.0): РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ РїРѕ РѕРґРЅРѕРјСѓ. */
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
    resources.gold >= scanCost.gold && resources.herbs >= scanCost.herbs && resources.artifacts >= scanCost.artifacts;
  const lockedCount = state.missions.filter((point) => point.status === "locked").length;

  const shipPosition = state.shipPosition;
  // Р­С‚Р°Рї 4.1: РїРµСЂРµР»С‘С‚ РєРѕСЂР°Р±Р»СЏ Рє РЅРѕРІРѕР№ С‚РѕС‡РєРµ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ РєРЅРѕРїРєРѕР№ В«Р’ Р±РѕР№В»;
  // marker РґРІРёРіР°РµС‚СЃСЏ РїРѕ РїСЂСЏРјРѕР№ РІРјРµСЃС‚Рµ СЃ РѕС‚РґРµР»СЊРЅС‹Рј Р·Р°С‚СѓС…Р°СЋС‰РёРј SVG-СЃР»РµРґРѕРј.
  const [flight, setFlight] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    key: number;
  } | null>(null);
  const prevShipRef = useRef(shipPosition);
  useEffect(() => {
    const previous = prevShipRef.current;
    if (shipPosition.x === previous.x && shipPosition.y === previous.y) return;
    prevShipRef.current = shipPosition;
    setFlight({ from: previous, to: shipPosition, key: Date.now() });
    const timer = window.setTimeout(() => setFlight(null), 950);
    return () => window.clearTimeout(timer);
  }, [shipPosition]);
  const woundedFighters = state.fighters.filter((fighter) => fighter.alive && fighter.wounded);
  const training = trainingId !== null ? state.fighters.find((fighter) => fighter.id === trainingId) : undefined;

  // РўСѓС‚РѕСЂРёР°Р»С‹ В«РїРµСЂРІРѕРіРѕ СЂР°Р·Р°В» (0.20.0): Р¶РµР»Р°РµРјС‹Рµ РїРѕ СѓСЃР»РѕРІРёСЏРј СЌРєСЂР°РЅР°, РµС‰С‘ РЅРµ
  // РїРѕРєР°Р·Р°РЅРЅС‹Рµ Рё РїСЂРё РІРєР»СЋС‡С‘РЅРЅРѕР№ РЅР°СЃС‚СЂРѕР№РєРµ РїРѕРґСЃРєР°Р·РѕРє вЂ” РґРѕР±Р°РІР»СЏСЋС‚СЃСЏ РІ РѕС‡РµСЂРµРґСЊ.
  const wantedHints = useMemo(
    () =>
      pendingCampaignHints({
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
    // `wantedHints` РјРµРјРѕРёР·РёСЂРѕРІР°РЅ: Р»РёС‡РЅРѕСЃС‚СЊ РјР°СЃСЃРёРІР° РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЃ РµРіРѕ
    // СЃРѕРґРµСЂР¶РёРјС‹Рј, РїРѕСЌС‚РѕРјСѓ СЃС‚СЂРѕРєРѕРІС‹Р№ РєР»СЋС‡ РІ Р·Р°РІРёСЃРёРјРѕСЃС‚СЏС… РЅРµ РЅСѓР¶РµРЅ (0.20.55).
  }, [wantedHints]);

  // РђРєС‚РёРІРЅС‹Р№ С‚СѓС‚РѕСЂРёР°Р»: С‚РѕР»СЊРєРѕ РїСЂРё РІРєР»СЋС‡С‘РЅРЅРѕР№ РЅР°СЃС‚СЂРѕР№РєРµ РїРѕРґСЃРєР°Р·РѕРє Рё С‚РѕР»СЊРєРѕ
  // РЅРµРїРѕРєР°Р·Р°РЅРЅС‹Рµ (0.20.0). РџСЂРѕРІРµСЂРєР° showHints Р·Р°С‰РёС‰Р°РµС‚ Рё РѕС‚ СЌР»РµРјРµРЅС‚РѕРІ,
  // СѓР¶Рµ СѓСЃРїРµРІС€РёС… РїРѕРїР°СЃС‚СЊ РІ РѕС‡РµСЂРµРґСЊ РґРѕ РІС‹РєР»СЋС‡РµРЅРёСЏ РЅР°СЃС‚СЂРѕР№РєРё.
  const activeHintId = settings.showHints ? (hintQueue.find((id) => !session.isCampaignHintShown(id)) ?? null) : null;
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
    // РџСѓСЃС‚РѕРµ СЃРєР°РЅРёСЂРѕРІР°РЅРёРµ Р·Р°РїР°СЃС‹ РЅРµ С‚СЂР°С‚РёС‚ (0.19.2): РїРѕРєР°Р·С‹РІР°РµРј РїР»Р°С€РєСѓ,
    // С‡С‚Рѕ РІ СЂР°РґРёСѓСЃРµ РЅРµС‚ Р·Р°РєСЂС‹С‚С‹С… С‚РѕС‡РµРє.
    setScanMissed(true);
    window.setTimeout(() => setScanMissed(false), 1400);
  };

  const itemById = useMemo(() => {
    const map = new Map<string, ItemConfig>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  // РРєРѕРЅРєР° РІС‹С…РѕРґР° РёР· СЃС‚СЂР°С‚РµРіРёС‡РµСЃРєРѕРіРѕ СЂРµР¶РёРјР° РІ РіР»Р°РІРЅРѕРµ РјРµРЅСЋ (РґРѕСЂР°Р±РѕС‚РєР°).
  function ExitToMenuIcon() {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 4H6v16h7" />
        <path d="M16 8l4 4-4 4" />
        <path d="M10 12h9" />
      </svg>
    );
  }

  return (
    <div className={`screen campaign-screen is-tab-${tab}`}>
      <header className="campaign-top">
        <button
          type="button"
          className="campaign-exit-btn"
          // Р’С‹С…РѕРґ РІ РјРµРЅСЋ СЃРѕС…СЂР°РЅСЏРµС‚ РєРѕРЅС‚РµРєСЃС‚ РЅР°С‡Р°С‚РѕР№ РјРёСЃСЃРёРё (0.20.18):
          // В«РџСЂРѕРґРѕР»Р¶РёС‚СЊВ» РІРѕР·РІСЂР°С‰Р°РµС‚ РІ РЅРµС‘ РґР°Р¶Рµ РїРѕСЃР»Рµ Р·Р°С…РѕРґР° РЅР° РєР°СЂС‚Сѓ.
          onClick={() => session.campaignToMenu()}
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
              {lockedCount > 0 ? t("scan.hint", { radius: content.campaign.scan.radius }) : t("scan.allOpen")}
            </p>
            <button
              type="button"
              className={`scan-btn${sandboxOpen && canScan && lockedCount > 0 ? "" : " is-disabled"}`}
              disabled={!sandboxOpen || !canScan || lockedCount === 0}
              onClick={doScan}
              title={t("scan.cost", { gold: scanCost.gold, herbs: scanCost.herbs, artifacts: scanCost.artifacts })}
            >
              <RadarIcon />
              {t("scan.action")}
              <span className="scan-cost" aria-hidden="true">
                {scanCost.gold > 0 ? (
                  <span className="cost-chip gold">
                    <CoinIcon />
                    {scanCost.gold}
                  </span>
                ) : null}
                {scanCost.herbs > 0 ? (
                  <span className="cost-chip herbs">
                    <HerbIcon />
                    {scanCost.herbs}
                  </span>
                ) : null}
                {scanCost.artifacts > 0 ? (
                  <span className="cost-chip artifacts">
                    <GemIcon />
                    {scanCost.artifacts}
                  </span>
                ) : null}
              </span>
            </button>
          </div>

          <div
            className={`campaign-map${scanKey > 0 ? " is-scanning" : ""}${flight ? " is-flying" : ""}`}
            role="region"
            aria-label={t("campaign.mapLabel")}
            style={{ "--ship-x": `${shipPosition.x}%`, "--ship-y": `${shipPosition.y}%` } as CSSProperties}
          >
            {/* Р”РµРєРѕСЂР°С‚РёРІРЅС‹Р№ СЂРµР»СЊРµС„: СЂРµРєР°, РіРѕСЂС‹, Р»РµСЃР°, РґРѕСЂРѕРіР° РјРµР¶РґСѓ С‚РѕС‡РєР°РјРё */}
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
              {/* Р­С‚Р°Рї 4.2: РґРѕСЂРѕРіР° РїСЂРѕСЏРІР»СЏРµС‚СЃСЏ С€С‚СЂРёС…РѕРј С‚РѕР»СЊРєРѕ РґРѕ СѓС‡Р°СЃС‚РєРѕРІ,
                  РѕС‚РєСЂС‹С‚С‹С… СЃРєР°РЅРёСЂРѕРІР°РЅРёРµРј; Р·Р°РєСЂС‹С‚С‹Рµ СЃРµРіРјРµРЅС‚С‹ РЅРµ РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ. */}
              <g className="map-road">
                {missions.slice(0, -1).map((fromMission, index) => {
                  const toMission = missions[index + 1];
                  if (!toMission) return null;
                  const targetPoint = state.missions.find((candidate) => candidate.id === toMission.id);
                  const status = targetPoint?.status ?? "locked";
                  if (status === "locked") return null;
                  return (
                    <g key={`${fromMission.id}-${toMission.id}`}>
                      <line
                        className="road-seg-glow"
                        x1={fromMission.x}
                        y1={fromMission.y}
                        x2={toMission.x}
                        y2={toMission.y}
                      />
                      <line
                        className="road-seg"
                        x1={fromMission.x}
                        y1={fromMission.y}
                        x2={toMission.x}
                        y2={toMission.y}
                        pathLength={100}
                      />
                      <line
                        className="road-seg-draw"
                        x1={fromMission.x}
                        y1={fromMission.y}
                        x2={toMission.x}
                        y2={toMission.y}
                        pathLength={100}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="map-fog" aria-hidden="true" />
            {/* Р’РѕР»РЅР° СЃРєР°РЅРёСЂРѕРІР°РЅРёСЏ РѕС‚ РєРѕСЂР°Р±Р»СЏ */}
            {scanKey > 0 ? <div key={scanKey} className="scan-wave" aria-hidden="true" /> : null}
            {scanMissed ? (
              <p className="scan-toast" role="status">
                {t("scan.nothing")}
              </p>
            ) : null}

            {missions.map((mission) => {
              const point = state.missions.find((candidate) => candidate.id === mission.id);
              const status = point?.status ?? "locked";
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
                    {/* Р­С‚Р°Рї 4.3: РёРєРѕРЅРєР° С‚РёРїР° РјРёСЃСЃРёРё РІРјРµСЃС‚Рѕ Р°Р±СЃС‚СЂР°РєС‚РЅРѕР№ СЂСѓРЅС‹. */}
                    {status === "done" ? "вњ“" : status === "locked" ? "?" : <MissionTypeIcon type={mission.type} />}
                  </span>
                  <span className="marker-label" aria-hidden="true">
                    {mission.id.replace("clearing_", "C")}
                  </span>
                </button>
              );
            })}

            {/* Р­С‚Р°Рї 4.1: РїСЂСЏРјРѕР№ СЃР»РµРґ РѕСЃС‚Р°С‘С‚СЃСЏ РѕС‚РґРµР»СЊРЅС‹Рј SVG-СЃР»РѕРµРј Рё
                СЃРёРЅС…СЂРѕРЅРµРЅ СЃ РґРІРёР¶РµРЅРёРµРј СЃР°РјРѕРіРѕ marker. */}
            {flight ? (
              <svg className="ship-flight-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path className="ship-flight-trail-glow" d={flightArc(flight).path} pathLength={100} />
                <path className="ship-flight-trail" d={flightArc(flight).path} pathLength={100} />
              </svg>
            ) : null}

            {/* Р­РєСЃРїРµСЂС‚СЃРєР°СЏ СЃС…РµРјР°: Р°РЅРёРјРёСЂСѓРµС‚СЃСЏ РЅР°СЃС‚РѕСЏС‰РёР№ ship-marker, Р° РЅРµ
                РЅСѓР»РµРІР°СЏ РїРѕ СЂР°Р·РјРµСЂСѓ РѕР±С‘СЂС‚РєР° СЃ Р°Р±СЃРѕР»СЋС‚РЅРѕ РїРѕР·РёС†РёРѕРЅРёСЂРѕРІР°РЅРЅС‹Рј С‚РµР»РѕРј.
                РЎСЂРµРґРЅСЏСЏ С‚РѕС‡РєР° Р»РµР¶РёС‚ РЅР° РїСЂСЏРјРѕРј РјР°СЂС€СЂСѓС‚Рµ, РїРѕСЌС‚РѕРјСѓ РєРѕСЂР°Р±Р»СЊ
                СЃРѕРІРїР°РґР°РµС‚ СЃ СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рј РїСЂСЏРјС‹Рј СЃР»РµРґРѕРј. */}
            <div
              key={flight?.key ?? "ship-marker"}
              className={`ship-marker${flight ? " is-flying" : ""}`}
              aria-hidden="true"
              title={t("campaign.ship")}
              style={
                {
                  left: `${flight?.from.x ?? shipPosition.x}%`,
                  top: `${flight?.from.y ?? shipPosition.y}%`,
                  ...(flight
                    ? {
                        "--ship-from-x": `${flight.from.x}%`,
                        "--ship-from-y": `${flight.from.y}%`,
                        "--ship-mid-x": `${(flight.from.x + flight.to.x) / 2}%`,
                        "--ship-mid-y": `${(flight.from.y + flight.to.y) / 2}%`,
                        "--ship-to-x": `${flight.to.x}%`,
                        "--ship-to-y": `${flight.to.y}%`,
                      }
                    : {}),
                } as CSSProperties
              }
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
                    {selected.type === "destroy" ? (
                      <IdolIcon />
                    ) : selected.type === "rescue" ? (
                      <RescueIcon />
                    ) : selected.type === "recon" ? (
                      <ReconIcon />
                    ) : (
                      <SwordsIcon />
                    )}
                  </span>
                  <div>
                    <p className="mission-id">{selected.id}</p>
                    <h2 className="mission-title">{t(`campaign.type.${selected.type}`)}</h2>
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
                          {t(unitName(entry.unitId))} Г—{entry.count}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div className="fact-row">
                    <dt>{t("campaign.reward")}</dt>
                    <dd>
                      <span className="reward-chips" aria-label={t("campaign.reward")}>
                        {selected.rewards.gold > 0 ? (
                          <span className="cost-chip gold">
                            <CoinIcon />
                            {selected.rewards.gold}
                          </span>
                        ) : null}
                        {selected.rewards.herbs > 0 ? (
                          <span className="cost-chip herbs">
                            <HerbIcon />
                            {selected.rewards.herbs}
                          </span>
                        ) : null}
                        {selected.rewards.artifacts > 0 ? (
                          <span className="cost-chip artifacts">
                            <GemIcon />
                            {selected.rewards.artifacts}
                          </span>
                        ) : null}
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
                {selectedPoint.status === "open" && state.activeMissionId === selected.id ? (
                  // РќР°С‡Р°С‚Р°СЏ РјРёСЃСЃРёСЏ (0.20.18): РІРµСЂРЅСѓС‚СЊСЃСЏ РІ РЅРµС‘ Р»РёР±Рѕ РѕСЃРѕР·РЅР°РЅРЅРѕ
                  // РїРѕРєРёРЅСѓС‚СЊ вЂ” РјРѕР»С‡Р° РјРёСЃСЃРёСЏ РЅРµ С‚РµСЂСЏРµС‚СЃСЏ РЅРё РёР· Р±РѕСЏ, РЅРё РёР· РјРµРЅСЋ.
                  <div className="mission-actions">
                    <button type="button" className="campaign-start-btn" onClick={() => session.resumeCampaign()}>
                      {t("campaign.resumeMission")}
                      <span aria-hidden="true">в†’</span>
                    </button>
                    <button
                      type="button"
                      className="campaign-abandon-btn"
                      onClick={() => {
                        session.leaveCampaignMission();
                        setSelectedId(null);
                      }}
                    >
                      {t("campaign.abandonMission")}
                    </button>
                  </div>
                ) : selectedPoint.status === "open" && state.activeMissionId !== null ? (
                  // Р”СЂСѓРіР°СЏ С‚РѕС‡РєР°, РїРѕРєР° РјРёСЃСЃРёСЏ РЅР°С‡Р°С‚Р°: СЃС‚Р°СЂС‚ РЅРµРґРѕСЃС‚СѓРїРµРЅ.
                  <div className="mission-actions">
                    <button
                      type="button"
                      className="campaign-start-btn"
                      disabled
                      title={t("campaign.missionActiveHint")}
                    >
                      {t("campaign.start")}
                    </button>
                    <p className="mission-active-note">{t("campaign.missionActiveHint")}</p>
                  </div>
                ) : selectedPoint.status === "open" ? (
                  <div className="mission-actions">
                    <button
                      type="button"
                      className="campaign-start-btn"
                      onClick={() => {
                        // Р­С‚Р°Рї 4.1 (РїСЂР°РІРєР° РїРѕ СЂРµРІСЊСЋ): РєРѕСЂР°Р±Р»СЊ СѓР»РµС‚Р°РµС‚ Рє С‚РѕС‡РєРµ
                        // РІС‹Р±СЂР°РЅРЅРѕР№ РјРёСЃСЃРёРё СЃСЂР°Р·Сѓ РїРѕСЃР»Рµ В«Р’ Р±РѕР№В», РґРѕ РїРµСЂРµС…РѕРґР°
                        // Рє РІС‹Р±РѕСЂСѓ СЃРѕСЃС‚Р°РІР°, вЂ” СЌС‚Рѕ Рё РµСЃС‚СЊ РјРѕРјРµРЅС‚ РїСЂРѕРіСЂРµСЃСЃР°.
                        setFlight({
                          key: Date.now(),
                          from: { ...shipPosition },
                          to: { x: selected.x, y: selected.y },
                        });
                        window.setTimeout(() => {
                          if (session.startCampaignMission(selected.id)) {
                            setSelectedId(null);
                          }
                        }, 950);
                      }}
                    >
                      {t("campaign.start")}
                      <span aria-hidden="true">в†’</span>
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
              {t("roster.count", {
                current: state.fighters.filter((fighter) => fighter.alive).length,
                max: content.campaign.rosterCap,
              })}
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
                        <span
                          className="wounded-tag"
                          title={t("roster.woundedHint", {
                            aim: penalty.aim,
                            defense: penalty.defense,
                            mobility: penalty.mobility,
                          })}
                        >
                          {t("roster.wounded")}
                        </span>
                      ) : null}
                    </span>
                    <span className="fighter-class">{recruit ? t("roster.recruit") : t(unitName(fighter.unitId))}</span>
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
                    <button
                      type="button"
                      className="btn btn-primary train-btn"
                      onClick={() => setTrainingId(fighter.id)}
                    >
                      {t("roster.train")}
                    </button>
                  ) : null}
                  {fighter.alive && !recruit && !fighter.wounded && !equipped ? (
                    <span className="fighter-ready" aria-hidden="true" title={t("roster.ready")}>
                      вњ“
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
                      <span className="fighter-hp">{t("battle.hp", { current: fighter.hp, max: fighter.maxHp })}</span>
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
            <p className="muted">{t("forge.inventory", { current: state.inventory.length })}</p>
          </div>
          <div className="forge-grid">
            {items.map((item) => {
              const crafted = state.inventory.includes(item.id);
              const affordable =
                resources.gold >= item.cost.gold &&
                resources.herbs >= item.cost.herbs &&
                resources.artifacts >= item.cost.artifacts;
              const parts = itemEffectParts(item, t);
              return (
                <div key={item.id} className={`forge-card${crafted ? " is-crafted" : ""}`}>
                  <span className="forge-icon" aria-hidden="true">
                    {item.weaponId ? <SwordsIcon /> : <GemIcon />}
                  </span>
                  <span className="forge-name">{t(itemName(item.id))}</span>
                  <span className="forge-effects">{parts.join(" В· ")}</span>
                  <span className="forge-cost" aria-label={t("forge.cost")}>
                    {item.cost.gold > 0 ? (
                      <span className="cost-chip gold">
                        <CoinIcon />
                        {item.cost.gold}
                      </span>
                    ) : null}
                    {item.cost.herbs > 0 ? (
                      <span className="cost-chip herbs">
                        <HerbIcon />
                        {item.cost.herbs}
                      </span>
                    ) : null}
                    {item.cost.artifacts > 0 ? (
                      <span className="cost-chip artifacts">
                        <GemIcon />
                        {item.cost.artifacts}
                      </span>
                    ) : null}
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
          {state.inventory.length > 0 ? <p className="forge-note">{t("forge.equipHint")}</p> : null}
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
          onClick={() => sandboxOpen && setTab("chamber")}
          disabled={!sandboxOpen}
        >
          <ChamberIcon />
          {t("campaign.tabChamber")}
          {woundedFighters.length > 0 ? (
            <span className="tab-alert" aria-label={t("chamber.count", { current: woundedFighters.length })}>
              {woundedFighters.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={`campaign-tab${tab === "forge" ? " is-active" : ""}`}
          onClick={() => setTab("forge")}
        >
          <HammerIcon />
          {t("campaign.tabForge")}
          {state.inventory.length > 0 ? (
            <span
              className="tab-alert forge-alert"
              aria-label={t("forge.inventory", { current: state.inventory.length })}
            >
              {state.inventory.length}
            </span>
          ) : null}
        </button>
      </nav>

      {activeHintId ? <CampaignHint key={activeHintId} hintId={activeHintId} onClose={closeHint} /> : null}

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
                    {face ? (
                      <img src={face} alt="" draggable={false} />
                    ) : (
                      <span className="deploy-face-empty" aria-hidden="true" />
                    )}
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
          <div
            className="pause-card campaign-lost-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-lost-title"
          >
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
