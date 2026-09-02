import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  compilePrologueLayout,
  defaultTrainingWeapons,
  dismissPrologueHint,
  distH,
  isCaptive,
  pickEnemyCommand,
  pickScriptedEnemyCommand,
  weaponStatsFromRecord,
  type CellPos,
  type Command,
  type EntityState,
  type GameEvent,
  type HitPreview,
  type MatchState,
  type ReachableCell,
  type SkillStats,
  type TacticsKernel,
  type TrainingEnemyScriptState,
  type WeaponStats,
} from "@bylina/core";
import { createFieldRenderer, type FieldRenderer } from "@bylina/render";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTION_SHORTCUTS, shortcutForAction } from "./action-shortcuts.js";
import { resolveBattleKey, type BattleKeyContext, type BattleKeyIntent } from "./battle-keyboard.js";
import { resolveCellClick } from "./battle-cell-click.js";
import { prologueAftermath, routeCommand } from "./battle-command.js";
import { enemyPhaseActive, enemyPhaseContinues, type EnemyPhaseState } from "./battle-enemy-phase.js";
import { createBattleKernel } from "./battle-match.js";
import { firstFighterId } from "./battle-selection.js";
import { IDLE_INTENT, nextIntent, type Intent, type IntentEvent } from "./battle-intent.js";
import { cellKey } from "./cell-interaction.js";
import type { LayoutMarkers } from "./prologue-cutscene.js";
import { shouldAutoEndTurn, trainingHintsSorted, trainingOutcome } from "./training-progress.js";
import {
  directiveAllowsAction,
  resolveTrainingDirective,
  trainingActionKindOfCommand,
  trainingCommandAllowed,
  trainingDenialKey,
  trainingStepCompleted,
  type TrainingActionKind,
  type TrainingDirectiveView,
} from "./training-scenario.js";
import { ActionInfoDialog, ActionSlot } from "./action-panel.js";
import { EnemyFace, RosterCard, UnitInfoDialog } from "./unit-card.js";
import { buildUnitInfo, type UnitInfo } from "./unit-info.js";
import { meleeStrikeOf, planCharge, type ChargePlan, type MeleeStrike } from "./charge-attack.js";
import { actionArt } from "./action-art.js";
import { liberateActionInfo, skillActionInfo, stanceActionInfo, weaponActionInfo, type ActionInfo } from "./action-info.js";
import { useServices, useT } from "./context.js";
import { useBattleRevision, useI18nTick, useLatest, useSessionState, useSettingsState } from "./hooks.js";
import { CampaignHint } from "./CampaignHint.js";
import { pendingCampaignHints, type CampaignHintId } from "./campaign-hints.js";
import { buildEnemyStrip, rememberEnemies, type RememberedEnemy } from "./enemy-strip.js";
import { unitPortrait } from "./portraits.js";
import { createOutcomeGate, type OutcomeGate } from "./outcome-gate.js";
import { usePrologueDirector } from "./prologue-director.js";
import { useBattleNetwork } from "./useBattleNetwork.js";
import { useBattleInput } from "./useBattleInput.js";
import { useReplayControls } from "./useReplayControls.js";
import { AutoWinIcon, DebugIcon, ExitIcon } from "./BattleScreenView.icons.js";
import {
  afterPrologueApply,
  buildPrologueContext,
  createPrologueRunState,
  gatePrologueCommand,
  clampPrologueCommand,
  tickPrologueEnemyTurn,
  createTelemetryLog,
  recordTelemetry,
  type PrologueRunState,
  type TelemetryLog,
} from "./prologue-battle.js";
import "./battle.css";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function unitNameKey(configId: string): string {
  return `unit.${configId}.name`;
}

/**
 * Р­С‚Р°Рї 1.5: Сѓ РІСЃРµС… Р¶РёРІС‹С… Р±РѕР№С†РѕРІ СЃС‚РѕСЂРѕРЅС‹ РёРіСЂРѕРєР° РёСЃС‡РµСЂРїР°РЅС‹ РѕС‡РєРё РґРµР№СЃС‚РІРёСЏ вЂ”
 * РєРЅРѕРїРєР° В«Р—Р°РІРµСЂС€РёС‚СЊ С…РѕРґВ» РїРѕРґСЃРІРµС‡РёРІР°РµС‚СЃСЏ СЏРЅС‚Р°СЂРЅРѕР№ Р·Р°Р»РёРІРєРѕР№.
 */
function allOwnApSpent(entities: readonly EntityState[], owner: number): boolean {
  let fighters = 0;
  for (const entity of entities) {
    if (entity.dead || entity.coverType !== 0 || entity.owner !== owner || entity.maxAp === 0) continue;
    fighters += 1;
    if (entity.ap > 0) return false;
  }
  return fighters > 0;
}

/**
 * РџРѕСЃС‚РѕСЏРЅРЅС‹Р№ РїСѓСЃС‚РѕР№ СЃРЅРёРјРѕРє РґР»СЏ СЃР»СѓС‡Р°СЏ, РєРѕРіРґР° СЃРµС‚РµРІРѕР№ СЃРЅРёРјРѕРє РµС‰С‘ РЅРµ РїСЂРёС€С‘Р»
 * (0.21.11): РјРѕРґСѓР»СЊРЅР°СЏ РєРѕРЅСЃС‚Р°РЅС‚Р°, С‡С‚РѕР±С‹ useMemo РЅРµ Р·Р°РІРёСЃРµР» РѕС‚ СЃРѕР·РґР°РІР°РµРјРѕРіРѕ РЅР°
 * РєР°Р¶РґРѕРј СЂРµРЅРґРµСЂРµ РѕР±СЉРµРєС‚Р°-РїСѓСЃС‚С‹С€РєРё.
 */
const EMPTY_SNAPSHOT: MatchState = {
  turnNumber: 1,
  activeOwner: PLAYER_OWNER,
  grid: { width: 8, height: 6, tiles: [] },
  entities: [],
};

export function BattleScreenView() {
  useI18nTick();
  const t = useT();
  const { session, content, debug } = useServices();
  const {
    paused,
    difficulty,
    battleKind,
    activeMissionId,
    deployment,
    matchSeed,
    trainingDone: trainingDoneMissions,
  } = useSessionState();
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const hoverRef = useRef<string | null>(null);
  const inputRef = useBattleInput();

  const [debugMovement, setDebugMovement] = useState(false);

  const weapons = useMemo(() => {
    const base: Record<string, WeaponStats> = defaultTrainingWeapons();
    for (const record of content.weapons) {
      base[record.id] = weaponStatsFromRecord(record);
    }
    for (const record of content.prologueBestiary?.weapons ?? []) {
      base[record.id] = weaponStatsFromRecord(record);
    }
    return base;
  }, [content.weapons, content.prologueBestiary]);

  const skills = useMemo(() => {
    const result: Record<string, SkillStats> = {};
    for (const record of content.skills) result[record.id] = record as SkillStats;
    return result;
  }, [content.skills]);

  // РЎРµС‚РµРІРѕР№ РІРµРґРѕРјС‹Р№ (0.15.0) РЅРµ РёСЃРїРѕР»РЅСЏРµС‚ РїСЂР°РІРёР»Р°: СЏРґСЂРѕ Сѓ РІРµРґСѓС‰РµРіРѕ,
  // СЃРЅРёРјРѕРє Рё РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РїСЂРёС…РѕРґСЏС‚ РїРѕ РєР°РЅР°Р»Сѓ.
  const network = useBattleNetwork(session, battleKind);
  const { isNetGuest, isSpectator } = network;
  const isReplay = battleKind === "replay";
  const replayJournal = session.get().replayJournal;
  const isTraining = battleKind === "training";
  const isPrologue = battleKind === "prologue";
  const trainingMission = isTraining
    ? content.training.missions.find((mission) => mission.id === session.get().trainingMissionId)
    : undefined;
  const prologueMission = isPrologue
    ? content.prologue.missions.find((mission) => mission.id === session.get().prologueMissionId)
    : undefined;
  // РњР°СЂРєРµСЂС‹ Р°РІС‚РѕСЂСЃРєРѕР№ СЂР°СЃРєР»Р°РґРєРё РјРёСЃСЃРёРё: СЃС†РµРЅР° СЃСЃС‹Р»Р°РµС‚СЃСЏ РЅР° РїР°Р»РєСѓ РёР»Рё С‚РѕС‡РєСѓ
  // РІС‹С…РѕРґР° РєСЂС‹СЃС‹ СЃРёРјРІРѕР»РѕРј, СЃСЂРµРґСЃС‚РІРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РїРѕР»СѓС‡Р°РµС‚ СѓР¶Рµ РєР»РµС‚РєСѓ.
  const prologueMarkers = useMemo<LayoutMarkers | null>(() => {
    if (!prologueMission?.map.layout) return null;
    return compilePrologueLayout(prologueMission.map.layout).markers;
  }, [prologueMission]);
  // РЇРґСЂРѕ Р±РѕСЏ СЃРѕР·РґР°С‘С‚СЃСЏ РѕРґРёРЅ СЂР°Р· РЅР° РјРѕРЅС‚Р°Р¶ СЌРєСЂР°РЅР°: РІРёРґ Р±РѕСЏ СЃР°Рј СЂРµС€Р°РµС‚, РѕС‚РєСѓРґР°
  // РІР·СЏС‚СЊ РїР°СЂС‚РёСЋ вЂ” РёР· СЃРѕС…СЂР°РЅРµРЅРёСЏ, Р¶СѓСЂРЅР°Р»Р° РїРѕРІС‚РѕСЂР°, РјРёСЃСЃРёРё РёР»Рё Р±С‹СЃС‚СЂРѕРіРѕ РјР°С‚С‡Р°
  // (0.20.68). РџСЂРёРІСЏР·РєР° Рє СЃРµСЃСЃРёРё РѕСЃС‚Р°Р»Р°СЃСЊ Р·РґРµСЃСЊ: СЂРµС€Р°С‚РµР»СЊ С‚РѕР»СЊРєРѕ С‡РёС‚Р°РµС‚.
  const [kernel] = useState<TacticsKernel | null>(() => {
    const host = createBattleKernel({
      battleKind,
      content,
      session,
      weapons,
      skills,
      matchSeed,
      difficulty,
      activeMissionId,
      deployment,
      isNetGuest,
      prologueMission: prologueMission ?? null,
      trainingMission: trainingMission ?? null,
      replayJournal: replayJournal ?? null,
    });
    if (host) session.bindTacticsHost(host);
    return host;
  });

  // Р РµРІРёР·РёСЏ Р±РѕСЏ (0.21.11, P1-1 С‡Р°СЃС‚СЊ 2): РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РїСЂРёР·РЅР°Рє СѓСЃС‚Р°СЂРµРІР°РЅРёСЏ
  // СЃРЅРёРјРєР°. РњРµРЅСЏРµС‚СЃСЏ РѕРґРёРЅ СЂР°Р· РЅР° Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРЅРѕРµ РёР·РјРµРЅРµРЅРёРµ Р±РѕСЏ вЂ” Сѓ Р»РѕРєР°Р»СЊРЅРѕРіРѕ
  // С…РѕСЃС‚Р° СЌС‚Рѕ СЂРµРІРёР·РёСЏ СЏРґСЂР°, Сѓ СЃРµС‚РµРІРѕРіРѕ РІРµРґРѕРјРѕРіРѕ/РЅР°Р±Р»СЋРґР°С‚РµР»СЏ вЂ” СЃС‡С‘С‚С‡РёРє
  // РїСЂРёС…РѕРґСЏС‰РёС… СЃРЅРёРјРєРѕРІ. Р—Р°РїСЂРѕСЃС‹ РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂР° СЂРµРІРёР·РёСЋ РЅРµ РґРІРёРіР°СЋС‚.
  const battleRevision = useBattleRevision(session);
  // РќР°РјРµСЂРµРЅРёРµ РёРіСЂРѕРєР° вЂ” РѕРґРёРЅ РѕР±СЉРµРєС‚ РІРјРµСЃС‚Рѕ СЃРµРјРё СЃРѕСЃС‚РѕСЏРЅРёР№ (0.21.16вЂ“0.21.17,
  // РґРЅРё 17вЂ“18, P1-2): СЃРµРјСЊ РїСЂРµР¶РЅРёС… useState (selectedId, action, aimId,
  // skillTargetPos, preview, charge, chargeArmed) Р·Р°РјРµРЅРµРЅС‹ РѕРґРЅРёРј СЌС‚РёРј, Р°
  // РїСЂРµР¶РЅРёРµ РёРјРµРЅР° РѕСЃС‚Р°СЋС‚СЃСЏ РїСЂРѕРёР·РІРѕРґРЅС‹РјРё Р·РЅР°С‡РµРЅРёСЏРјРё РЅРёР¶Рµ. Р—Р°РїРёСЃСЊ РёРґС‘С‚ С‚РѕР»СЊРєРѕ
  // СЃРѕР±С‹С‚РёРµРј РІ С‡РёСЃС‚СѓСЋ nextIntent (battle-intent.ts) вЂ” Р·Р°РїСЂРµС‰С‘РЅРЅС‹Рµ СЃРѕС‡РµС‚Р°РЅРёСЏ
  // (В«РїСЂРёС†РµР» Р±РµР· Р±РѕР№С†Р°В», В«СЂС‹РІРѕРє Р±РµР· РїР»Р°РЅР°В») РЅРµРІС‹СЂР°Р·РёРјС‹ РІ С‚РёРїР°С….
  const [intent, setIntentState] = useState<Intent>(IDLE_INTENT);
  // РЎС‚Р°Р±РёР»СЊРЅС‹Р№ РґРёСЃРїРµС‚С‡РµСЂ: РІРЅСѓС‚СЂРё С‚РѕР»СЊРєРѕ С„СѓРЅРєС†РёРѕРЅР°Р»СЊРЅР°СЏ РѕР±РЅРѕРІР»СЏСЋС‰Р°СЏ С„РѕСЂРјР°
  // РїРѕРІРµСЂС… С‡РёСЃС‚РѕР№ nextIntent, РїРѕСЌС‚РѕРјСѓ СЃСЃС‹Р»РєР° РЅРµ РјРµРЅСЏРµС‚СЃСЏ РјРµР¶РґСѓ РєР°РґСЂР°РјРё.
  const setIntent = useCallback((event: IntentEvent): void => {
    setIntentState((current) => nextIntent(current, event));
  }, []);
  const selectedId = intent.kind === "idle" ? null : intent.actorId;
  const action = intent.kind === "aiming" || intent.kind === "charging" ? intent.action : null;
  const aimId = intent.kind === "aiming" || intent.kind === "charging" ? intent.targetId : null;
  const skillTargetPos = intent.kind === "aiming" ? intent.targetPos : null;
  const preview = intent.kind === "aiming" || intent.kind === "placing" ? intent.preview : null;
  const charge = intent.kind === "charging" ? intent.plan : null;
  const chargeArmed = intent.kind === "charging" ? intent.armed : false;
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enemyPhase, setEnemyPhase] = useState(false);
  // Р“РѕС‚РѕРІРЅРѕСЃС‚СЊ СЃСЂРµРґСЃС‚РІР° РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ: РїРµСЂРµСЂРёСЃРѕРІРєР° РїРѕСЃР»Рµ Р°СЃРёРЅС…СЂРѕРЅРЅРѕРіРѕ РјРѕРЅС‚Р°Р¶Р°,
  // С‡С‚РѕР±С‹ СЌС„С„РµРєС‚С‹ СѓРІРёРґРµР»Рё rendererRef. РќРµ СЃРІСЏР·Р°РЅРѕ СЃ СЂРµРІРёР·РёРµР№ Р±РѕСЏ.
  const [rendererReady, setRendererReady] = useState(false);
  // РљРёРЅРµРјР°С‚РѕРіСЂР°С„РёС‡РµСЃРєР°СЏ СЃС†РµРЅР° (0.20.37): РїРѕРєР° РёРґС‘С‚, РІРІРѕРґ РёРіСЂРѕРєР° Р·Р°РєСЂС‹С‚ Рё РЅР°
  // СЌРєСЂР°РЅРµ РґРѕСЃС‚СѓРїРЅР° РєРЅРѕРїРєР° РїСЂРѕРїСѓСЃРєР° (campaign.md В§1.8).
  const [cutscenePlaying, setCutscenePlaying] = useState(false);
  /**
   * РСЃС…РѕРґ РёР·РІРµСЃС‚РµРЅ, РЅРѕ РµС‰С‘ РЅРµ РїРѕРєР°Р·Р°РЅ (0.20.40): РѕС‚ РјРѕРјРµРЅС‚Р° РїРѕСЃР»РµРґРЅРµРіРѕ
   * СЃРѕР±С‹С‚РёСЏ РґРѕ РєР°СЂС‚РѕС‡РєРё РёС‚РѕРіР° РєРЅРѕРїРєРё СѓРїСЂР°РІР»РµРЅРёСЏ СЃРєСЂС‹С‚С‹, Р° СѓРїСЂР°РІР»РµРЅРёРµ
   * Р·Р°РєСЂС‹С‚Рѕ вЂ” РёРЅР°С‡Рµ РёРіСЂРѕРє СѓСЃРїРµРІР°РµС‚ РЅР°Р¶Р°С‚СЊ Р»РёС€РЅРµРµ РІ РєР°РґСЂРµ, РєРѕС‚РѕСЂС‹Р№
   * РїСЂРёРЅР°РґР»РµР¶РёС‚ РїСЂРѕРёРіСЂС‹РІР°РЅРёСЋ Р±РѕСЏ.
   */
  const [outcomePending, setOutcomePending] = useState(false);

  // Р РµР¶РёРј РѕР±СѓС‡РµРЅРёСЏ (0.19.0): Р°РєС‚РёРІРЅС‹Р№ С€Р°Рі РїРѕРґСЃРєР°Р·РєРё; РѕС‚СЃР»РµР¶РёРІР°РЅРёРµ СЃРѕР±С‹С‚РёР№
  // РґР»СЏ РїРµСЂРµС…РѕРґР° Рє СЃР»РµРґСѓСЋС‰РµРјСѓ С€Р°РіСѓ. РЁР°РіРё РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ РїРѕ РїРѕСЂСЏРґРєСѓ РїРѕР»СЏ step
  // РєРѕРЅС„РёРіСѓСЂР°С†РёРё (0.19.1): РїРѕСЂСЏРґРѕРє РјР°СЃСЃРёРІР° hints Р·РЅР°С‡РµРЅРёСЏ РЅРµ РёРјРµРµС‚.
  const [hintStep, setHintStep] = useState(0);
  // РџРѕР·РёС†РёСЏ РІ РѕС‡РµСЂРµРґРё СЃС†РµРЅР°СЂРёСЏ РќР°РІРё (0.20.13): Р¶РёРІС‘С‚ РЅР° РІСЂРµРјСЏ Р±РѕСЏ, РѕС‡РµСЂРµРґСЊ
  // СЃ РјР°СЂРєРµСЂР°РјРё РєРѕРЅС†Р° С…РѕРґР° С‡РёС‚Р°РµС‚СЃСЏ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕ.
  const enemyScriptRef = useRef<TrainingEnemyScriptState>({ index: 0 });
  const prologueRunRef = useRef<PrologueRunState | null>(
    isPrologue && prologueMission ? createPrologueRunState(prologueMission.id) : null,
  );
  /**
   * РС‚РѕРі Р±РѕСЏ РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РЅРµ СЃСЂР°Р·Сѓ (0.20.39): СЃРЅР°С‡Р°Р»Р° РґРѕРёРіСЂС‹РІР°СЋС‚ Р°РЅРёРјР°С†РёРё
   * РїРѕСЃР»РµРґРЅРµРіРѕ РґРµР№СЃС‚РІРёСЏ, Р·Р°С‚РµРј РІС‹РґРµСЂР¶РёРІР°РµС‚СЃСЏ РїР°СѓР·Р° вЂ” РёРіСЂРѕРє СѓСЃРїРµРІР°РµС‚ СѓРІРёРґРµС‚СЊ
   * С‡РёСЃР»Р° СѓСЂРѕРЅР°, РіРёР±РµР»СЊ Рё РїРѕРЅСЏС‚СЊ, С‡С‚Рѕ Р±РѕР№ РєРѕРЅС‡РёР»СЃСЏ. Р“РµР№С‚ РѕРґРёРЅ РЅР° РїР°СЂС‚РёСЋ:
   * РЅРѕРІРѕРµ СЃСЂР°Р¶РµРЅРёРµ РјРѕРЅС‚РёСЂСѓРµС‚ СЌРєСЂР°РЅ Р·Р°РЅРѕРІРѕ.
   */
  const outcomeGateRef = useRef<OutcomeGate | null>(null);
  if (outcomeGateRef.current === null) {
    outcomeGateRef.current = createOutcomeGate({ onPendingChange: setOutcomePending });
  }
  const outcomeGate = outcomeGateRef.current;
  useEffect(() => () => outcomeGate.reset(), [outcomeGate]);
  const [prologueCard, setPrologueCard] = useState<"intro" | "outro" | null>(isPrologue ? "intro" : null);
  const [prologueHintKey, setPrologueHintKey] = useState<string | null>(null);
  /**
   * РћРєРЅРѕ РёРЅС„РѕСЂРјР°С†РёРё Рѕ РґРµР№СЃС‚РІРёРё (0.20.46): РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ РґРѕР»РіРёРј РЅР°Р¶Р°С‚РёРµРј
   * РєРЅРѕРїРєРё РёР»Рё РїСЂР°РІС‹Рј РєР»РёРєРѕРј Рё Р»РµР¶РёС‚ РїРѕРІРµСЂС… Р±РѕСЏ.
   */
  const [actionInfo, setActionInfo] = useState<ActionInfo | null>(null);
  /**
   * РћРєРЅРѕ РёРЅС„РѕСЂРјР°С†РёРё Рѕ Р±РѕР№С†Рµ (0.20.53): РґРѕР»РіРёРј РЅР°Р¶Р°С‚РёРµРј РїРѕСЂС‚СЂРµС‚Р° РІ
   * РІРµСЂС…РЅРµР№ РїР°РЅРµР»Рё вЂ” СЃРІРѕРµРіРѕ Р±РѕР№С†Р° Р»РёР±Рѕ РІРёРґРёРјРѕРіРѕ РїСЂРѕС‚РёРІРЅРёРєР°.
   */
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null);
  /**
   * Р С‹РІРѕРє Рє С†РµР»Рё Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ (0.20.50): РїРѕРєР°Р·Р°РЅРЅС‹Р№ РїР»Р°РЅ РїРѕРґС…РѕРґР°.
   * `chargeArmed` вЂ” РёРіСЂРѕРє РїРѕРґС‚РІРµСЂРґРёР» РЅР°РјРµСЂРµРЅРёРµ РЅР°Р¶Р°С‚РёРµРј, СЃР»РµРґСѓСЋС‰РµРµ
   * РЅР°Р¶Р°С‚РёРµ РїРѕ С‚РѕР№ Р¶Рµ С†РµР»Рё РёСЃРїРѕР»РЅСЏРµС‚ РїРѕРґС…РѕРґ Рё СѓРґР°СЂ.
   */
  /**
   * РЎСЋР¶РµС‚РЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ (0.20.52): СЂРµРїР»РёРєР° РјРёСЃСЃРёРё, РєРѕС‚РѕСЂСѓСЋ РёРіСЂРѕРєСѓ РЅСѓР¶РЅРѕ
   * РїСЂРѕС‡РµСЃС‚СЊ. РџСЂРµР¶РґРµ С‚Р°РєРёРµ С‚РµРєСЃС‚С‹ СѓС…РѕРґРёР»Рё РІ СЃС‚СЂРѕРєСѓ Р¶СѓСЂРЅР°Р»Р° РЅР°Рґ РїР°РЅРµР»СЊСЋ
   * РґРµР№СЃС‚РІРёР№ Рё РїРµСЂРµРєСЂС‹РІР°Р»Рё РєРЅРѕРїРєРё вЂ” С‚РµРїРµСЂСЊ СЌС‚Рѕ РѕС‚РґРµР»СЊРЅРѕРµ РѕРєРЅРѕ, РєР°Рє
   * РІСЃС‚СѓРїР»РµРЅРёРµ Рё РёС‚РѕРі РјРёСЃСЃРёРё.
   */
  const [storyNote, setStoryNote] = useState<string | null>(null);
  /**
   * РљР»СЋС‡ РїРѕРґСЃРєР°Р·РєРё РїСЂРѕР»РѕРіР°, РєРѕС‚РѕСЂСѓСЋ РїРѕРєР°Р·С‹РІР°РµС‚ РѕС‚РєСЂС‹С‚РѕРµ РѕРєРЅРѕ `storyNote`
   * (0.21.21). `null`, РµСЃР»Рё РѕРєРЅРѕ РѕС‚РєСЂС‹С‚Рѕ РѕР±С‹С‡РЅРѕР№ СЂРµРїР»РёРєРѕР№ СЃС†РµРЅС‹ (В«РЎРѕР±РµСЂРёСЃСЊ
   * СЃ СЃРёР»Р°РјРёВ»). Р—Р°РєСЂС‹С‚РёРµ РѕРєРЅР°, РїРѕРєР°Р·С‹РІР°СЋС‰РµРіРѕ РїРѕРґСЃРєР°Р·РєСѓ, СЃРЅРёРјР°РµС‚ РѕРґРЅРѕСЂР°Р·РѕРІСѓСЋ
   * СЂРµРїР»РёРєСѓ СЃ РѕС‡РµСЂРµРґРё вЂ” СЃР»РµРґСѓСЋС‰Р°СЏ РѕС‚РєСЂРѕРµС‚СЃСЏ СЃРІРѕРёРј РѕРєРЅРѕРј, вЂ” Р° РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅСѓСЋ
   * (СЃС‚РѕР№РєР° Рњ2) РѕСЃС‚Р°РІР»СЏРµС‚ Р¶РёС‚СЊ РґРѕ РґРµР№СЃС‚РІРёСЏ СЃС†РµРЅС‹.
   */
  const [storyNoteHintKey, setStoryNoteHintKey] = useState<string | null>(null);
  /**
   * РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅР°СЏ СЃС‚РѕР№РєР° Рњ2 (0.20.45): РїРѕСЃР»Рµ РїРµСЂРІРѕРіРѕ РїРѕС‚СЂР°С‡РµРЅРЅРѕРіРѕ РћР” С…РѕРґ
   * РіРµСЂРѕСЏ РїСЂРёРЅР°РґР»РµР¶РёС‚ Р·Р°С‰РёС‚РЅРѕР№ СЃС‚РѕР№РєРµ. РљРЅРѕРїРєР° СЃС‚РѕР№РєРё РїСѓР»СЊСЃРёСЂСѓРµС‚, РѕСЃС‚Р°Р»СЊРЅС‹Рµ
   * РґРµР№СЃС‚РІРёСЏ Р·Р°РєСЂС‹С‚С‹ вЂ” РІРєР»СЋС‡Р°СЏ В«РљРѕРЅРµС† С…РѕРґР°В». Р•РґРёРЅСЃС‚РІРµРЅРЅРѕРµ РїСЂРёРЅСѓР¶РґРµРЅРёРµ
   * РїСЂРѕР»РѕРіР° (campaign.md В§1.1), РїРѕСЌС‚РѕРјСѓ СЃРѕСЃС‚РѕСЏРЅРёРµ Р¶РёРІС‘С‚ СЂРѕРІРЅРѕ РѕРґРёРЅ С…РѕРґ.
   */
  const [prologueStanceLock, setPrologueStanceLock] = useState(false);
  /**
   * РЎС†РµРЅС‹, СѓР¶Рµ СЃС‹РіСЂР°РЅРЅС‹Рµ РІ СЌС‚РѕРј Р±РѕСЋ (0.20.45). РЎС†РµРЅР° СЃ `once` РїРѕРІС‚РѕСЂРЅРѕ РЅРµ
   * РІС‹Р±РёСЂР°РµС‚СЃСЏ: С‚СЂРёРіРіРµСЂ `onSpawn` СЃСЂР°Р±Р°С‚С‹РІР°РµС‚ РЅР° РєР°Р¶РґРѕРµ РїРѕСЏРІР»РµРЅРёРµ, Рё
   * РїРµСЂРІР°СЏ РїР°СЂР° РєСЂС‹СЃ Рњ2 РёРіСЂР°РµС‚СЃСЏ РѕРґРёРЅ СЂР°Р·, Р° РІРѕР»РЅС‹ вЂ” РѕР±С‰РµР№ СЃС†РµРЅРѕР№ СЃС‚Р°Рё.
   */
  const firedCutscenesRef = useRef<Set<string>>(new Set());
  /**
   * РСЃС…РѕРґ, РєРѕС‚РѕСЂС‹Рј СЂР°СЃРїРѕСЂСЏР¶Р°РµС‚СЃСЏ СЃС†РµРЅР° (0.20.45).
   *
   * Р’ РїСЂРѕР»РѕРіРµ РѕР±С‰РµРµ РїСЂР°РІРёР»Рѕ В«РїСЂРѕС‚РёРІРЅРёРєРѕРІ РЅРµ РѕСЃС‚Р°Р»РѕСЃСЊВ» РЅРµРїСЂРёРјРµРЅРёРјРѕ: РєСЂС‹СЃС‹
   * Рњ2 РІС‹С…РѕРґСЏС‚ СЃ РїРѕРјРµС‚РєРѕР№ В«РЅРµ РґР»СЏ РёСЃС‚СЂРµР±Р»РµРЅРёСЏВ» Рё РїРѕ РѕР±С‰РµРјСѓ РїСЂР°РІРёР»Сѓ Р±РѕР№
   * СЃС‡РёС‚Р°Р»СЃСЏ Р±С‹ РІС‹РёРіСЂР°РЅРЅС‹Рј РІ С‚Сѓ Р¶Рµ СЃРµРєСѓРЅРґСѓ, РєРѕРіРґР° РѕРЅРё РІС‹Р±РµР¶Р°Р»Рё, вЂ” С…РѕРґ
   * РќР°РІРё РЅРµ РЅР°С‡РёРЅР°Р»СЃСЏ Р±С‹ РІРѕРІСЃРµ, Рё РїР°СЂС‚РёСЏ РІСЃС‚Р°РІР°Р»Р°. Р’ РїСЂРѕР»РѕРіРµ РёСЃС…РѕРґ
   * РѕР±СЉСЏРІР»СЏРµС‚ РєРѕРЅС‚СЂРѕР»Р»РµСЂ РјРёСЃСЃРёРё: Рњ2 РІС‹РёРіСЂС‹РІР°РµС‚СЃСЏ СЌРІР°РєСѓР°С†РёРµР№ РѕР±РѕРёС….
   */
  const battleOutcome = (): "ongoing" | "victory" | "defeat" =>
    isPrologue ? (prologueRunRef.current?.outcome ?? "ongoing") : session.getBattleOutcome();
  const prologueTelemetryRef = useRef<TelemetryLog>(createTelemetryLog());
  const [prologueObjectiveKey, setPrologueObjectiveKey] = useState(
    prologueRunRef.current?.objectiveKey ?? "prologue.objective.gather",
  );
  const trainingHints = isTraining && trainingMission ? trainingHintsSorted(trainingMission.hints) : [];
  const activeHint = trainingHints[hintStep] ?? null;

  // РћР±РЅРѕРІР»РµРЅРёРµ С€Р°РіР° РїРѕ СЃРѕР±С‹С‚РёСЏРј РґРµР№СЃС‚РІРёР№ РР“Р РћРљРђ (0.19.1): РїРѕРґСЃРєР°Р·РєР°
  // Р·Р°РІРµСЂС€Р°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РґРµР№СЃС‚РІРёРµРј РёРіСЂРѕРєР° вЂ” СЃРѕР±С‹С‚РёСЏ С…РѕРґР° РќР°РІРё РїРѕРґСЃРєР°Р·РєРё
  // РЅРµ РїСЂРѕРґРІРёРіР°СЋС‚. РЁР°РіРё СЃ repeatUntil (0.20.13) РїСЂРѕРІРµСЂСЏСЋС‚СЃСЏ РїРѕ СЃРЅРёРјРєСѓ:
  // В«Р±РёС‚СЊ РґРѕ РїРѕР±РµРґС‹В» РЅРµ Р·Р°РІРµСЂС€Р°РµС‚СЃСЏ РµРґРёРЅРёС‡РЅРѕР№ Р°С‚Р°РєРѕР№.
  const advanceTraining = (events: GameEvent[]): void => {
    if (!isTraining || !activeHint) return;
    const full = session.getBattleFullSnapshot();
    if (trainingStepCompleted(activeHint, events, full ?? snapshot)) setHintStep((value) => value + 1);
  };

  // Р РµР°РєС‚РёРІРЅС‹Рµ РїР»Р°С€РєРё РѕР±СѓС‡РµРЅРёСЏ (0.20.1): РѕС‚СЂР°РІР»РµРЅРёРµ, РІРѕСЃРєСЂРµС€РµРЅРёРµ, РїСЂРёР·С‹РІ.
  // РџРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ СЃРѕР±С‹С‚РёСЏРјРё Р»СЋР±РѕР№ СЃС‚РѕСЂРѕРЅС‹ (СЏРґ РЅР°РєР»Р°РґС‹РІР°РµС‚ РєРёРєРёРјРѕСЂР° РІ СЃРІРѕР№ С…РѕРґ).
  const [trainingNote, setTrainingNote] = useState<string | null>(null);
  const noteTimerRef = useRef<number | undefined>(undefined);
  const showTrainingNote = (events: GameEvent[]): void => {
    if (!isTraining || !trainingMission?.notes) return;
    let key: string | null = null;
    for (const event of events) {
      if (event.type === "STATUS_CHANGED" && event.status === "POISON" && event.applied) {
        key = trainingMission.notes.poison;
        break;
      }
      if (event.type === "ENTITY_SPAWNED" && event.cause === "RESURRECTION") {
        key = trainingMission.notes.resurrect;
        break;
      }
      if (event.type === "ENTITY_SPAWNED" && event.cause === "SUMMON") {
        key = trainingMission.notes.summon;
        break;
      }
    }
    if (!key) return;
    setTrainingNote(key);
    if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setTrainingNote(null), 6000);
  };
  useEffect(
    () => () => {
      if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
    },
    [],
  );

  // Р’РѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёРµ РїРѕРІС‚РѕСЂР° (0.17.0): РєРѕРјР°РЅРґС‹ Р¶СѓСЂРЅР°Р»Р° РїСЂРёРјРµРЅСЏСЋС‚СЃСЏ РїРѕ С‚Р°Р№РјРµСЂСѓ.
  // 0.21.13 (P1-3): РєСѓСЂСЃРѕСЂ РїРѕРІС‚РѕСЂР° Р¶РёРІС‘С‚ РІ ref, РїРѕСЌС‚РѕРјСѓ РёРЅС‚РµСЂРІР°Р» СЃРѕР·РґР°С‘С‚СЃСЏ РѕРґРёРЅ
  // СЂР°Р· РЅР° Р¶СѓСЂРЅР°Р» вЂ” С‚РµРјРї СЂРѕРІРЅС‹Р№, deps РїРѕР»РЅС‹, РїРѕРґР°РІР»РµРЅРёРµ exhaustive-deps РЅРµ
  // РЅСѓР¶РЅРѕ (СЂР°РЅСЊС€Рµ РёРЅС‚РµСЂРІР°Р» РїРµСЂРµСЃРѕР·РґР°РІР°Р»СЃСЏ РїРѕСЃР»Рµ РєР°Р¶РґРѕР№ РєРѕРјР°РЅРґС‹ РёР·-Р·Р°
  // replayIndex РІ Р·Р°РІРёСЃРёРјРѕСЃС‚СЏС…, С‡С‚Рѕ РґР°РІР°Р»Рѕ РґСЂРµР№С„ С‚РµРјРїР° Рё РіР»СѓС€РёР»Рѕ Р»РёРЅС‚).
  const { replayIndex, setReplayIndex, replayDone, setReplayDone } = useReplayControls();
  const replayIndexRef = useRef(0);
  useEffect(() => {
    if (!isReplay || !replayJournal || !kernel || replayDone) return;
    const commands = replayJournal.commands;
    const timer = window.setInterval(() => {
      const index = replayIndexRef.current;
      if (index >= commands.length) {
        window.clearInterval(timer);
        setReplayDone(true);
        return;
      }
      const command = commands[index];
      if (command) kernel.apply(command);
      replayIndexRef.current = index + 1;
      setReplayIndex(index + 1);
    }, 480);
    return () => window.clearInterval(timer);
  }, [isReplay, replayJournal, kernel, replayDone, setReplayIndex, setReplayDone]);

  // РћР±СЂС‹РІ РєР°РЅР°Р»Р° СЃРѕСЃС‚СЏР·Р°С‚РµР»СЊРЅРѕРіРѕ Р±РѕСЏ (0.17.0): РѕС‚СЃС‡С‘С‚ 30 СЃРµРєСѓРЅРґ.
  const netDisconnected = session.get().netDisconnected === true;
  const [disconnectLeft, setDisconnectLeft] = useState(30);
  useEffect(() => {
    if (!netDisconnected) return;
    setDisconnectLeft(30);
    const timer = window.setInterval(() => {
      setDisconnectLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [netDisconnected]);

  // РџРѕРѕС‡РµСЂС‘РґРЅР°СЏ РёРіСЂР°: РєР°Р¶РґС‹Р№ СЂРµРЅРґРµСЂ РїРѕРєР°Р·С‹РІР°РµС‚ СЃС‚РѕСЂРѕРЅСѓ, С‡РµР№ СЃРµР№С‡Р°СЃ С…РѕРґ
  // (СЃРѕРєСЂС‹С‚РёРµ РїР°РЅРµР»Рё С‡СѓР¶РѕР№ СЃС‚РѕСЂРѕРЅС‹ Рё С‚СѓРјР°РЅ СЃС‚РѕСЂРѕРЅС‹ РїСЂРё РїРµСЂРµРґР°С‡Рµ СѓСЃС‚СЂРѕР№СЃС‚РІР°).
  // РЎРµС‚РµРІРѕР№ РІРµРґРѕРјС‹Р№ РІСЃРµРіРґР° РІРёРґРёС‚ С‚РѕР»СЊРєРѕ СЃРІРѕСЋ СЃС‚РѕСЂРѕРЅСѓ; РІРµРґСѓС‰РёР№ вЂ” Р°РєС‚РёРІРЅСѓСЋ.
  const netOwner = battleKind === "pvpNet" ? session.get().netOwner : null;
  const pvpActive =
    battleKind === "pvp" || battleKind === "pvpNet"
      ? isNetGuest || isSpectator
        ? netOwner
        : (session.getBattleFullSnapshot()?.activeOwner ?? PLAYER_OWNER)
      : null;
  const viewOwner = pvpActive ?? PLAYER_OWNER;
  const enemyOwner = viewOwner === ENEMY_OWNER ? PLAYER_OWNER : ENEMY_OWNER;

  // РќР°Р±Р»СЋРґР°С‚РµР»СЊ, РєР°Рє Рё РіРѕСЃС‚СЊ, РЅРµ РёСЃРїРѕР»РЅСЏРµС‚ РїСЂР°РІРёР»Р°: СЃРЅРёРјРѕРє РїСЂРёС…РѕРґРёС‚ РѕС‚ РІРµРґСѓС‰РµРіРѕ.
  const usesNetSnapshot = isNetGuest || isSpectator;
  // РЎРЅРёРјРѕРє РІС‹С‡РёСЃР»СЏРµС‚СЃСЏ РѕРґРёРЅ СЂР°Р· РЅР° РёР·РјРµРЅРµРЅРёРµ Р±РѕСЏ (СЂРµРІРёР·РёСЏ), Р° РЅРµ РЅР° РєР°Р¶РґС‹Р№
  // СЂРµРЅРґРµСЂ: getBattleSnapshot РѕС‚РґР°С‘С‚ РіР»СѓР±РѕРєСѓСЋ РєРѕРїРёСЋ СЃРѕСЃС‚РѕСЏРЅРёСЏ (P1-1, 0.21.11).
  // РџСѓСЃС‚РѕР№ СЃРЅРёРјРѕРє-РѕР±СЉРµРєС‚ РїРѕСЃС‚РѕСЏРЅРЅС‹Р№ (EMPTY_SNAPSHOT), С‡С‚РѕР±С‹ useMemo РЅРµ РІРёРґРµР»
  // РјРµРЅСЏСЋС‰СѓСЋСЃСЏ РЅР° РєР°Р¶РґРѕРј СЂРµРЅРґРµСЂРµ СЃСЃС‹Р»РєСѓ-РїСѓСЃС‚С‹С€РєСѓ.
  const snapshot = useMemo<MatchState>(() => {
    // Р РµРІРёР·РёСЏ вЂ” РЅР°РјРµСЂРµРЅРЅС‹Р№ С‚СЂРёРіРіРµСЂ РїРµСЂРµСЃС‡С‘С‚Р° СЃРЅРёРјРєР°: РїР°РјСЏС‚СЊ РІРѕР·РІСЂР°С‰Р°РµС‚
    // СЃРІРµР¶РёР№ СЃРЅРёРјРѕРє РѕРґРёРЅ СЂР°Р· РЅР° Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРЅРѕРµ РёР·РјРµРЅРµРЅРёРµ Р±РѕСЏ (0.21.11).
    void battleRevision;
    if (usesNetSnapshot) return session.getNetSnapshot() ?? EMPTY_SNAPSHOT;
    return session.getBattleSnapshot(viewOwner);
    // viewOwner/usesNetSnapshot Р·Р°РІРёСЃСЏС‚ РѕС‚ Р°РєС‚РёРІРЅРѕРіРѕ РІР»Р°РґРµР»СЊС†Р°, РєРѕС‚РѕСЂС‹Р№ СЃР°Рј
    // РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ РІРјРµСЃС‚Рµ СЃ Р±РѕРµРј; СЂРµРІРёР·РёСЏ вЂ” РѕСЃРЅРѕРІРЅРѕР№ РїСЂРёР·РЅР°Рє СѓСЃС‚Р°СЂРµРІР°РЅРёСЏ.
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  // Р—Р°РІРµСЂС€РµРЅРёРµ РјРёСЃСЃРёРё РѕР±СѓС‡РµРЅРёСЏ: РёС‚РѕРіРѕРІР°СЏ РїР»Р°С€РєР° РІРјРµСЃС‚Рѕ РјРіРЅРѕРІРµРЅРЅРѕРіРѕ РІРѕР·РІСЂР°С‚Р°
  // (ui-design В§3: В«вЂ¦в†’ РёС‚РѕРі в†’ СЌРєСЂР°РЅ РѕР±СѓС‡РµРЅРёСЏВ»). РџСЂРѕР№РґРµРЅРЅРѕР№ СЃС‡РёС‚Р°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ
  // РїРѕР±РµРґР° (0.19.1).
  const [trainingOver, setTrainingOver] = useState<"victory" | "defeat" | null>(null);

  // РЎС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№ (0.20.13): Р°РєС‚РёРІРЅС‹Р№ С€Р°Рі РїСЂРµРІСЂР°С‰Р°РµС‚СЃСЏ РІ С‚РѕС‡РЅРѕРµ СѓРєР°Р·Р°РЅРёРµ
  // (РєР»РµС‚РєР°, РѕСЂСѓР¶РёРµ, СѓРјРµРЅРёРµ, С†РµР»СЊ, РёСЃРїРѕР»РЅРёС‚РµР»СЊ). Р’СЃС‘ РѕСЃС‚Р°Р»СЊРЅРѕРµ РёРЅС‚РµСЂС„РµР№СЃ РЅРµ
  // РёСЃРїРѕР»РЅСЏРµС‚; РїРѕРґСЃРІРµС‚РєР° СѓРєР°Р·Р°РЅРёСЏ вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ СЏСЂРєРёР№ СЌР»РµРјРµРЅС‚ РїРѕР»СЏ.
  const directiveView = useMemo<TrainingDirectiveView | null>(() => {
    // Р РµРІРёР·РёСЏ Р±РѕСЏ вЂ” РЅР°РјРµСЂРµРЅРЅС‹Р№ С‚СЂРёРіРіРµСЂ РїРµСЂРµСЃС‡С‘С‚Р° СѓРєР°Р·Р°РЅРёСЏ (Р·Р°РІРёСЃРёС‚ РѕС‚
    // РґРѕСЃС‚РёР¶РёРјРѕСЃС‚Рё, РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂРѕРІ Рё СЃРѕСЃС‚РѕСЏРЅРёСЏ С†РµР»Рё).
    void battleRevision;
    if (!isTraining || !activeHint || trainingOver) return null;
    const full = session.getBattleFullSnapshot();
    if (!full) return null;
    return resolveTrainingDirective(activeHint, {
      snapshot: full,
      reachable: (actorId) => session.getBattleReachable(actorId),
      hitPreview: (actorId, targetId, weaponId) => session.getBattleHitPreview(actorId, targetId, weaponId),
      skillPreview: (actorId, skillId, targetId, pos) => session.getBattleSkillPreview(actorId, skillId, targetId, pos),
      skills,
    });
    // РџРµСЂРµСЃС‡С‘С‚ РЅР° РєР°Р¶РґРѕРµ РёР·РјРµРЅРµРЅРёРµ Р±РѕСЏ (СЂРµРІРёР·РёСЏ): СѓРєР°Р·Р°РЅРёРµ Р·Р°РІРёСЃРёС‚ РѕС‚
    // РґРѕСЃС‚РёР¶РёРјРѕСЃС‚Рё, РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂРѕРІ Рё СЃРѕСЃС‚РѕСЏРЅРёСЏ С†РµР»Рё. РџРѕР»РЅС‹Р№ СЃРЅРёРјРѕРє РІРµРґСѓС‰РµРіРѕ
    // С‡РёС‚Р°РµС‚СЃСЏ РІРЅСѓС‚СЂРё. РўРµР»Рѕ СЃСЃС‹Р»Р°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РЅР° СЃРµСЂРІРёСЃС‹/РЅРµРёР·РјРµРЅРЅС‹Рµ Р°СЂРіСѓРјРµРЅС‚С‹.
  }, [isTraining, activeHint, trainingOver, skills, battleRevision, session]);

  // РЈРєР°Р·Р°РЅРёРµ, РѕРєР°Р·Р°РІС€РµРµСЃСЏ РЅРµРІС‹РїРѕР»РЅРёРјС‹Рј (РёСЃРїРѕР»РЅРёС‚РµР»СЊ РїРѕРіРёР±, С†РµР»СЊ СѓР¶Рµ РјРµСЂС‚РІР°,
  // СѓРјРµРЅРёРµ РёСЃС‡РµСЂРїР°РЅРѕ), РїСЂРѕРїСѓСЃРєР°РµС‚СЃСЏ вЂ” СЃС†РµРЅР°СЂРёР№ СЃР°РјРѕРІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚СЃСЏ.
  useEffect(() => {
    if (!isTraining || !activeHint || trainingOver) return;
    if (directiveView === null) setHintStep((value) => value + 1);
  }, [isTraining, activeHint, directiveView, trainingOver]);

  // Р—Р°РІРµСЂС€РµРЅРёРµ РјРёСЃСЃРёРё РѕР±СѓС‡РµРЅРёСЏ (0.19.0; СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№ 0.20.13). РџСѓС‚Рё Рє РїРѕР±РµРґРµ:
  // - РјРёСЃСЃРёСЏ Р±РµР· РїСЂРѕС‚РёРІРЅРёРєР° (В«РџРµСЂРІС‹Рµ С€Р°РіРёВ») Р·Р°РІРµСЂС€Р°РµС‚СЃСЏ РІС‹РїРѕР»РЅРµРЅРёРµРј Р’РЎР•РҐ
  //   С€Р°РіРѕРІ РїРѕРґСЃРєР°Р·РєРё: РїРѕ РїСЂР°РІРёР»Р°Рј СЏРґСЂР° С‚Р°РєР°СЏ РїР°СЂС‚РёСЏ В«РІС‹РёРіСЂР°РЅР°В» СЃ СЃР°РјРѕРіРѕ
  //   РЅР°С‡Р°Р»Р°, РїРѕСЌС‚РѕРјСѓ РёСЃС…РѕРґ СЏРґСЂР° Р·РґРµСЃСЊ РЅРµРїСЂРёРјРµРЅРёРј;
  // - РјРёСЃСЃРёСЏ СЃ РїСЂРѕС‚РёРІРЅРёРєРѕРј (В«Р‘РѕР№В», В«РЈРјРµРЅРёСЏ Рё СЃРѕСЃС‚РѕСЏРЅРёСЏВ») РёРіСЂР°РµС‚СЃСЏ РґРѕ РёС‚РѕРіР°
  //   Р±РѕСЏ вЂ” СѓРЅРёС‡С‚РѕР¶РµРЅРёСЏ РІСЃРµС… РїСЂРѕС‚РёРІРЅРёРєРѕРІ: РїРѕСЃР»РµРґРЅРёР№ С€Р°Рі СЃС†РµРЅР°СЂРёСЏ
  //   (repeatUntil victory) РІРµРґС‘С‚ РёРіСЂРѕРєР° СѓРєР°Р·Р°РЅРёСЏРјРё РґРѕ СЃР°РјРѕР№ РїРѕР±РµРґС‹, РїРѕСЌС‚РѕРјСѓ
  //   СЂРµР°РєС‚РёРІРЅС‹Рµ РїР»Р°С€РєРё (СЏРґ, РІРѕСЃРєСЂРµС€РµРЅРёРµ) СѓСЃРїРµРІР°СЋС‚ СЃСЂР°Р±РѕС‚Р°С‚СЊ.
  // РџРѕСЂР°Р¶РµРЅРёРµ вЂ” РіРёР±РµР»СЊ РІСЃРµС… Р±РѕР№С†РѕРІ РёРіСЂРѕРєР°: РќР°РІСЊ РІ РѕР±СѓС‡РµРЅРёРё РґРµР№СЃС‚РІСѓРµС‚.
  const trainingDone = isTraining && trainingHints.length > 0 && hintStep >= trainingHints.length;
  useEffect(() => {
    if (!isTraining || busy || trainingOver) return;
    // РџСѓС‚СЊ Рє РїРѕР±РµРґРµ (С€Р°РіРё РїРѕРґСЃРєР°Р·РєРё РёР»Рё РёСЃС…РѕРґ СЏРґСЂР°) РІС‹Р±РёСЂР°РµС‚ training-progress.
    const outcome = trainingOutcome({
      outcome: session.getBattleOutcome(),
      missionHasEnemies: (trainingMission?.enemies.length ?? 0) > 0,
      trainingDone,
    });
    if (outcome === null) return;
    if (outcome === "victory" && trainingMission) session.completeTrainingMission(trainingMission.id);
    // РС‚РѕРі РѕР±СѓС‡РµРЅРёСЏ вЂ” С‚Р°Рє Р¶Рµ РїРѕСЃР»Рµ Р°РЅРёРјР°С†РёР№ Рё РїР°СѓР·С‹ (0.20.39).
    outcomeGate.report(() => setTrainingOver(outcome));
  }, [
    snapshot.turnNumber,
    snapshot.entities,
    busy,
    isTraining,
    trainingDone,
    trainingHints.length,
    hintStep,
    trainingOver,
    trainingMission,
    outcomeGate,
    session,
  ]);

  // РћРіСЂР°РЅРёС‡РµРЅРёРµ РґРµР№СЃС‚РІРёР№ РІ РѕР±СѓС‡РµРЅРёРё (СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№, 0.20.13): РёРіСЂРѕРє РјРѕР¶РµС‚
  // СЃРѕРІРµСЂС€Р°С‚СЊ С‚РѕР»СЊРєРѕ С‚Рѕ РґРµР№СЃС‚РІРёРµ, РєРѕС‚РѕСЂРѕРµ РїСЂРµРґРїРёСЃС‹РІР°РµС‚ Р°РєС‚РёРІРЅРѕРµ СѓРєР°Р·Р°РЅРёРµ, вЂ”
  // Рё С‚РѕР»СЊРєРѕ СѓРєР°Р·Р°РЅРЅС‹Рј РёСЃРїРѕР»РЅРёС‚РµР»РµРј, РѕСЂСѓР¶РёРµРј, СѓРјРµРЅРёРµРј Рё С†РµР»СЊСЋ. РџР°СѓР·Р° Рё РІС‹С…РѕРґ
  // РёР· РѕР±СѓС‡РµРЅРёСЏ РѕСЃС‚Р°СЋС‚СЃСЏ РґРѕСЃС‚СѓРїРЅС‹ РІСЃРµРіРґР°. РћС‚РєР»РѕРЅС‘РЅРЅРѕРµ РґРµР№СЃС‚РІРёРµ РїРѕСЏСЃРЅСЏРµС‚СЃСЏ
  // СЃС‚СЂРѕРєРѕР№ Р»РѕРіР° (РєР»СЋС‡Рё training.locked.*, ui-design В§4.5).
  const trainingAllows = (action: TrainingActionKind): boolean => {
    if (isPrologue && prologueRunRef.current?.forceDefend) return action === "defend";
    return directiveAllowsAction(directiveView, action);
  };
  const trainingDeny = (action: TrainingActionKind): void => {
    if (directiveView) setLog(t(trainingDenialKey(directiveView, action)));
  };
  const trainingDirective = directiveView?.directive ?? null;
  const trainingActorId =
    trainingDirective && trainingDirective.kind !== "noop" && trainingDirective.kind !== "endTurn"
      ? trainingDirective.actorId
      : null;
  /** Р Р°Р·СЂРµС€РµРЅРѕ Р»Рё С‚РµРєСѓС‰РµРµ СѓРєР°Р·Р°РЅРёРµ СЌС‚РѕРјСѓ РёСЃРїРѕР»РЅРёС‚РµР»СЋ СЃ СЌС‚РёРј РѕСЂСѓР¶РёРµРј. */
  const trainingWeaponAllowed = (weaponId: string): boolean => {
    if (isPrologue && prologueRunRef.current?.forceDefend) return false;
    return !isTraining || (trainingDirective?.kind === "attack" && trainingDirective.weaponId === weaponId);
  };
  /** Р Р°Р·СЂРµС€РµРЅРѕ Р»Рё С‚РµРєСѓС‰РµРµ СѓРєР°Р·Р°РЅРёРµ СЌС‚РѕРјСѓ СѓРјРµРЅРёСЋ. */
  const trainingSkillAllowed = (skillId: string): boolean => {
    if (isPrologue && prologueRunRef.current?.forceDefend) return false;
    return !isTraining || (trainingDirective?.kind === "skill" && trainingDirective.skillId === skillId);
  };

  // Р’РёРґРёРјРѕСЃС‚СЊ/СЂР°Р·РІРµРґРєР° РїРѕР»СЏ Р·Р°РІРёСЃСЏС‚ РѕС‚ Р±РѕСЏ, Р° РЅРµ РѕС‚ РєР°РґСЂР°: СЂРµРІРёР·РёСЏ вЂ”
  // РЅР°РјРµСЂРµРЅРЅС‹Р№ С‚СЂРёРіРіРµСЂ РїРµСЂРµСЃС‡С‘С‚Р° (С‚РµР»Рѕ С‡РёС‚Р°РµС‚ СЃРµСЂРІРёСЃ), РїРѕСЌС‚РѕРјСѓ РѕРЅР°
  // СѓРїРѕРјРёРЅР°РµС‚СЃСЏ РІ С‚РµР»Рµ, С‡С‚РѕР±С‹ РѕС‚РЅРѕС€РµРЅРёРµ В«Р·Р°РІРёСЃРёРјРѕСЃС‚СЊ в†’ РїРµСЂРµСЃС‡С‘С‚В» Р±С‹Р»Рѕ СЏРІРЅС‹Рј.
  const visibleCells = useMemo(
    () => {
      void battleRevision;
      return usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner);
    },
    // РџСЂРёР·РЅР°Рє СѓСЃС‚Р°СЂРµРІР°РЅРёСЏ вЂ” СЂРµРІРёР·РёСЏ Р±РѕСЏ (0.21.11): РїР°РјСЏС‚СЊ РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚СЃСЏ
    // РѕРґРёРЅ СЂР°Р· РЅР° Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРЅРѕРµ РёР·РјРµРЅРµРЅРёРµ РїРѕР»СЏ. РўРµР»Рѕ С‡РёС‚Р°РµС‚ С‚РѕР»СЊРєРѕ СЃРµСЂРІРёСЃ.
    [battleRevision, viewOwner, usesNetSnapshot, session],
  );
  const exploredCells = useMemo(
    () => {
      void battleRevision;
      return usesNetSnapshot ? session.getNetExplored() : session.getBattleExplored(viewOwner);
    },
    // РўРѕС‚ Р¶Рµ РїСЂРёР·РЅР°Рє СѓСЃС‚Р°СЂРµРІР°РЅРёСЏ, С‡С‚Рѕ Сѓ РІРёРґРёРјРѕСЃС‚Рё РїРѕР»СЏ.
    [battleRevision, viewOwner, usesNetSnapshot, session],
  );

  // РЎС‚РѕСЂРѕРЅР° СЌРєСЂР°РЅР°: РїРѕ РЅРµР№ РјРѕРґСѓР»СЊ battle-selection РѕС‚Р±РёСЂР°РµС‚ СЃРІРѕРёС… Р±РѕР№С†РѕРІ
  // (0.20.60). РџР°РјСЏС‚СЊ РЅСѓР¶РЅР°, С‡С‚РѕР±С‹ СЃСЃС‹Р»РєР° РЅР° РЅРµС‘ РЅРµ РјРµРЅСЏР»Р°СЃСЊ РєР°Р¶РґС‹Р№ РєР°РґСЂ вЂ”
  // РёРЅР°С‡Рµ СЌС„С„РµРєС‚С‹, С‡РёС‚Р°СЋС‰РёРµ СЃС‚РѕСЂРѕРЅСѓ, РїРµСЂРµСЃС‡РёС‚С‹РІР°Р»РёСЃСЊ Р±С‹ Р±РµР· РЅСѓР¶РґС‹.
  const side = useMemo(() => ({ viewOwner, isSpectator, isReplay }), [viewOwner, isSpectator, isReplay]);

  /**
   * РџРѕРєР°Р·Р°С‚СЊ СЃСЋР¶РµС‚РЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РѕРєРЅРѕРј (0.20.52): СЃС‚СЂРѕРєР° Р¶СѓСЂРЅР°Р»Р° РіР°СЃРёС‚СЃСЏ,
   * С‡С‚РѕР±С‹ РєРѕСЂРѕС‚РєР°СЏ СЂРµРїР»РёРєР° Р±РѕСЏ РЅРµ СЃРѕСЃРµРґСЃС‚РІРѕРІР°Р»Р° СЃ РєР°СЂС‚РѕС‡РєРѕР№.
   */
  const showStoryNote = useCallback((text: string): void => {
    setLog(null);
    setStoryNoteHintKey(null);
    setStoryNote(text);
  }, []);

  /** РљР»СЋС‡ С‚РµРєСѓС‰РµР№ РїРѕРґСЃРєР°Р·РєРё РїСЂРѕР»РѕРіР°: РїСЂРёРЅСѓР¶РґС‘РЅРЅР°СЏ Р»РёР±Рѕ РїРµСЂРІР°СЏ РІ РѕС‡РµСЂРµРґРё. */
  const currentPrologueHintKey = useCallback((): string | null => {
    const hints = prologueRunRef.current?.hints;
    if (!hints) return null;
    return hints.forcedKey ?? hints.queue[0] ?? null;
  }, []);

  /**
   * РџРѕРєР°Р·Р°С‚СЊ СЃСЋР¶РµС‚РЅСѓСЋ РїРѕРґСЃРєР°Р·РєСѓ РїСЂРѕР»РѕРіР° РѕС‚РґРµР»СЊРЅС‹Рј РѕРєРЅРѕРј (0.21.21).
   *
   * Р Р°РЅСЊС€Рµ С‚Р°РєРёРµ СЂРµРїР»РёРєРё Р»РѕР¶РёР»РёСЃСЊ РїР»Р°С€РєРѕР№ `.training-note` Сѓ РЅРёР¶РЅРµРіРѕ РєСЂР°СЏ вЂ”
   * РѕРЅР° РІСЃС‚Р°РІР°Р»Р° РїРѕРІРµСЂС… РєРЅРѕРїРєРё Р·Р°С‰РёС‚РЅРѕР№ СЃС‚РѕР№РєРё Рё РјРµС€Р°Р»Р° РЅР°Р¶Р°С‚СЊ РґРµР№СЃС‚РІРёРµ.
   * РўРµРїРµСЂСЊ СЂРµРїР»РёРєР° С‡РёС‚Р°РµС‚СЃСЏ РІ С‚РѕРј Р¶Рµ РѕРєРЅРµ, С‡С‚Рѕ РІСЃС‚СѓРїР»РµРЅРёРµ Рё РёС‚РѕРі РјРёСЃСЃРёРё,
   * Р° РєРЅРѕРїРєР° СЃС‚РѕР№РєРё РѕСЃС‚Р°С‘С‚СЃСЏ СЃРІРѕР±РѕРґРЅРѕР№ РїРѕСЃР»Рµ Р·Р°РєСЂС‹С‚РёСЏ.
   */
  const showPrologueHint = useCallback(
    (key: string): void => {
      const textKey = content.prologueHints.hints.find((hint) => hint.key === key)?.textKey ?? key;
      setLog(null);
      setStoryNoteHintKey(key);
      setStoryNote(t(textKey));
    },
    [content, t],
  );

  /**
   * Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ СЃРѕРѕР±С‰РµРЅРёСЏ. РћРєРЅРѕ РїРѕРґСЃРєР°Р·РєРё РїСЂРѕР»РѕРіР° РѕС‚Р»РёС‡Р°РµС‚СЃСЏ РѕС‚ РѕР±С‹С‡РЅРѕР№
   * СЂРµРїР»РёРєРё: РѕРґРЅРѕСЂР°Р·РѕРІР°СЏ СЂРµРїР»РёРєР° СЃРЅРёРјР°РµС‚СЃСЏ СЃ РѕС‡РµСЂРµРґРё, С‡С‚РѕР±С‹ СЃР»РµРґСѓСЋС‰Р°СЏ
   * РїРѕРєР°Р·Р°Р»Р°СЃСЊ СЃРІРѕРёРј РѕРєРЅРѕРј; РїСЂРёРЅСѓР¶РґС‘РЅРЅР°СЏ (СЃС‚РѕР№РєР° Рњ2) РѕСЃС‚Р°С‘С‚СЃСЏ РґРѕ РґРµР№СЃС‚РІРёСЏ
   * СЃС†РµРЅС‹ вЂ” Р·Р°РєСЂС‹С‚РёРµ С‚РѕР»СЊРєРѕ РїСЂСЏС‡РµС‚ С‚РµРєСЃС‚, Р° РєРЅРѕРїРєР° СЃС‚РѕР№РєРё РїРѕ-РїСЂРµР¶РЅРµРјСѓ
   * РµРґРёРЅСЃС‚РІРµРЅРЅРѕ РґРѕСЃС‚СѓРїРЅР°, Рё РёРЅРѕРµ РґРµР№СЃС‚РІРёРµ РІРЅРѕРІСЊ РѕС‚РєСЂРѕРµС‚ СЃРѕРѕР±С‰РµРЅРёРµ.
   */
  const closeStoryNote = useCallback((): void => {
    const key = storyNoteHintKey;
    setStoryNote(null);
    setStoryNoteHintKey(null);
    if (!key || !isPrologue || !prologueRunRef.current) return;
    // РџСЂРёРЅСѓР¶РґС‘РЅРЅР°СЏ РїРѕРґСЃРєР°Р·РєР° Р¶РёРІС‘С‚, РїРѕРєР° СЃС†РµРЅР° РЅРµ РѕС‚РїСѓСЃС‚РёС‚ С…РѕРґ: РµС‘ Р·Р°РєСЂС‹С‚РёРµ
    // РЅРµ СЃРЅРёРјР°РµС‚ Р·Р°РјРѕРє РґРµР№СЃС‚РІРёР№.
    if (prologueRunRef.current.hints.forcedKey === key) return;
    const next = dismissPrologueHint(prologueRunRef.current, key);
    prologueRunRef.current = next;
    const nextKey = next.hints.forcedKey ?? next.hints.queue[0] ?? null;
    if (nextKey !== prologueHintKey) setPrologueHintKey(nextKey);
  }, [isPrologue, prologueHintKey, storyNoteHintKey]);

  /**
   * РџРѕРєР°Р· РїРѕРґСЃРєР°Р·РєРё РїСЂРѕР»РѕРіР° РѕС‚РґРµР»СЊРЅС‹Рј РѕРєРЅРѕРј (0.21.21): РєР°Рє С‚РѕР»СЊРєРѕ СЃС†РµРЅР°
   * РЅР°Р·РЅР°С‡Р°РµС‚ СЂРµРїР»РёРєСѓ (`prologueHintKey`), РѕРЅР° РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ С‚РµРј Р¶Рµ РѕРєРЅРѕРј,
   * С‡С‚Рѕ РІСЃС‚СѓРїР»РµРЅРёРµ Рё РёС‚РѕРі РјРёСЃСЃРёРё. РџСЂРёРЅСѓР¶РґС‘РЅРЅР°СЏ СЃС‚РѕР№РєР° Р·Р°РєСЂС‹РІР°РµС‚СЃСЏ, РєРѕРіРґР°
   * С…РѕРґ РѕС‚РїСѓС‰РµРЅ, вЂ” С‚РµРєСЃС‚ Р±РѕР»СЊС€Рµ РЅРµ РІРёСЃРёС‚ РЅР°Рґ РєРЅРѕРїРєРѕР№.
   */
  const seenPrologueHintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPrologue || prologueCard) {
      seenPrologueHintRef.current = null;
      // Р’СЃС‚СѓРїРёС‚РµР»СЊРЅР°СЏ РєР°СЂС‚РѕС‡РєР° Р»РёР±Рѕ РёС‚РѕРі РјРёСЃСЃРёРё РѕС‚РєСЂС‹С‚С‹ вЂ” РѕРєРЅРѕ СЂРµРїР»РёРєРё
      // СѓСЃС‚СѓРїР°РµС‚ РёРј СЌРєСЂР°РЅ (0.21.21).
      if (storyNoteHintKey) {
        setStoryNote(null);
        setStoryNoteHintKey(null);
      }
      return;
    }
    if (!prologueHintKey) {
      seenPrologueHintRef.current = null;
      // РҐРѕРґ РѕС‚РїСѓС‰РµРЅ (СЃС‚РѕР№РєР° РїСЂРёРЅСЏС‚Р°) вЂ” РѕРєРЅРѕ СЂРµРїР»РёРєРё Р·Р°РєСЂС‹С‚СЊ, РµСЃР»Рё РѕРЅРѕ
      // РїРѕРєР°Р·С‹РІР°Р»Рѕ РїРѕРґСЃРєР°Р·РєСѓ, Р° РЅРµ РѕР±С‹С‡РЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ СЃС†РµРЅС‹.
      if (storyNoteHintKey) {
        setStoryNote(null);
        setStoryNoteHintKey(null);
      }
      return;
    }
    if (seenPrologueHintRef.current === prologueHintKey) return;
    seenPrologueHintRef.current = prologueHintKey;
    showPrologueHint(prologueHintKey);
  }, [isPrologue, prologueCard, prologueHintKey, storyNoteHintKey, showPrologueHint]);

  /** РЎРЅСЏС‚СЊ РїСЂРёС†РµР»РёРІР°РЅРёРµ, РјР°СЂС€СЂСѓС‚ РїСѓС‚Рё Рё СЂС‹РІРѕРє (0.20.50); Р±РѕРµС† РѕСЃС‚Р°С‘С‚СЃСЏ РІС‹Р±СЂР°РЅРЅС‹Рј. */
  const clearAim = (): void => {
    setIntent({ type: "cancel" });
  };

  // РЎРѕР±С‹С‚РёСЏ РїРѕРѕС‡РµСЂС‘РґРЅРѕРіРѕ Р±РѕСЏ РїСЂРёС…РѕРґСЏС‚ С‡РµСЂРµР· С‚СЂР°РЅСЃРїРѕСЂС‚ (0.14.0/0.15.0):
  // Р»РѕРєР°Р»СЊРЅС‹Р№ вЂ” РЅР° РѕРґРЅРѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ, СЃРµС‚РµРІРѕР№ вЂ” РІРµРґРѕРјРѕРјСѓ РѕС‚ РІРµРґСѓС‰РµРіРѕ.
  useEffect(() => {
    if (battleKind !== "pvp" && battleKind !== "pvpNet") return;
    const unlisten = session.subscribePvpEvents((events) => {
      announce(events);
      clearAim();
      playThen(events);
    });
    return unlisten;
    // РџРѕРґРїРёСЃРєР° РЅР° С‚СЂР°РЅСЃРїРѕСЂС‚ Р¶РёРІС‘С‚ РІРµСЃСЊ СЌРєСЂР°РЅ: announce/clearAim/playThen вЂ”
    // С„СѓРЅРєС†РёРё РєРѕРјРїРѕРЅРµРЅС‚Р°, С‡РёС‚Р°СЋС‰РёРµ СЃРІРµР¶РµРµ СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РµСЂРµР· Р·Р°РјС‹РєР°РЅРёРµ РєР°Р¶РґРѕРіРѕ
    // СЂРµРЅРґРµСЂР°, РЅРѕ РґРѕР±Р°РІР»СЏС‚СЊ РёС… РІ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё РЅРµР»СЊР·СЏ (РїРµСЂРµСЃРѕР·РґР°РІР°Р»РёСЃСЊ Р±С‹ РЅР°
    // РєР°Р¶РґРѕРј СЂРµРЅРґРµСЂРµ Рё СЂРІР°Р»Рё РїРѕРґРїРёСЃРєСѓ). kernel/session/battleKind СЃС‚Р°Р±РёР»СЊРЅС‹.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, battleKind, session]);

  // РџРµСЂРµРґР°С‡Р° СѓСЃС‚СЂРѕР№СЃС‚РІР° РІ РїРѕРѕС‡РµСЂС‘РґРЅРѕР№ РёРіСЂРµ: РїСЂРё СЃРјРµРЅРµ С…РѕРґР° СЌРєСЂР°РЅ Р¶РґС‘С‚
  // РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ РЅРѕРІРѕРіРѕ РёРіСЂРѕРєР°, РїСЂРµР¶РґРµ С‡РµРј РїРѕРєР°Р·Р°С‚СЊ РµРіРѕ РїР°РЅРµР»СЊ.
  const [passReady, setPassReady] = useState(false);
  useEffect(() => {
    setPassReady(false);
  }, [snapshot.turnNumber, pvpActive]);

  // РњРёСЃСЃРёСЏ РєР°РјРїР°РЅРёРё: Р·Р°РїРёСЃСЊ С‚РѕС‡РєРё РґР»СЏ С„РѕСЂРјСѓР»РёСЂРѕРІРєРё Р·Р°РґР°С‡Рё Рё С†РµР»Рё.
  const mission =
    battleKind === "campaign" && activeMissionId ? session.getCampaign().getMission(activeMissionId) : undefined;

  // Р‘РѕРµРІС‹Рµ С‚СѓС‚РѕСЂРёР°Р»С‹ РєР°РјРїР°РЅРёРё (0.20.0/0.20.1): В«РїРµСЂРІС‹Р№ Р±РѕР№В», В«РїРµСЂРІС‹Р№ Р»РµС€РёР№В»,
  // В«РїРµСЂРІР°СЏ РєРёРєРёРјРѕСЂР°В», В«РїРѕСЏРІР»РµРЅРёРµ РіРµРЅРµСЂР°Р»Р°В». РџРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ РѕРґРёРЅ СЂР°Р·, РѕС‚РєР»СЋС‡Р°СЋС‚СЃСЏ
  // РЅР°СЃС‚СЂРѕР№РєРѕР№ РїРѕРґСЃРєР°Р·РѕРє; В«РїРµСЂРІС‹Р№ Р±РѕР№В» вЂ” РјРѕРґР°Р»СЊРЅРѕР№ РєР°СЂС‚РѕС‡РєРѕР№, РѕСЃС‚Р°Р»СЊРЅС‹Рµ вЂ”
  // Р±Р°РЅРЅРµСЂР°РјРё, РЅРµ Р±Р»РѕРєРёСЂСѓСЋС‰РёРјРё РїРѕР»Рµ.
  const hintSettings = useSettingsState();
  const { campaignHintsDone } = useSessionState();
  const battleWantedHints = useMemo(
    () =>
      pendingCampaignHints({
        showHints: hintSettings.showHints,
        done: campaignHintsDone ?? [],
        onCampaignMap: false,
        lockedCount: 0,
        hasWounded: false,
        rosterTabActive: false,
        forgeTabActive: false,
        onDeployment: false,
        onBattle: battleKind === "campaign" && Boolean(mission),
        enemyTypes: mission?.enemies.map((entry) => entry.unitId) ?? [],
        onBattleWithGeneral: Boolean(mission?.generals?.length),
      }),
    [hintSettings.showHints, campaignHintsDone, battleKind, mission],
  );
  const [battleHintQueue, setBattleHintQueue] = useState<CampaignHintId[]>([]);
  useEffect(() => {
    setBattleHintQueue((previous) => {
      const next = [...previous];
      for (const id of battleWantedHints) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
    // Р РµР°РіРёСЂСѓРµРј РЅР° СЃРјРµРЅСѓ РЅР°Р±РѕСЂР° РїРѕРєР°Р·С‹РІР°РµРјС‹С… РїРѕРґСЃРєР°Р·РѕРє (РєР»СЋС‡-РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ), Р°
    // РЅРµ РЅР° РЅРѕРІС‹Р№ РјР°СЃСЃРёРІ battleWantedHints РєР°Р¶РґС‹Р№ СЂРµРЅРґРµСЂ; setBattleHintQueue вЂ”
    // СЃС‚Р°Р±РёР»СЊРЅС‹Р№ СЃРµС‚С‚РµСЂ. kernel РІ Р·Р°РІРёСЃРёРјРѕСЃС‚СЏС… РЅРµ РЅСѓР¶РµРЅ С‚РµР»Сѓ, РЅРѕ РѕСЃС‚Р°РІР»РµРЅ РєР°Рє
    // СЏРєРѕСЂСЊ РІСЂРµРјРµРЅРё Р¶РёР·РЅРё СЌРєСЂР°РЅР°.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleWantedHints.join(","), kernel]);
  const activeBattleHint = hintSettings.showHints
    ? (battleHintQueue.find((id) => !session.isCampaignHintShown(id)) ?? null)
    : null;
  const closeBattleHint = (): void => {
    if (!activeBattleHint) return;
    session.markCampaignHintShown(activeBattleHint);
    setBattleHintQueue((previous) => previous.filter((id) => id !== activeBattleHint));
  };
  const objectiveEntity = mission
    ? snapshot.entities.find((entity) =>
        mission.type === "destroy"
          ? entity.configId === mission.objectiveUnitId
          : mission.type === "rescue"
            ? entity.configId === mission.escorteeUnitId
            : false,
      )
    : undefined;

  // РЈРІРµРґРѕРјР»РµРЅРёРµ Рѕ Р·Р°РїРёСЃРё РІ РЅР°С‡Р°Р»Рµ С…РѕРґР° СЃС‚РѕСЂРѕРЅС‹ РєР°РјРїР°РЅРёРё (ui-design В§8).
  const [saveNotice, setSaveNotice] = useState(false);
  useEffect(() => {
    if (battleKind !== "campaign") return;
    setSaveNotice(true);
    const timer = window.setTimeout(() => setSaveNotice(false), 1600);
    return () => window.clearTimeout(timer);
  }, [snapshot.turnNumber, battleKind]);

  // РЎРѕСЃС‚Р°РІ РїРѕР»СЏ С‡РёС‚Р°РµС‚СЃСЏ РёР· СЃСЃС‹Р»РєРё (0.20.60): СЃСѓС‰РЅРѕСЃС‚Рё РјРµРЅСЏСЋС‚СЃСЏ РїРѕСЃР»Рµ РєР°Р¶РґРѕР№
  // РєРѕРјР°РЅРґС‹, Р° РІС‹Р±РѕСЂ РїРѕ РёС… СЃРјРµРЅРµ РѕС‚Р±РёСЂР°Р» Р±С‹ Сѓ РёРіСЂРѕРєР° Р±РѕР№С†Р°, РєРѕС‚РѕСЂС‹Рј РѕРЅ С‚РѕР»СЊРєРѕ
  // С‡С‚Рѕ РїРѕС…РѕРґРёР». РџРѕРІРѕРґ РІС‹Р±СЂР°С‚СЊ Р·Р°РЅРѕРІРѕ вЂ” СЃРјРµРЅР° С…РѕРґР°, СЃС‚РѕСЂРѕРЅС‹ РёР»Рё СѓРєР°Р·Р°РЅРёСЏ
  // РѕР±СѓС‡РµРЅРёСЏ; СЃРѕСЃС‚Р°РІ Р±РµСЂС‘С‚СЃСЏ РЅР° СЌС‚РѕС‚ РјРѕРјРµРЅС‚.
  const entitiesRef = useLatest(snapshot.entities);
  useEffect(() => {
    // РљРѕРіРѕ РІС‹Р±СЂР°С‚СЊ вЂ” СЂРµС€Р°РµС‚ battle-selection: РІ РѕР±СѓС‡РµРЅРёРё РёСЃРїРѕР»РЅРёС‚РµР»СЊ
    // СѓРєР°Р·Р°РЅРёСЏ (СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№, 0.20.13), РёРЅР°С‡Рµ РїРµСЂРІС‹Р№ СЃРІРѕР№ Р±РѕРµС†.
    const fighterId = firstFighterId(entitiesRef.current, { ...side, isTraining, trainingActorId });
    if (fighterId === null) {
      setIntent({ type: "clearSelection" });
    } else {
      setIntent({ type: "select", actorId: fighterId });
    }
  }, [snapshot.turnNumber, side, isTraining, trainingActorId, entitiesRef, setIntent]);

  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const aimed = snapshot.entities.find((entity) => entity.id === aimId);

  // Р—Р°С…РІР°С‡РµРЅРЅРѕРµ Р»РёС†Рѕ СЂСЏРґРѕРј СЃ РІС‹Р±СЂР°РЅРЅС‹Рј Р±РѕР№С†РѕРј: СЂСЏРґРѕРј СЃ РЅРёРј РґРѕСЃС‚СѓРїРЅРѕ РѕСЃРѕР±РѕРµ
  // РґРµР№СЃС‚РІРёРµ В«РѕСЃРІРѕР±РѕР¶РґРµРЅРёРµВ» (В§7.2). Р—Р°С…РІР°С‚ вЂ” РѕР±СЉРµРєС‚ РјРёСЃСЃРёРё rescue Р»РёР±Рѕ
  // РѕР±РµР·РґРІРёР¶РµРЅРЅРѕРµ Р»РёС†Рѕ (immobile, maxAp 0).
  const liberatable = useMemo(() => {
    if (!selected || selected.dead || selected.owner !== viewOwner) return null;
    const captive = snapshot.entities.find(
      (entity) =>
        !entity.dead &&
        entity.id !== selected.id &&
        isCaptive(entity, snapshot.objective) &&
        distH(selected.x, selected.y, entity.x, entity.y) <= 1,
    );
    return captive ?? null;
  }, [snapshot, selected, viewOwner]);

  const reachable = useMemo(() => {
    void battleRevision;
    if (selectedId === null || action !== null || paused || busy) return [] as ReachableCell[];
    // Р“РѕСЃС‚СЊ Р·Р°РїСЂР°С€РёРІР°РµС‚ РґРѕСЃС‚РёР¶РёРјРѕСЃС‚СЊ Сѓ РІРµРґСѓС‰РµРіРѕ; РЅР°Р±Р»СЋРґР°С‚РµР»СЊ Рё РїРѕРІС‚РѕСЂ РЅРµ
    // РІС‹С‡РёСЃР»СЏСЋС‚ РµС‘ РІРѕРІСЃРµ (РЅРµС‚ СЏРґСЂР° / РїСЂРѕСЃРјРѕС‚СЂ).
    if (isNetGuest) return session.requestNetReachable(selectedId);
    if (usesNetSnapshot || isReplay) return [] as ReachableCell[];
    return session.getBattleReachable(selectedId);
    // Р”РѕСЃС‚РёР¶РёРјРѕСЃС‚СЊ РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЃ Р±РѕРµРј: СЂРµРІРёР·РёСЏ вЂ” РЅР°РјРµСЂРµРЅРЅС‹Р№ С‚СЂРёРіРіРµСЂ
    // РїРµСЂРµСЃС‡С‘С‚Р° (С‚РµР»Рѕ С‡РёС‚Р°РµС‚ СЃРµСЂРІРёСЃ; 0.21.11). РџРѕР»РѕР¶РµРЅРёРµ/Р°Рї Р±РѕР№С†Р° Рё РЅРѕРјРµСЂ
    // С…РѕРґР° РјРµРЅСЏСЋС‚СЃСЏ РІРјРµСЃС‚Рµ СЃ СЂРµРІРёР·РёРµР№, РѕС‚РґРµР»СЊРЅС‹Рµ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё РЅРµ РЅСѓР¶РЅС‹.
  }, [battleRevision, selectedId, action, paused, busy, isNetGuest, usesNetSnapshot, isReplay, session]);

  const byReach = useMemo(() => {
    const map = new Map<string, ReachableCell>();
    for (const cell of reachable) map.set(cellKey(cell.x, cell.y), cell);
    return map;
  }, [reachable]);

  // РџРѕРґСЃРІРµС‚РєР° СЃС‚СЂРѕРіРѕРіРѕ СѓРєР°Р·Р°РЅРёСЏ (0.20.13): РјР°СЂРєРµСЂ РЅР° РїРѕР»Рµ Р±РµСЂС‘С‚СЃСЏ РёР· СЃР°РјРѕРіРѕ
  // СѓРєР°Р·Р°РЅРёСЏ (С‡РёСЃС‚Р°СЏ Р»РѕРіРёРєР° РІ training-scenario.ts, РїРѕРєСЂС‹С‚Р° С‚РµСЃС‚Р°РјРё), Р°
  // РїСЂРѕС‡РёРµ СЌР»РµРјРµРЅС‚С‹ РїРѕР»СЏ Рё РїР°РЅРµР»РµР№ РїСЂРёРіР»СѓС€Р°СЋС‚СЃСЏ (ui-design В§4.5).
  const trainingHighlight = directiveView?.highlight ?? null;
  const trainingFocus = isTraining && directiveView !== null;

  // РљР»СЋС‡ РїРѕРґСЃРІРµС‡РёРІР°РµРјРѕРіРѕ СЌР»РµРјРµРЅС‚Р° РїР°РЅРµР»Рё/РєРЅРѕРїРєРё (ui-design В§4.5):
  // "ap" | "weapon" | "skill" | "defend" | "overwatch" | "end_turn".
  // РџСѓР»СЊСЃР°С†РёСЏ РїР°РЅРµР»Рё: СѓРєР°Р·Р°РЅРёРµ РѕР±СѓС‡РµРЅРёСЏ Р»РёР±Рѕ РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅР°СЏ СЃС‚РѕР№РєР° Рњ2
  // (0.20.45) вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅРѕРµ РјРµСЃС‚Рѕ РїСЂРѕР»РѕРіР°, РіРґРµ РёРЅС‚РµСЂС„РµР№СЃ СЃР°Рј РЅР°Р·С‹РІР°РµС‚
  // РµРґРёРЅСЃС‚РІРµРЅРЅРѕ РІРѕР·РјРѕР¶РЅРѕРµ РґРµР№СЃС‚РІРёРµ.
  const hintPanelKey = directiveView?.panelKey ?? (prologueStanceLock ? "defend" : null);

  const previewPath = useMemo(() => {
    void battleRevision;
    if (!preview || selectedId === null) return [] as CellPos[];
    // Р“РѕСЃС‚СЊ Рё РЅР°Р±Р»СЋРґР°С‚РµР»СЊ РЅРµ РёСЃРїРѕР»РЅСЏСЋС‚ РїСЂР°РІРёР»Р°: РјР°СЂС€СЂСѓС‚ РёРј РЅРµ РІС‹С‡РёСЃР»СЏРµС‚СЃСЏ
    // (РёРЅР°С‡Рµ requireTacticsHost Р±СЂРѕСЃРёС‚ РёСЃРєР»СЋС‡РµРЅРёРµ).
    if (usesNetSnapshot) return [] as CellPos[];
    const [xs, ys] = preview.split(",");
    const path = session.getBattlePath(selectedId, { x: Number(xs), y: Number(ys), z: 0 });
    return path?.path ?? [];
    // РњР°СЂС€СЂСѓС‚ Р·Р°РІРёСЃРёС‚ РѕС‚ РїРѕР»РѕР¶РµРЅРёСЏ Р±РѕР№С†Р°, РєРѕС‚РѕСЂРѕРµ РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЃ Р±РѕРµРј вЂ”
    // СЂРµРІРёР·РёСЏ СЃР»СѓР¶РёС‚ С‚СЂРёРіРіРµСЂРѕРј РїРµСЂРµСЃС‡С‘С‚Р° (0.21.11).
  }, [battleRevision, preview, selectedId, usesNetSnapshot, session]);

  const hit: HitPreview | null = useMemo(() => {
    void battleRevision;
    if (selectedId === null || !action) return null;
    if (action.type === "weapon") {
      if (aimId === null) return null;
      if (isNetGuest) return session.requestNetHitPreview(selectedId, aimId, action.id);
      if (usesNetSnapshot || isReplay) return null;
      return session.getBattleHitPreview(selectedId, aimId, action.id);
    }
    if (aimId === null && !skillTargetPos) return null;
    // РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ СѓРјРµРЅРёР№ Сѓ РіРѕСЃС‚СЏ/РЅР°Р±Р»СЋРґР°С‚РµР»СЏ РЅРµ РІС‹С‡РёСЃР»СЏРµС‚СЃСЏ (РЅРµС‚ СЏРґСЂР°).
    if (usesNetSnapshot) return null;
    const result = session.getBattleSkillPreview(
      selectedId,
      action.id,
      aimId ?? undefined,
      skillTargetPos ?? undefined,
    );
    return {
      available: result.available,
      reason: result.reason,
      chance: result.chance,
      dmgMin: result.dmgMin,
      dmgMax: result.dmgMax,
      cover: result.cover,
      heightMod: result.heightMod,
      flanked: result.flanked,
      areaCells: result.areaCells,
    };
    // РЎРѕСЃС‚РѕСЏРЅРёРµ РёСЃРїРѕР»РЅРёС‚РµР»СЏ Рё С†РµР»Рё РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЃ Р±РѕРµРј вЂ” СЂРµРІРёР·РёСЏ СЃР»СѓР¶РёС‚
    // С‚СЂРёРіРіРµСЂРѕРј РїРµСЂРµСЃС‡С‘С‚Р° РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂР° (0.21.11); РєРѕРѕСЂРґРёРЅР°С‚С‹ РЅР°РІРµРґРµРЅРёСЏ
    // (aimId/skillTargetPos) РѕСЃС‚Р°СЋС‚СЃСЏ СЏРІРЅС‹РјРё Р·Р°РІРёСЃРёРјРѕСЃС‚СЏРјРё.
  }, [battleRevision, selectedId, aimId, skillTargetPos, action, isNetGuest, usesNetSnapshot, isReplay, session]);

  const announce = (events: GameEvent[]): void => {
    const combat = events.find((event) => event.type === "COMBAT_RESOLVED");
    if (combat && combat.type === "COMBAT_RESOLVED") {
      if (combat.result === "MISS") setLog(t("combat.miss"));
      else if (combat.result === "CRIT") setLog(t("combat.crit", { dmg: combat.damageDealt }));
      else setLog(t("combat.hit", { dmg: combat.damageDealt }));
    }
    if (events.some((event) => event.type === "ENTITY_DIED")) setLog(t("combat.died"));
  };

  const finishFromEvents = (events: GameEvent[]): void => {
    const ended = events.find((event) => event.type === "MATCH_ENDED");
    if (!ended || ended.type !== "MATCH_ENDED") return;
    // РџРѕРІС‚РѕСЂ: РїР°СЂС‚РёСЏ РЅРµ В«Р·Р°РІРµСЂС€Р°РµС‚СЃСЏВ»; РѕР±СѓС‡РµРЅРёРµ Р·Р°РІРµСЂС€Р°РµС‚ СЌРєСЂР°РЅ РѕС‚РґРµР»СЊРЅС‹Рј СЌС„С„РµРєС‚РѕРј.
    if (isReplay || isTraining || isPrologue) return;
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      const winner =
        ended.winnerPlayerId === String(PLAYER_OWNER) ? 1 : ended.winnerPlayerId === String(ENEMY_OWNER) ? 2 : null;
      if (winner) outcomeGate.report(() => session.finishPvpMatch(winner));
      return;
    }
    const outcome = ended.winnerPlayerId === String(PLAYER_OWNER) ? "victory" : "defeat";
    if (battleKind === "campaign") {
      // РСЃС…РѕРґС‹ Р±РѕР№С†РѕРІ РІС‹СЃР°РґРєРё: СЃРѕРїРѕСЃС‚Р°РІР»РµРЅРёРµ РїРѕ СЏРІРЅРѕР№ РјРµС‚РєРµ rosterIndex,
      // Р° РЅРµ РїРѕ РїРѕСЂСЏРґРєСѓ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂРѕРІ. РњРµС‚РєР° РЅРµ Р·Р°РІРёСЃРёС‚ РѕС‚ РїСЂРёР·С‹РІРѕРІ,
      // РёР»Р»СЋР·РёР№ Рё СѓРґР°Р»С‘РЅРЅС‹С… СЃ РїРѕР»СЏ СЃСѓС‰РЅРѕСЃС‚РµР№.
      // РџРѕР»РЅС‹Р№ СЃРЅРёРјРѕРє РІРµРґСѓС‰РµРіРѕ: РіРёР±РµР»СЊ РіРµРЅРµСЂР°Р»Р° С„РёРєСЃРёСЂСѓРµС‚СЃСЏ РґР°Р¶Рµ РІРЅРµ РѕР±Р·РѕСЂР°
      // СЃС‚РѕСЂРѕРЅС‹ РёРіСЂРѕРєР° (СЃРѕРєСЂР°С‰С‘РЅРЅС‹Р№ СЃРЅРёРјРѕРє РЅРµ СЃРѕРґРµСЂР¶РёС‚ С‡СѓР¶РёС… СЃСѓС‰РЅРѕСЃС‚РµР№ РІРЅРµ
      // РїРѕР»СЏ Р·СЂРµРЅРёСЏ вЂ” РёРЅР°С‡Рµ РѕРєРѕРЅС‡Р°С‚РµР»СЊРЅР°СЏ РіРёР±РµР»СЊ РЅРµ Р±С‹Р»Р° Р±С‹ СѓС‡С‚РµРЅР°).
      const full = session.getBattleFullSnapshot();
      const final = session.getBattleSnapshot(PLAYER_OWNER);
      const generalDeaths = (mission?.generals ?? []).filter((generalId) => {
        // Р“РµРЅРµСЂР°Р»С‹ СЃРїР°РІРЅСЏС‚СЃСЏ СЏРґСЂРѕРј СЃ id в‰Ґ 500 (match.ts): РіРёР±РµР»СЊ СЂСЏРґРѕРІРѕРіРѕ
        // СЃ С‚РµРј Р¶Рµ configId РЅРµ Р·Р°СЃС‡РёС‚С‹РІР°РµС‚СЃСЏ РіРµРЅРµСЂР°Р»Сѓ.
        const general = full?.entities.find(
          (entity) => entity.configId === generalId && entity.owner === ENEMY_OWNER && entity.id >= 500,
        );
        return general?.dead === true;
      });
      const participants = deployment.map((fighterId, index) => {
        const entity = final.entities.find(
          (candidate) =>
            candidate.owner === PLAYER_OWNER && candidate.coverType === 0 && candidate.rosterIndex === index,
        );
        if (entity) return { fighterId, survived: !entity.dead, hp: entity.hp };
        // Р­РІР°РєСѓРёСЂРѕРІР°РЅРЅС‹Р№ Р±РѕРµС† (СЂР°Р·РІРµРґРєР°) РІС‹Р¶РёР»: Р·РґРѕСЂРѕРІСЊРµ РЅР° РјРѕРјРµРЅС‚ СѓС…РѕРґР°
        // Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРѕ СЏРґСЂРѕРј РІ СЃРѕСЃС‚РѕСЏРЅРёРё Р±РѕСЏ (0.13.0).
        const extracted = (final.extracted ?? []).find((entry) => entry.rosterIndex === index);
        if (extracted) return { fighterId, survived: true, hp: extracted.hp };
        return { fighterId, survived: false, hp: 0 };
      });
      outcomeGate.report(() => session.finishCampaignMission(outcome, participants, generalDeaths));
      return;
    }
    outcomeGate.report(() => session.finishMatch(outcome));
  };

  const playThen = (events: GameEvent[], after?: () => void): void => {
    setBusy(true);
    // РџРѕРєР° СЃРѕР±С‹С‚РёСЏ РёРіСЂР°СЋС‚, РёС‚РѕРі РЅРµ РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ (0.20.39): РїР°СѓР·Р°
    // РѕС‚СЃС‡РёС‚С‹РІР°РµС‚СЃСЏ РѕС‚ РєРѕРЅС†Р° РїСЂРѕРёРіСЂС‹РІР°РЅРёСЏ, Р° РЅРµ РѕС‚ РјРѕРјРµРЅС‚Р° РєРѕРјР°РЅРґС‹.
    outcomeGate.playbackStart();
    void (rendererRef.current?.play(events) ?? Promise.resolve()).finally(() => {
      setBusy(false);
      outcomeGate.playbackEnd();
      finishFromEvents(events);
      after?.();
    });
  };

  /**
   * РџРѕРґСЃРІРµС‚РєР° РєРЅРѕРїРєРё РґРµР№СЃС‚РІРёСЏ (0.20.40): РїРѕРєР° Р¶РёРІ РїСЂРѕС‚РёРІРЅРёРє, РЅР°Р·РІР°РЅРЅС‹Р№
   * РјРёСЃСЃРёРµР№ (`actionAccent.whileAlive`), РєРЅРѕРїРєР° РµРіРѕ РѕСЂСѓР¶РёСЏ РїСѓР»СЊСЃРёСЂСѓРµС‚
   * СЏРЅС‚Р°СЂРЅС‹Рј. РЎС†РµРЅР° РїРѕРєР°Р·С‹РІР°РµС‚, С‡С‚Рѕ РґРµР»Р°С‚СЊ РґР°Р»СЊС€Рµ, РЅРµ РѕР±СЉСЏСЃРЅСЏСЏ СЃР»РѕРІР°РјРё:
   * РІ Рњ1 РґСѓР±РёРЅР° СЃРІРµС‚РёС‚СЃСЏ, РїРѕРєР° РєСЂС‹СЃР° РЅРµ СѓРЅРёС‡С‚РѕР¶РµРЅР°.
   */
  const accentWeaponId = ((): string | null => {
    const accent = prologueMission?.actionAccent;
    if (!accent) return null;
    // Р‘РµР· `whileAlive` РїРѕРґСЃРІРµС‚РєР° Р¶РёРІС‘С‚ РґРѕ РєРѕРЅС†Р° РјРёСЃСЃРёРё.
    if (!accent.whileAlive) return accent.weaponId;
    return snapshot.entities.some((entity) => entity.configId === accent.whileAlive && !entity.dead)
      ? accent.weaponId
      : null;
  })();

  /* ---------- СЂРµР¶РёСЃСЃСѓСЂР° РєР°РјРµСЂС‹ (0.20.37, campaign.md В§13.4) ---------- */

  /**
   * РџСЂРѕРёРіСЂР°С‚СЊ СЃС†РµРЅСѓ РјРёСЃСЃРёРё, РµСЃР»Рё РґР»СЏ СЌС‚РѕРіРѕ СЃРѕР±С‹С‚РёСЏ РѕРЅР° РѕРїРёСЃР°РЅР° РІ РґР°РЅРЅС‹С….
   *
   * РЁР°Рі `handOff` РґРµР»РёС‚ СЃС†РµРЅСѓ РЅР°РґРІРѕРµ (0.20.40): РјРµР¶РґСѓ С‡Р°СЃС‚СЏРјРё С…РѕРґ
   * РїРµСЂРµРґР°С‘С‚СЃСЏ СЃРѕРїРµСЂРЅРёРєСѓ, Рё РµРіРѕ РґРµР№СЃС‚РІРёРµ СЂР°Р·С‹РіСЂС‹РІР°РµС‚СЃСЏ РѕР±С‹С‡РЅС‹РјРё СЃРѕР±С‹С‚РёСЏРјРё
   * Р±РѕСЏ вЂ” РєСЂС‹СЃР° Рњ1 РєСѓСЃР°РµС‚ РњРёРєСѓР»Сѓ СЃСЂР°Р·Сѓ РїРѕСЃР»Рµ РІР±РµРіР°РЅРёСЏ, Р° РЅРµ РєРѕРіРґР° РёРіСЂРѕРє
   * РґРѕРіР°РґР°РµС‚СЃСЏ РЅР°Р¶Р°С‚СЊ В«РљРѕРЅРµС† С…РѕРґР°В».
   */
  /** РћС‚Р»Р°РґРѕС‡РЅР°СЏ Р°РІС‚РѕРїРѕР±РµРґР°: РјРіРЅРѕРІРµРЅРЅРѕ СѓРЅРёС‡С‚РѕР¶Р°РµС‚ РІСЃРµС… РїСЂРѕС‚РёРІРЅРёРєРѕРІ Рё РѕС‚РєСЂС‹РІР°РµС‚ РёС‚РѕРі РїРѕР±РµРґС‹.
   *  Р”РѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ РІ РѕС‚Р»Р°РґРѕС‡РЅРѕРј СЂРµР¶РёРјРµ (?debug=1) Рё РЅРµ РґРµР№СЃС‚РІСѓРµС‚ РІ РїРѕРІС‚РѕСЂРµ (0.20.1).
   *  Р’ РѕР±СѓС‡РµРЅРёРё РїРѕР±РµРґР° РѕРїСЂРµРґРµР»СЏРµС‚СЃСЏ С€Р°РіР°РјРё РїРѕРґСЃРєР°Р·РєРё вЂ” Р°РІС‚РѕРїРѕР±РµРґР° РґРѕРІРµСЂС€Р°РµС‚
   *  Рё РёС…, С‡С‚РѕР±С‹ РёС‚РѕРі РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ РѕС‚РєСЂС‹Р»СЃСЏ (0.20.2). */
  const debugAutoWin = (): void => {
    if (paused || busy || isReplay || !debug) return;
    const result = session.debugAutoWinBattle();
    if (!result.ok) return;
    if (isTraining) setHintStep(trainingHints.length);
    setIntent({ type: "cancel" });
    playThen(result.events);
  };

  /**
   * Р•РґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РєР°РЅР°Р» РєРѕРјР°РЅРґ: РїРѕРѕС‡РµСЂС‘РґРЅР°СЏ РёРіСЂР° вЂ” С‡РµСЂРµР· С‚СЂР°РЅСЃРїРѕСЂС‚
   * (0.14.0/0.15.0). `after` РІС‹Р·С‹РІР°РµС‚СЃСЏ, РєРѕРіРґР° СЃРѕР±С‹С‚РёСЏ РєРѕРјР°РЅРґС‹ СѓР¶Рµ
   * РѕС‚С‹РіСЂР°РЅС‹ РїРѕР»РµРј: СЂС‹РІРѕРє Рє С†РµР»Рё РёСЃРїРѕР»РЅСЏРµС‚ СѓРґР°СЂ РёРјРµРЅРЅРѕ С‚Р°Рє (0.20.50).
   */
  /**
   * Р•РґРёРЅС‹Р№ РєР°РЅР°Р» РєРѕРјР°РЅРґ (0.20.64): РјР°СЂС€СЂСѓС‚ вЂ” РєСѓРґР° СѓС…РѕРґРёС‚ РєРѕРјР°РЅРґР° Рё РїСЂРѕРїСѓСЃРєР°СЋС‚
   * Р»Рё РµС‘ СЃС†РµРЅР°СЂРёРё вЂ” СЂРµС€Р°РµС‚ battle-command, Р·РґРµСЃСЊ РёСЃРїРѕР»РЅРµРЅРёРµ Рё РїРѕСЃР»РµРґСЃС‚РІРёСЏ.
   */
  const applyCommand = (command: Command, after?: () => void): void => {
    const route = routeCommand(command, {
      isSpectator,
      isReplay,
      outcomePending,
      isPvp: battleKind === "pvp",
      isNetGuest,
      isTraining,
      trainingAllows: (issued) => trainingCommandAllowed(directiveView, issued),
      trainingDenial: trainingActionKindOfCommand,
      isPrologue,
      // РЎС†РµРЅР° Рњ2 РѕР±СЂС‹РІР°РµС‚ СЂС‹РІРѕРє РЅР° РїРѕР»РїСѓС‚Рё (0.20.45): РїРѕРєР° Р·Р°СЃР°РґР° РІРїРµСЂРµРґРё,
      // РіРµСЂРѕСЋ РѕСЃС‚Р°РІР»СЏСЋС‚ РѕРґРЅРѕ РћР” РЅР° Р·Р°С‰РёС‚РЅСѓСЋ СЃС‚РѕР№РєСѓ.
      clampPrologue:
        isPrologue && kernel && prologueRunRef.current
          ? (issued) => clampPrologueCommand(kernel, prologueRunRef.current!, issued, prologueMission?.playerSlots)
          : null,
      prologueAllows:
        isPrologue && prologueRunRef.current ? (issued) => gatePrologueCommand(prologueRunRef.current!, issued) : null,
    });
    switch (route.kind) {
      case "drop":
        return;
      case "sendPvp":
        session.sendPvpCommand(command);
        return;
      case "sendNet":
        session.sendNetCommand(command);
        return;
      case "denyTraining":
        trainingDeny(route.action);
        return;
      case "denyPrologue":
        // РРЅРѕРµ РґРµР№СЃС‚РІРёРµ, РєСЂРѕРјРµ СЃС‚РѕР№РєРё, РІРЅРѕРІСЊ РѕС‚РєСЂС‹РІР°РµС‚ СЂРµРїР»РёРєСѓ Р·Р°СЃР°РґС‹
        // (0.21.21): СЃРѕРѕР±С‰РµРЅРёРµ РѕСЃС‚Р°С‘С‚СЃСЏ РґРѕСЃС‚СѓРїРЅС‹Рј, РїРѕРєР° РёРіСЂРѕРє РЅРµ РїСЂРёРјРµС‚
        // СЃС‚РѕР№РєСѓ РїРѕ СѓСЃР»РѕРІРёСЋ СЃС†РµРЅС‹.
        showPrologueHint(currentPrologueHintKey() ?? "m2.noise");
        return;
      case "apply":
        break;
    }
    const issued = route.command;
    const result = session.applyBattleCommand(issued);
    if (!result.ok) {
      // РћС‚РєР»РѕРЅС‘РЅРЅР°СЏ РєРѕРјР°РЅРґР° РѕР±СЉСЏСЃРЅСЏРµС‚СЃСЏ РёРіСЂРѕРєСѓ (0.20.2): РІ РѕР±СѓС‡РµРЅРёРё С€Р°РіРё
      // РѕРіСЂР°РЅРёС‡РµРЅС‹, Рё Р±РµР· РѕС‚РєР»РёРєР° РЅРµСЏСЃРЅРѕ, РїРѕС‡РµРјСѓ РґРµР№СЃС‚РІРёРµ РЅРµ СЃСЂР°Р±РѕС‚Р°Р»Рѕ.
      // РљР»СЋС‡ `battle.reject.<РїСЂРёС‡РёРЅР°>`; РЅРµРёР·РІРµСЃС‚РЅР°СЏ РїСЂРёС‡РёРЅР° вЂ” РѕР±С‰РёР№ С‚РµРєСЃС‚.
      const key = `battle.reject.${result.reason}`;
      setLog(t(key) === key ? t("battle.reject.generic") : t(key));
      return;
    }
    announce(result.events);
    let prologueAfter: (() => void) | null = null;
    // РС‚РѕРі РјРёСЃСЃРёРё: РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РїРѕСЃР»Рµ Р°РЅРёРјР°С†РёР№ Рё РїР°СѓР·С‹ (0.20.39).
    let prologueFinished = false;
    if (isPrologue && kernel && prologueMission && prologueRunRef.current) {
      const ctx = buildPrologueContext(prologueMission, content, hintSettings.showHints);
      const next = afterPrologueApply(kernel, issued, result.events, prologueRunRef.current, ctx);
      // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅР°СЏ СЃС‚РѕР№РєР° (0.20.45): РїСѓР»СЊСЃР°С†РёСЏ РєРЅРѕРїРєРё Рё Р·Р°РєСЂС‹С‚С‹Рµ
      // РїСЂРѕС‡РёРµ РґРµР№СЃС‚РІРёСЏ Р¶РёРІСѓС‚ СЂРѕРІРЅРѕ РґРѕ РєРѕРјР°РЅРґС‹ В«DEFENDВ».
      setPrologueStanceLock(next.forceDefend);
      // Р§С‚Рѕ РґРµР»Р°С‚СЊ СЃ РёС‚РѕРіР°РјРё РєРѕРјР°РЅРґС‹ вЂ” СЂРµС€Р°РµС‚ battle-command: РѕС‚РєР°С‚ Рє
      // РєРѕРЅС‚СЂРѕР»СЊРЅРѕР№ С‚РѕС‡РєРµ, С‡РµСЃС‚РЅРѕРµ РїРѕСЂР°Р¶РµРЅРёРµ РёР»Рё РІС‹С…РѕРґ СЃС‚Р°Рё СЃС†РµРЅРѕР№.
      const aftermath = prologueAftermath({
        next,
        events: result.events,
        snapshot: kernel.getSnapshot(),
        hasCheckpoint: session.hasBattleCheckpoint(),
      });
      prologueRunRef.current = aftermath.state;
      // РљРѕРЅС‚СЂРѕР»СЊРЅР°СЏ С‚РѕС‡РєР° РјРёСЃСЃРёРё: РІС…РѕРґ РІ РјРёСЃСЃРёСЋ СѓР¶Рµ РµСЋ РѕР±РµСЃРїРµС‡РµРЅ, РґР°Р»СЊС€Рµ вЂ”
      // РєР»СЋС‡РµРІС‹Рµ СЃСЋР¶РµС‚РЅС‹Рµ РІРµС…Рё, РІРєР»СЋС‡Р°СЏ РІС‹С…РѕРґ РєСЂС‹СЃС‹ РІ Рњ1. Р’РјРµСЃС‚Рµ СЃРѕ СЃРЅРёРјРєРѕРј
      // СЏРґСЂР° СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ Рё СЃРѕСЃС‚РѕСЏРЅРёРµ СЃС†РµРЅС‹ вЂ” РѕС‚РєР°С‚ РІРѕР·РІСЂР°С‰Р°РµС‚ РјРёСЃСЃРёСЋ С†РµР»РёРєРѕРј.
      const armed = next.fedotFreed || next.firstWave || next.vasilisaJoined || next.ratSpawned;
      if (armed && !session.hasBattleCheckpoint()) {
        session.saveBattleCheckpoint(aftermath.state);
      }
      switch (aftermath.kind) {
        case "restore":
          prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
            type: "death_by",
            cause: "checkpoint",
          });
          prologueAfter = () => void director.restoreScene();
          break;
        case "defeat":
          prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
            type: "death_by",
            cause: "checkpoint",
          });
          prologueFinished = true;
          break;
        case "spawnBeats":
          // РЎСѓС‰РЅРѕСЃС‚СЊ СѓР¶Рµ СЃРѕР·РґР°РЅР° СЏРґСЂРѕРј, РЅРѕ РЅР° РїРѕР»Рµ РµС‘ РЅРµ РїРѕРєР°Р·С‹РІР°РµРј РґРѕ
          // РІР±РµРіР°РЅРёСЏ РїРѕ СЃС†РµРЅРµ (0.20.39): РёРЅР°С‡Рµ РѕРЅР° РІРѕР·РЅРёРєР°РµС‚ РІ РєР»РµС‚РєРµ,
          // РїСЂРѕРїР°РґР°РµС‚ Рё РІС‹Р±РµРіР°РµС‚ Р·Р°РЅРѕРІРѕ.
          director.hideSpawns(aftermath.events);
          // РЎРЅР°С‡Р°Р»Р° СЃС‚Р°СЏ РІС‹Р±РµРіР°РµС‚, РїРѕС‚РѕРј Р·Р°РіРѕСЂР°РµС‚СЃСЏ РІС‹С…РѕРґ (0.20.45).
          prologueAfter = () => void director.runSpawnBeats(aftermath.events).then(() => director.revealExtractBeat());
          break;
        case "none":
          break;
      }
      const hint = next.hints.forcedKey ?? next.hints.queue[0] ?? null;
      if (hint && hint !== prologueHintKey) {
        prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, { type: "hint_shown", key: hint });
      }
      setPrologueHintKey(hint);
      setPrologueObjectiveKey(next.objectiveKey);
      if (next.outcome !== "ongoing") prologueFinished = true;
    }
    // РџРѕРґСЃРєР°Р·РєР° РѕР±СѓС‡РµРЅРёСЏ РїСЂРѕРґРІРёРіР°РµС‚СЃСЏ СЃРѕР±С‹С‚РёСЏРјРё РґРµР№СЃС‚РІРёСЏ СЃР°РјРѕРіРѕ РёРіСЂРѕРєР° (0.19.1);
    // СЂРµР°РєС‚РёРІРЅС‹Рµ РїР»Р°С€РєРё (СЏРґ, РІРѕСЃРєСЂРµС€РµРЅРёРµ, РїСЂРёР·С‹РІ) РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ Р»СЋР±С‹РјРё СЃРѕР±С‹С‚РёСЏРјРё (0.20.1).
    advanceTraining(result.events);
    showTrainingNote(result.events);
    clearAim();
    // Р С‹РІРѕРє: СѓРґР°СЂ РїРѕРґР°С‘С‚СЃСЏ РїРѕСЃР»Рµ С‚РѕРіРѕ, РєР°Рє Р±РѕРµС† РґРѕС€С‘Р» (0.20.50).
    playThen(
      result.events,
      after || prologueAfter
        ? () => {
            prologueAfter?.();
            after?.();
          }
        : undefined,
    );
    // РџРѕСЃР»Рµ playThen: РїСЂРѕРёРіСЂС‹РІР°РЅРёРµ СѓР¶Рµ РЅР°С‡Р°Р»РѕСЃСЊ, Рё РіРµР№С‚ РІС‹РґРµСЂР¶РёС‚ РїР°СѓР·Сѓ
    // РѕС‚ РµРіРѕ РєРѕРЅС†Р°, Р° РЅРµ РѕС‚ РјРѕРјРµРЅС‚Р° РєРѕРјР°РЅРґС‹.
    if (prologueFinished) outcomeGate.report(() => setPrologueCard("outro"));
  };

  const tryMove = (to: CellPos): void => {
    if (selectedId === null || paused || busy || outcomePending) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // РћР±СѓС‡РµРЅРёРµ: РїРµСЂРµРјРµС‰РµРЅРёРµ РґРѕРїСѓСЃС‚РёРјРѕ С‚РѕР»СЊРєРѕ РІ РїРѕРґСЃРІРµС‡РµРЅРЅСѓСЋ РєР»РµС‚РєСѓ С‚РµРєСѓС‰РµРіРѕ
    // СѓРєР°Р·Р°РЅРёСЏ Рё С‚РѕР»СЊРєРѕ РїСЂРµРґРїРёСЃР°РЅРЅС‹Рј РёСЃРїРѕР»РЅРёС‚РµР»РµРј (СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№, 0.20.13).
    if (isTraining) {
      const directive = trainingDirective;
      if (
        !directive ||
        directive.kind !== "move" ||
        directive.actorId !== selectedId ||
        directive.cell.x !== to.x ||
        directive.cell.y !== to.y
      ) {
        trainingDeny("move");
        return;
      }
    }
    applyCommand({ type: "MOVE", actorId: selectedId, to });
  };

  const tryAttack = (targetId: number): void => {
    if (selectedId === null || !action || paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // РћР±СѓС‡РµРЅРёРµ: С‚РѕР»СЊРєРѕ РїСЂРµРґРїРёСЃР°РЅРЅРѕРµ РѕСЂСѓР¶РёРµ/СѓРјРµРЅРёРµ, РёСЃРїРѕР»РЅРёС‚РµР»СЊ Рё С†РµР»СЊ
    // (СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№, 0.20.13). tryAttack РѕР±СЃР»СѓР¶РёРІР°РµС‚ Рё РѕСЂСѓР¶РµР№РЅСѓСЋ Р°С‚Р°РєСѓ,
    // Рё СѓРјРµРЅРёРµ РїРѕ СЃСѓС‰РЅРѕСЃС‚Рё.
    if (isTraining) {
      const directive = trainingDirective;
      const isWeapon = action.type === "weapon";
      const allowed =
        directive !== null &&
        ((isWeapon &&
          directive.kind === "attack" &&
          directive.actorId === selectedId &&
          directive.weaponId === action.id &&
          directive.targetId === targetId) ||
          (!isWeapon &&
            directive.kind === "skill" &&
            directive.actorId === selectedId &&
            directive.skillId === action.id &&
            directive.targetId === targetId));
      if (!allowed) {
        trainingDeny(isWeapon ? "attack" : "skill");
        return;
      }
    }
    const command: Command =
      action.type === "weapon"
        ? { type: "ATTACK", actorId: selectedId, targetId, weaponId: action.id }
        : {
            type: "USE_SKILL",
            actorId: selectedId,
            targetId,
            targetPos: skillTargetPos ?? undefined,
            skillId: action.id,
          };
    applyCommand(command);
  };

  /**
   * РџР»Р°РЅ СЂС‹РІРєР° Рє С†РµР»Рё (0.20.50): `null`, РµСЃР»Рё РїРѕРґРѕР№С‚Рё РЅРµС‡РµРј РёР»Рё СЂРµР¶РёРј
   * РЅРµ РїРѕР·РІРѕР»СЏРµС‚ СЃРѕРµРґРёРЅРёС‚СЊ РґРІРµ РєРѕРјР°РЅРґС‹ РІ РѕРґРёРЅ Р·Р°РјС‹СЃРµР». Р’ РїРѕРѕС‡РµСЂС‘РґРЅРѕР№ Рё
   * СЃРµС‚РµРІРѕР№ РёРіСЂРµ РєРѕРјР°РЅРґС‹ СѓС…РѕРґСЏС‚ С‚СЂР°РЅСЃРїРѕСЂС‚РѕРј, РґРѕР¶РґР°С‚СЊСЃСЏ РїРѕРґС…РѕРґР° Р·РґРµСЃСЊ
   * РЅРµР»СЊР·СЏ; РІ РѕР±СѓС‡РµРЅРёРё С€Р°РіРё РїСЂРµРґРїРёСЃР°РЅС‹ СЃС†РµРЅР°СЂРёРµРј.
   */
  const chargeFor = (target: EntityState): ChargePlan | null => {
    if (isTraining || isReplay || isSpectator || usesNetSnapshot) return null;
    if (!kernel || selectedId === null) return null;
    const actor = snapshot.entities.find((entity) => entity.id === selectedId);
    const strike = meleeStrikeOf(action, weapons, skills);
    if (!actor || !strike || actor.dead) return null;
    return planCharge({
      snapshot,
      actor,
      target,
      strike,
      reachable: session.getBattleReachable(actor.id),
      pathOf: (cell) => session.getBattlePath(actor.id, cell),
    });
  };

  /**
   * Р С‹РІРѕРє Рє С†РµР»Рё: РїРѕРґС…РѕРґ Рё СѓРґР°СЂ РѕРґРЅРёРј Р·Р°РјС‹СЃР»РѕРј (0.20.50).
   *
   * РџРѕРґС…РѕРґ РёСЃРїРѕР»РЅСЏРµС‚СЃСЏ РѕР±С‹С‡РЅРѕР№ РєРѕРјР°РЅРґРѕР№ РїРµСЂРµРјРµС‰РµРЅРёСЏ, СѓРґР°СЂ вЂ” РѕР±С‹С‡РЅРѕР№
   * РєРѕРјР°РЅРґРѕР№ Р°С‚Р°РєРё СѓР¶Рµ РїРѕСЃР»Рµ С‚РѕРіРѕ, РєР°Рє Р±РѕРµС† РґРѕС€С‘Р». Р•СЃР»Рё Р·Р° РІСЂРµРјСЏ РїРѕРґС…РѕРґР°
   * СѓРґР°СЂ СЃС‚Р°Р» РЅРµРІРѕР·РјРѕР¶РµРЅ вЂ” РґРѕР·РѕСЂРЅС‹Р№ РІС‹СЃС‚СЂРµР», РіРёР±РµР»СЊ, РїРѕРјРµС…Р°, вЂ” РѕРЅ РЅРµ
   * РёСЃРїРѕР»РЅСЏРµС‚СЃСЏ: СЌРєСЂР°РЅ СЃРѕРѕР±С‰Р°РµС‚ РѕР± СЌС‚РѕРј, Р±РѕРµС† РѕСЃС‚Р°С‘С‚СЃСЏ РЅР° РєР»РµС‚РєРµ РїРѕРґС…РѕРґР°.
   */
  const executeCharge = (plan: ChargePlan): void => {
    if (!action || selectedId === null) return;
    const strike: MeleeStrike | null = meleeStrikeOf(action, weapons, skills);
    if (!strike) return;
    const actorId = selectedId;
    const targetId = plan.targetId;
    setIntent({ type: "cancel" });
    applyCommand({ type: "MOVE", actorId, to: plan.step, path: plan.path }, () => {
      const fresh = session.getBattleSnapshot(viewOwner);
      const actor = fresh.entities.find((entity) => entity.id === actorId);
      if (!actor || actor.dead || fresh.activeOwner !== viewOwner || actor.ap < strike.apCost) {
        setLog(t("battle.chargeBroken"));
        return;
      }
      const available =
        strike.kind === "weapon"
          ? session.getBattleHitPreview(actorId, targetId, strike.id).available
          : session.getBattleSkillPreview(actorId, strike.id, targetId).available;
      if (!available) {
        setLog(t("battle.chargeBroken"));
        return;
      }
      applyCommand(
        strike.kind === "weapon"
          ? { type: "ATTACK", actorId, targetId, weaponId: strike.id }
          : { type: "USE_SKILL", actorId, targetId, skillId: strike.id },
      );
    });
  };

  // РРјСЏ Р±РµР· РїСЂРёСЃС‚Р°РІРєРё `use`: СЌС‚Рѕ РѕР±СЂР°Р±РѕС‚С‡РёРє РЅР°Р¶Р°С‚РёСЏ, Р° РЅРµ С…СѓРє (0.20.55) вЂ”
  // РїСЂРµР¶РЅРµРµ РёРјСЏ Р»РѕРјР°Р»Рѕ РїСЂР°РІРёР»Рѕ react-hooks/rules-of-hooks.
  const applySelfSkill = (skillId: string): void => {
    if (selectedId === null || paused || busy || snapshot.activeOwner !== viewOwner) return;
    // РћР±СѓС‡РµРЅРёРµ: СЃР°РјРѕ-СѓРјРµРЅРёРµ РґРѕРїСѓСЃС‚РёРјРѕ, С‚РѕР»СЊРєРѕ РµСЃР»Рё РїСЂРµРґРїРёСЃР°РЅРѕ СѓРєР°Р·Р°РЅРёРµРј.
    if (isTraining) {
      const directive = trainingDirective;
      if (
        !directive ||
        directive.kind !== "skill" ||
        directive.actorId !== selectedId ||
        directive.skillId !== skillId ||
        directive.targetId !== undefined
      ) {
        trainingDeny("skill");
        return;
      }
    }
    applyCommand({ type: "USE_SKILL", actorId: selectedId, skillId });
  };

  // В«РћСЃРІРѕР±РѕР¶РґРµРЅРёРµВ»: РѕСЃРѕР±РѕРµ РґРµР№СЃС‚РІРёРµ СЂСЏРґРѕРј СЃ Р·Р°С…РІР°С‡РµРЅРЅС‹Рј Р»РёС†РѕРј вЂ” РѕРґРЅРѕ РћР”,
  // С…РѕРґ РЅРµ Р·Р°РІРµСЂС€Р°РµС‚. Р”РѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РёРіСЂРѕРєСѓ РІ РµРіРѕ С…РѕРґ Рё РІРЅРµ СЃС‚РѕР№РєРё (В§7.2).
  const applyLiberate = (): void => {
    if (
      selectedId === null ||
      !liberatable ||
      paused ||
      busy ||
      snapshot.activeOwner !== viewOwner ||
      prologueStanceLock
    )
      return;
    applyCommand({ type: "INTERACT", actorId: selectedId, targetId: liberatable.id });
    setIntent({ type: "cancel" });
  };

  const tryPositionSkill = (pos: CellPos): void => {
    if (selectedId === null || action?.type !== "skill" || paused || busy) return;
    // РћР±СѓС‡РµРЅРёРµ: РїРѕР·РёС†РёРѕРЅРЅРѕРµ СѓРјРµРЅРёРµ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ РІ РїРѕРґСЃРІРµС‡РµРЅРЅСѓСЋ РєР»РµС‚РєСѓ
    // СѓРєР°Р·Р°РЅРёСЏ (СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№, 0.20.13).
    if (isTraining) {
      const directive = trainingDirective;
      if (
        !directive ||
        directive.kind !== "skill" ||
        directive.actorId !== selectedId ||
        directive.skillId !== action.id ||
        directive.cell === undefined ||
        directive.cell.x !== pos.x ||
        directive.cell.y !== pos.y
      ) {
        trainingDeny("skill");
        return;
      }
    }
    const same = skillTargetPos?.x === pos.x && skillTargetPos.y === pos.y && skillTargetPos.z === pos.z;
    if (!same) {
      setIntent({ type: "positionSkill", pos });
      return;
    }
    applyCommand({
      type: "USE_SKILL",
      actorId: selectedId,
      skillId: action.id,
      targetId: aimId ?? undefined,
      targetPos: pos,
    });
  };

  const runEnemyPhase = async (): Promise<void> => {
    setEnemyPhase(true);
    // РћС‚Р»РѕР¶РµРЅРЅС‹Рµ РїРѕСЃС‚Р°РЅРѕРІРѕС‡РЅС‹Рµ РґРµР№СЃС‚РІРёСЏ: РѕС‚РєР°С‚ Рє РєРѕРЅС‚СЂРѕР»СЊРЅРѕР№ С‚РѕС‡РєРµ РёР»Рё РІС‹С…РѕРґ
    // РїСЂРѕС‚РёРІРЅРёРєР° вЂ” РёСЃРїРѕР»РЅСЏСЋС‚СЃСЏ РїРѕСЃР»Рµ РїСЂРѕРёРіСЂС‹РІР°РЅРёСЏ СЃРѕР±С‹С‚РёР№ С…РѕРґР°.
    let enemyAfter: (() => void) | null = null;
    // Р’РµСЃСЊ С…РѕРґ РќР°РІРё вЂ” РїСЂРѕРёРіСЂС‹РІР°РЅРёРµ: РёС‚РѕРі РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РїРѕСЃР»Рµ РЅРµРіРѕ (0.20.39).
    outcomeGate.playbackStart();
    try {
      // Р’ РѕР±СѓС‡РµРЅРёРё Р±РµР· РїСЂРѕС‚РёРІРЅРёРєР° (В«РџРµСЂРІС‹Рµ С€Р°РіРёВ») С…РѕРґ РќР°РІРё РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚:
      // Р·Р°РІРµСЂС€Р°РµРј РµРіРѕ СЃСЂР°Р·Сѓ, РІРѕР·РІСЂР°С‰Р°СЏ СѓРїСЂР°РІР»РµРЅРёРµ РёРіСЂРѕРєСѓ. Р’ РјРёСЃСЃРёСЏС… СЃ
      // РїСЂРѕС‚РёРІРЅРёРєРѕРј (В«Р‘РѕР№В», В«РЈРјРµРЅРёСЏ Рё СЃРѕСЃС‚РѕСЏРЅРёСЏВ») РќР°РІСЊ РґРµР№СЃС‚РІСѓРµС‚ СЃС‚СЂРѕРіРѕ РїРѕ
      // СЃС†РµРЅР°СЂРёСЋ РјРёСЃСЃРёРё (0.20.13, game-design В§3.5): РїРѕСЃС‚РѕСЏРЅРЅС‹Рµ РїСЂР°РІРёР»Р° Рё
      // Р»РёРЅРµР№РЅР°СЏ РѕС‡РµСЂРµРґСЊ РґРµР№СЃС‚РІРёР№ Р·Р°РґР°РЅС‹ РІ training.json5 (enemyScript);
      // РєРѕРіРґР° РѕС‡РµСЂРµРґСЊ РёСЃС‡РµСЂРїР°РЅР°, С…РѕРґ РґРѕСЃС‚Р°С‘С‚СЃСЏ РѕР±С‹С‡РЅРѕРјСѓ РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅРѕРјСѓ
      // Р°Р»РіРѕСЂРёС‚РјСѓ РєР°Рє РїСЂРµРґРѕС…СЂР°РЅРёС‚РµР»СЊ.
      if (isTraining && (trainingMission?.enemies.length ?? 0) === 0) {
        session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        finishFromEvents([]);
        return;
      }
      await sleep(430);
      // РЎРІРµР¶РёР№ СЃРЅРёРјРѕРє РЅР° РєР°Р¶РґРѕРј РєСЂСѓРіРµ: СЃС†РµРЅР° РёРґС‘С‚ Р°СЃРёРЅС…СЂРѕРЅРЅРѕ, СЃРѕСЃС‚РѕСЏРЅРёРµ
      // СЂРµРЅРґРµСЂР° РјРѕРіР»Рѕ СѓСЃС‚Р°СЂРµС‚СЊ.
      const phase = (): EnemyPhaseState => ({
        activeOwner: session.getBattleSnapshot(PLAYER_OWNER).activeOwner,
        enemyOwner: ENEMY_OWNER,
        outcome: battleOutcome(),
        hasKernel: Boolean(kernel),
      });
      for (let guard = 0; guard < 96; guard += 1) {
        // РЇРґСЂРѕ РЅСѓР¶РЅРѕ РЅРµ С‚РѕР»СЊРєРѕ РїСЂР°РІРёР»Сѓ С…РѕРґР° (РѕРЅРѕ РІ РїСЂРµРґРёРєР°С‚Рµ), РЅРѕ Рё С‚РёРїР°Рј:
        // РЅРёР¶Рµ РїРѕ С‚РµР»Сѓ С†РёРєР»Р° РѕРЅРѕ СѓР¶Рµ РЅРµ РїСѓСЃС‚Рѕ.
        if (!kernel) break;
        if (!enemyPhaseActive(phase())) break;
        let command: Command | null;
        if (isTraining) {
          const decision = pickScriptedEnemyCommand(kernel, trainingMission?.enemyScript, enemyScriptRef.current);
          enemyScriptRef.current = decision.state;
          command = decision.command;
        } else if (isPrologue && prologueMission && prologueRunRef.current) {
          const ctx = buildPrologueContext(prologueMission, content, hintSettings.showHints);
          const decision = tickPrologueEnemyTurn(kernel, prologueRunRef.current, ctx);
          prologueRunRef.current = decision.state;
          command = decision.command;
        } else {
          command = pickEnemyCommand(kernel);
        }
        const applied = command
          ? session.applyBattleCommand(command)
          : session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        if (!applied.ok) {
          session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
          break;
        }
        await (rendererRef.current?.play(applied.events) ?? Promise.resolve());
        announce(applied.events);
        showTrainingNote(applied.events);
        if (isPrologue && prologueMission && prologueRunRef.current && command) {
          const ctx = buildPrologueContext(prologueMission, content, hintSettings.showHints);
          const next = afterPrologueApply(kernel, command, applied.events, prologueRunRef.current, ctx);
          // РўРѕС‚ Р¶Рµ СЂР°Р·Р±РѕСЂ РёС‚РѕРіР°, С‡С‚Рѕ Рё РІ РєР°РЅР°Р»Рµ РєРѕРјР°РЅРґ: РѕС‚РєР°С‚ Рє РєРѕРЅС‚СЂРѕР»СЊРЅРѕР№
          // С‚РѕС‡РєРµ, С‡РµСЃС‚РЅРѕРµ РїРѕСЂР°Р¶РµРЅРёРµ РёР»Рё РІС‹С…РѕРґ СЃС‚Р°Рё СЃС†РµРЅРѕР№.
          const aftermath = prologueAftermath({
            next,
            events: applied.events,
            snapshot: kernel.getSnapshot(),
            hasCheckpoint: session.hasBattleCheckpoint(),
          });
          prologueRunRef.current = aftermath.state;
          switch (aftermath.kind) {
            case "restore":
              prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
                type: "death_by",
                cause: "checkpoint",
              });
              // Р—Р°С‚РµРјРЅРµРЅРёРµ Рё РѕС‚РєР°С‚ вЂ” РїРѕСЃР»Рµ С‚РѕРіРѕ, РєР°Рє С…РѕРґ РќР°РІРё РґРѕРёРіСЂР°РЅ.
              enemyAfter = () => void director.restoreScene();
              break;
            case "defeat":
              prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
                type: "death_by",
                cause: "checkpoint",
              });
              outcomeGate.report(() => setPrologueCard("outro"));
              break;
            case "spawnBeats":
              // РџРѕСЏРІР»РµРЅРёРµ РїРѕ СЃС†РµРЅРµ: РЅР° РїРѕР»Рµ СЃСѓС‰РЅРѕСЃС‚Рё РЅРµС‚ РґРѕ РІР±РµРіР°РЅРёСЏ (0.20.39).
              director.hideSpawns(aftermath.events);
              enemyAfter = () => void director.runSpawnBeats(aftermath.events);
              break;
            case "none":
              break;
          }
          setPrologueObjectiveKey(next.objectiveKey);
          if (next.outcome !== "ongoing") outcomeGate.report(() => setPrologueCard("outro"));
        }
        finishFromEvents(applied.events);
        // РџСѓСЃС‚Р°СЏ РєРѕРјР°РЅРґР° вЂ” СЃС†РµРЅР°СЂРёР№ РїСЂРѕС‚РёРІРЅРёРєР° РёСЃС‡РµСЂРїР°РЅ: РєСЂСѓРі Р·Р°РІРµСЂС€С‘РЅ.
        if (!enemyPhaseContinues({ ...phase(), commandIssued: command !== null })) break;
        await sleep(190);
      }
      if (isPrologue && kernel && prologueMission && prologueRunRef.current) {
        await director.runPlayerScript();
      }
      if (enemyAfter) await enemyAfter();
    } finally {
      outcomeGate.playbackEnd();
      setEnemyPhase(false);
    }
  };

  // Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РїР°СЂС‚РёРё, СЃРѕС…СЂР°РЅС‘РЅРЅРѕР№ РІ С…РѕРґ РќР°РІРё: Р°Р»РіРѕСЂРёС‚Рј РїСЂРѕС‚РёРІРЅРёРєР°
  // РїСЂРѕРґРѕР»Р¶Р°РµС‚ С…РѕРґ СЃ С‚РµРєСѓС‰РµРіРѕ СЃРѕСЃС‚РѕСЏРЅРёСЏ (РёРЅР°С‡Рµ СЃС‚РѕСЂРѕРЅР° РѕСЃС‚Р°Р»Р°СЃСЊ Р±С‹ Р±РµР· С…РѕРґР°).
  // Р’ РїРѕРѕС‡РµСЂС‘РґРЅРѕР№ РёРіСЂРµ Р°Р»РіРѕСЂРёС‚Рј РЅРµ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ вЂ” С…РѕРґ РїСЂРёРЅР°РґР»РµР¶РёС‚ С‡РµР»РѕРІРµРєСѓ.
  useEffect(() => {
    if (battleKind === "pvp" || battleKind === "pvpNet") return;
    if (battleOutcome() !== "ongoing") return;
    if (session.getBattleSnapshot(PLAYER_OWNER).activeOwner !== ENEMY_OWNER) return;
    void runEnemyPhase();
    // РќР°РјРµСЂРµРЅРЅРѕ СЃСЂР°Р±Р°С‚С‹РІР°РµС‚ РѕРґРёРЅ СЂР°Р· РїСЂРё СЃРѕР·РґР°РЅРёРё СЏРґСЂР° (РјРѕРЅС‚Р°Р¶ СЌРєСЂР°РЅР°,
    // РІРєР»СЋС‡Р°СЏ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РїР°СЂС‚РёРё РІ С…РѕРґ РќР°РІРё): РїРѕСЃР»РµРґСѓСЋС‰РёРµ СЃРјРµРЅС‹ С…РѕРґР°
    // РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ РєРѕРЅРІРµР№РµСЂ СЃРѕР±С‹С‚РёР№, Р° РїРѕРІС‚РѕСЂРЅС‹Р№ Р·Р°РїСѓСЃРє РЅР° РєР°Р¶РґРѕРј СЂРµРЅРґРµСЂРµ
    // СѓРґРІРѕРёР» Р±С‹ С…РѕРґ РїСЂРѕС‚РёРІРЅРёРєР°. runEnemyPhase С‡РёС‚Р°РµС‚ СЃРІРµР¶РµРµ СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РµСЂРµР·
    // Р·Р°РјС‹РєР°РЅРёРµ РјРѕРЅС‚РёСЂРѕРІР°РЅРёСЏ; СЌС‚Рѕ РѕСЃРѕР·РЅР°РЅРЅРѕРµ РёСЃРєР»СЋС‡РµРЅРёРµ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  /**
   * РЎРѕР±СЃС‚РІРµРЅРЅРѕ РєРѕРЅРµС† С…РѕРґР°: РєРѕРјР°РЅРґР°, РїСЂРѕРёРіСЂС‹РІР°РЅРёРµ СЃРѕР±С‹С‚РёР№, С…РѕРґ РќР°РІРё Рё
   * РІРѕР·РІСЂР°С‚ СѓРїСЂР°РІР»РµРЅРёСЏ РёРіСЂРѕРєСѓ. Р’С‹РЅРµСЃРµРЅРѕ РёР· `endTurn`, РїРѕС‚РѕРјСѓ С‡С‚Рѕ С‚РµРј Р¶Рµ
   * РїРѕСЂСЏРґРєРѕРј СЃС†РµРЅР° РїРµСЂРµРґР°С‘С‚ С…РѕРґ СЃРѕРїРµСЂРЅРёРєСѓ СЃР°РјР° (С€Р°Рі `handOff`, 0.20.40) вЂ”
   * РєРЅРѕРїРєР° РїСЂРё СЌС‚РѕРј РЅРµ РЅР°Р¶Р°С‚Р° Рё РїСЂРѕРІРµСЂРѕРє РєРЅРѕРїРєРё Р±С‹С‚СЊ РЅРµ РґРѕР»Р¶РЅРѕ.
   */
  const runEndTurnSequence = async (): Promise<void> => {
    const result = session.applyBattleCommand({ type: "END_TURN", playerId: String(viewOwner) });
    if (!result.ok) return;
    setBusy(true);
    // РџСЂРѕРёРіСЂС‹РІР°РЅРёРµ С…РѕРґР°: РёС‚РѕРі РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РїРѕСЃР»Рµ РЅРµРіРѕ Рё РїР°СѓР·С‹ (0.20.39).
    outcomeGate.playbackStart();
    try {
      if (isPrologue && kernel && prologueMission && prologueRunRef.current) {
        const ctx = buildPrologueContext(prologueMission, content, hintSettings.showHints);
        const next = afterPrologueApply(
          kernel,
          { type: "END_TURN", playerId: String(viewOwner) },
          result.events,
          prologueRunRef.current,
          ctx,
        );
        prologueRunRef.current = next;
        setPrologueObjectiveKey(next.objectiveKey);
        if (next.outcome !== "ongoing") outcomeGate.report(() => setPrologueCard("outro"));
      }
      advanceTraining(result.events);
      showTrainingNote(result.events);
      await (rendererRef.current?.play(result.events) ?? Promise.resolve());
      outcomeGate.playbackEnd();
      finishFromEvents(result.events);
      if (battleOutcome() === "ongoing" && session.getBattleSnapshot(PLAYER_OWNER).activeOwner === ENEMY_OWNER) {
        await runEnemyPhase();
      } else if (isPrologue && battleOutcome() === "ongoing") {
        await director.runPlayerScript();
      }
    } finally {
      outcomeGate.playbackEnd();
      setBusy(false);
    }
  };

  const endTurn = (): void => {
    if (paused || busy || outcomePending) return;
    if (snapshot.activeOwner !== viewOwner) return;
    // РћР±СѓС‡РµРЅРёРµ: Р·Р°РІРµСЂС€РµРЅРёРµ С…РѕРґР° вЂ” СЃР°РјРѕ РїРѕ СЃРµР±Рµ С€Р°Рі СЃС†РµРЅР°СЂРёСЏ (0.20.13);
    // РІРЅРµ С‚Р°РєРѕРіРѕ С€Р°РіР° РѕРЅРѕ Р·Р°РїСЂРµС‰РµРЅРѕ.
    if (isTraining && directiveView?.directive.kind !== "endTurn") {
      trainingDeny("endTurn");
      return;
    }
    setIntent({ type: "cancel" });
    setLog(null);
    if (battleKind === "pvp") {
      session.sendPvpCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    if (isNetGuest) {
      session.sendNetCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    if (
      isPrologue &&
      prologueRunRef.current &&
      !gatePrologueCommand(prologueRunRef.current, { type: "END_TURN", playerId: String(viewOwner) })
    ) {
      // В«РљРѕРЅРµС† С…РѕРґР°В» вЂ” С‚РѕР¶Рµ РґРµР№СЃС‚РІРёРµ: РїСЂРё СЃС‚РѕР№РєРµ РѕРЅРѕ Р·Р°РєСЂС‹С‚Рѕ Рё РїРѕРІС‚РѕСЂРЅРѕ
      // РѕС‚РєСЂС‹РІР°РµС‚ СЂРµРїР»РёРєСѓ Р·Р°СЃР°РґС‹ (0.21.21).
      showPrologueHint(currentPrologueHintKey() ?? "m2.noise");
      return;
    }
    void runEndTurnSequence();
  };

  /**
   * РџРµСЂРµРґР°С‡Р° С…РѕРґР° СЃРѕРїРµСЂРЅРёРєСѓ СЃС†РµРЅРѕР№ (0.20.40). РљРЅРѕРїРєР° РёРіСЂРѕРєР° РЅРµ РЅР°Р¶Р°С‚Р°:
   * СЃС†РµРЅР° СЃР°РјР° РѕС‚РєСЂС‹РІР°РµС‚ С…РѕРґ РќР°РІРё, С‡С‚РѕР±С‹ РїРѕСЃС‚Р°РІР»РµРЅРЅРѕРµ РїРѕСЏРІР»РµРЅРёРµ СЃСЂР°Р·Сѓ
   * РїРµСЂРµС€Р»Рѕ РІ РґРµР№СЃС‚РІРёРµ вЂ” РєСЂС‹СЃР° Рњ1 РєСѓСЃР°РµС‚ РіРµСЂРѕСЏ, РµРґРІР° РІС‹Р±РµР¶Р°РІ РёР· Р»РµСЃР°.
   */
  const handOffTurnToEnemy = async (): Promise<void> => {
    if (paused || isReplay || isSpectator) return;
    // РЎРІРµР¶РёР№ СЃРЅРёРјРѕРє: СЃС†РµРЅР° РёРґС‘С‚ Р°СЃРёРЅС…СЂРѕРЅРЅРѕ, СЃРѕСЃС‚РѕСЏРЅРёРµ СЂРµРЅРґРµСЂР° РјРѕРіР»Рѕ СѓСЃС‚Р°СЂРµС‚СЊ.
    if (session.getBattleSnapshot(viewOwner).activeOwner !== viewOwner) return;
    await runEndTurnSequence();
  };

  // Р РµР¶РёСЃСЃС‘СЂ СЃС†РµРЅ РїСЂРѕР»РѕРіР° (0.20.67): РІРѕСЃРµРјСЊ РїРѕСЃС‚Р°РЅРѕРІС‰РёРєРѕРІ, РґРµР»РёРІС€РёС… РѕР±С‰РёРµ
  // СЃСЃС‹Р»РєРё СЃРѕСЃС‚РѕСЏРЅРёСЏ, СЃРѕР±СЂР°РЅС‹ РѕС‚РґРµР»СЊРЅРѕ. Р—Р°РІРёСЃРёРјРѕСЃС‚Рё С‡РёС‚Р°СЋС‚СЃСЏ РёР· СЃСЃС‹Р»РєРё,
  // РїРѕСЌС‚РѕРјСѓ РїРѕСЃС‚Р°РЅРѕРІС‰РёРєРё СЃС‚Р°Р±РёР»СЊРЅС‹, Р° Р·Р°РјС‹РєР°РЅРёСЏ РІ РЅРёС… вЂ” СЃРІРµР¶РёРµ.
  const director = usePrologueDirector({
    session,
    content,
    hintSettings,
    isPrologue,
    mission: prologueMission ?? null,
    markers: prologueMarkers,
    kernel,
    runRef: prologueRunRef,
    telemetryRef: prologueTelemetryRef,
    firedRef: firedCutscenesRef,
    renderer: () => rendererRef.current,
    handOffTurn: () => handOffTurnToEnemy(),
    showStoryNote,
    translate: t,
    setCutscenePlaying,
    setBusy,
    setPrologueStanceLock,
    setPrologueObjectiveKey,
    setPrologueHintKey,
    resetSelection: () => {
      setIntent({ type: "clearSelection" });
    },
    announce,
    battleOutcome,
    outcomeGate,
    setPrologueCard,
  });

  // РљРѕРЅРµС† С…РѕРґР° СЃС‚РѕСЂРѕРЅС‹ РЅР°СЃС‚СѓРїР°РµС‚ СЃР°Рј, РєРѕРіРґР° РЅРё РѕРґРёРЅ Р±РѕРµС† СЃС‚РѕСЂРѕРЅС‹ РЅРµ РёРјРµРµС‚
  // РґРѕРїСѓСЃС‚РёРјС‹С… РґРµР№СЃС‚РІРёР№ (math В§16.7): РїСЂРё РЅСѓР»РµРІС‹С… Р·Р°РїР°СЃР°С… РћР” РІСЃРµС… Р¶РёРІС‹С…
  // Р±РѕР№С†РѕРІ Р°РєС‚РёРІРЅРѕР№ СЃС‚РѕСЂРѕРЅС‹ С…РѕРґ РїРµСЂРµРґР°С‘С‚СЃСЏ СЃР»РµРґСѓСЋС‰РµР№ СЃС‚РѕСЂРѕРЅРµ Р±РµР· РєРѕРјР°РЅРґС‹.
  // Р’ РѕР±СѓС‡РµРЅРёРё Р°РІС‚РѕР·Р°РІРµСЂС€РµРЅРёРµ РѕС‚РєР»СЋС‡Р°РµС‚СЃСЏ РЅР° С€Р°РіРµ В«Р·Р°РІРµСЂС€РёС‚Рµ С…РѕРґВ» вЂ” СЌС‚РѕС‚
  // С€Р°Рі СѓС‡РёС‚ РЅР°Р¶РёРјР°С‚СЊ РєРЅРѕРїРєСѓ. РџРѕРІС‚РѕСЂС‹ Рё РЅР°Р±Р»СЋРґР°С‚РµР»СЊ С…РѕРґ РЅРµ Р·Р°РІРµСЂС€Р°СЋС‚.
  // РЈСЃР»РѕРІРёРµ вЂ” С‡РёСЃС‚Р°СЏ С„СѓРЅРєС†РёСЏ (training-progress.ts), РїРѕРєСЂС‹С‚Р° С‚РµСЃС‚Р°РјРё.
  // Р­С‚Р°Рї 1.5: РІРЅРµ РѕР±СѓС‡РµРЅРёСЏ Р°РІС‚РѕР·Р°РІРµСЂС€РµРЅРёРµ РІРєР»СЋС‡Р°РµС‚СЃСЏ РЅР°СЃС‚СЂРѕР№РєРѕР№ РёРіСЂС‹.
  // РЎРѕСЃС‚Р°РІ Р¶РёРІС‹С… Р±РѕР№С†РѕРІ Рё Р°РєС‚РёРІРЅС‹Р№ РІР»Р°РґРµР»РµС† РјРµРЅСЏСЋС‚СЃСЏ С‚РѕР»СЊРєРѕ СЃ Р±РѕРµРј: СЂРµРІРёР·РёСЏ
  // СЃР»СѓР¶РёС‚ С‚СЂРёРіРіРµСЂРѕРј РїСЂРѕРІРµСЂРєРё Р°РІС‚Рѕ-Р·Р°РІРµСЂС€РµРЅРёСЏ С…РѕРґР° (0.21.11); endTurn Рё
  // battleOutcome С‡РёС‚Р°СЋС‚ СЃРІРµР¶РµРµ СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РµСЂРµР· Р·Р°РјС‹РєР°РЅРёРµ РѕР±СЂР°Р±РѕС‚С‡РёРєРѕРІ СЌРєСЂР°РЅР°.
  useEffect(() => {
    if (isPrologue && prologueRunRef.current?.forceDefend) return;
    if (!isTraining && !hintSettings.autoEndTurn) return;
    const ownUnits = snapshot.entities.filter(
      (entity) => !entity.dead && entity.coverType === 0 && entity.owner === viewOwner && entity.maxAp > 0,
    );
    if (
      !shouldAutoEndTurn({
        paused,
        busy,
        enemyPhase,
        isReplay,
        isSpectator,
        isTraining,
        activeHint,
        activeOwner: snapshot.activeOwner,
        viewOwner,
        ownUnits,
        outcomeOngoing: battleOutcome() === "ongoing",
        isNetGuest: Boolean(isNetGuest),
      })
    )
      return;
    endTurn();
    // endTurn/battleOutcome вЂ” С„СѓРЅРєС†РёРё РѕР±СЂР°Р±РѕС‚С‡РёРєР° СЌРєСЂР°РЅР°: С‡РёС‚Р°СЋС‚ СЃРІРµР¶РµРµ
    // СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РµСЂРµР· Р·Р°РјС‹РєР°РЅРёРµ, РЅРѕ РёС… РїРµСЂРµС‡РёСЃР»РµРЅРёРµ РїРµСЂРµСЃРѕР·РґР°РІР°Р»Рѕ Р±С‹ СЌС„С„РµРєС‚
    // РєР°Р¶РґС‹Р№ СЂРµРЅРґРµСЂ; isPrologue СЃС‚Р°Р±РёР»РµРЅ Р·Р° РІСЂРµРјСЏ СЌРєСЂР°РЅР°. РџСЂРѕРІРµСЂРєР°
    // СЃСЂР°Р±Р°С‚С‹РІР°РµС‚ РЅР° СЃРјРµРЅСѓ Р±РѕСЏ (СЂРµРІРёР·РёСЏ/СЃРЅРёРјРѕРє) Рё СЏРІРЅС‹Рµ С„Р»Р°РіРё РЅРёР¶Рµ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    battleRevision,
    viewOwner,
    paused,
    busy,
    enemyPhase,
    isReplay,
    isSpectator,
    isNetGuest,
    isTraining,
    activeHint,
    hintSettings.autoEndTurn,
    snapshot,
  ]);

  /**
   * РќР°Р¶Р°С‚РёРµ РїРѕ РїРѕР»СЋ (0.20.63): С‡С‚Рѕ РѕРЅРѕ Р·РЅР°С‡РёС‚, СЂРµС€Р°РµС‚ battle-cell-click,
   * Р·РґРµСЃСЊ С‚РѕР»СЊРєРѕ РёСЃРїРѕР»РЅРµРЅРёРµ РЅР°РјРµСЂРµРЅРёСЏ СЃРѕСЃС‚РѕСЏРЅРёРµРј Рё РєРѕРјР°РЅРґР°РјРё.
   */
  const onCell = (x: number, y: number): void => {
    const intent = resolveCellClick(x, y, {
      paused,
      busy,
      outcomePending,
      ownTurn: snapshot.activeOwner === viewOwner,
      isTraining,
      trainingNoopStep: activeHint?.until === "noop",
      trainingActorId,
      trainingDirective,
      selectedId,
      selected: selected ?? null,
      action,
      skills,
      entities: snapshot.entities,
      tiles: snapshot.grid.tiles,
      viewOwner,
      reach: byReach.get(cellKey(x, y)),
      aimId,
      hitAvailable: Boolean(hit?.available),
      charge,
      chargeArmed,
      preview,
      coarse: window.matchMedia("(pointer: coarse)").matches,
    });
    switch (intent.kind) {
      case "ignore":
        return;
      case "advanceNoopStep":
        setHintStep((value) => value + 1);
        return;
      case "selfArea":
        applySelfSkill(intent.skillId);
        return;
      case "select":
        setIntent({ type: "select", actorId: intent.id });
        return;
      case "denyActor":
        setLog(t("training.locked.actor"));
        return;
      case "armAttack":
        setIntent({ type: "armAction", action: intent.entry, targetId: intent.targetId });
        return;
      case "denyTarget":
        trainingDeny(intent.action);
        return;
      case "aim": {
        const target = snapshot.entities.find((entity) => entity.id === intent.id);
        // Р С‹РІРѕРє РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ СЃСЂР°Р·Сѓ: РїРµСЂРІРѕРµ РЅР°Р¶Р°С‚РёРµ РІРѕРѕСЂСѓР¶Р°РµС‚ РїРѕРґС…РѕРґ, РІС‚РѕСЂРѕРµ
        // РїРѕ С‚РѕР№ Р¶Рµ С†РµР»Рё РµРіРѕ РёСЃРїРѕР»РЅСЏРµС‚ (0.20.50).
        const plan = target ? chargeFor(target) : null;
        if (plan) setLog(t("battle.chargeHint"));
        const skill = action?.type === "skill" ? skills[action.id] : undefined;
        // РљР»РµС‚РєР° РїРѕСЃС‚Р°РЅРѕРІРєРё СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ Сѓ СѓРјРµРЅРёСЏ СЃ РїРµСЂРµРЅРѕСЃРѕРј.
        const targetPos = skill?.effects.some((effect) => effect.type === "displace") ? skillTargetPos : null;
        setIntent({ type: "aim", targetId: intent.id, chargePlan: plan, armed: plan !== null, targetPos });
        return;
      }
      case "attack":
        tryAttack(intent.id);
        return;
      case "charge":
        if (charge) executeCharge(charge);
        return;
      case "positionSkill":
        tryPositionSkill(intent.cell);
        return;
      case "previewMove":
        setIntent({ type: "previewMove", key: intent.key });
        return;
      case "move":
        tryMove(intent.cell);
        return;
      case "cancel":
        setIntent({ type: "cancel" });
        return;
    }
  };

  const onHover = (x: number, y: number): void => {
    if (paused || busy) return;
    const id = cellKey(x, y);
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (byReach.has(id) && !coarse) {
      setIntent({ type: "previewMove", key: id });
    }
    // Р С‹РІРѕРє (0.20.50): РЅР°РІРµРґРµРЅРёРµ РјС‹С€СЊСЋ РїРѕРєР°Р·С‹РІР°РµС‚ РїРѕРґС…РѕРґ Рё Р»РёРЅРёСЋ СѓРґР°СЂР°
    // РґРѕ РЅР°Р¶Р°С‚РёСЏ. РЎРµРЅСЃРѕСЂРЅС‹Р№ СЌРєСЂР°РЅ РЅР°РІРµРґРµРЅРёСЏ РЅРµ РёРјРµРµС‚ вЂ” С‚Р°Рј С‚РѕС‚ Р¶Рµ
    // РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РґР°С‘С‚ РїРµСЂРІРѕРµ РЅР°Р¶Р°С‚РёРµ.
    if (coarse || action === null) return;
    const hovered = snapshot.entities.find(
      (candidate) => !candidate.dead && candidate.coverType === 0 && candidate.x === x && candidate.y === y,
    );
    // Р¦РµР»СЊ, РІС‹Р±СЂР°РЅРЅСѓСЋ РЅР°Р¶Р°С‚РёРµРј, РЅР°РІРµРґРµРЅРёРµ РЅРµ РѕС‚РЅРёРјР°РµС‚: СѓРІРѕРґ РјС‹С€Рё СЃРЅРёРјР°РµС‚
    // С‚РѕР»СЊРєРѕ РЅРµРїРѕРґС‚РІРµСЂР¶РґС‘РЅРЅС‹Р№ СЂС‹РІРѕРє, РїРѕРєР°Р·Р°РЅРЅС‹Р№ СЃР°РјРёРј РЅР°РІРµРґРµРЅРёРµРј.
    if (!hovered || hovered.owner === viewOwner) {
      setIntent({ type: "hoverLeave" });
      return;
    }
    const plan = chargeFor(hovered);
    if (!plan) {
      setIntent({ type: "hoverLeave" });
      return;
    }
    setIntent({ type: "aim", targetId: hovered.id, chargePlan: plan, armed: false, targetPos: null });
  };

  inputRef.current = { onCell, onHover };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = createFieldRenderer();
    renderer.setOnActivate((x, y) => inputRef.current.onCell(x, y));
    renderer.setOnHover((x, y) => inputRef.current.onHover(x, y));
    let gone = false;
    void renderer.mount(host).then(() => {
      if (gone) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      // РЎСЂРµРґСЃС‚РІРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ СЃРјРѕРЅС‚РёСЂРѕРІР°РЅРѕ: РѕРґРёРЅ РїРµСЂРµСЂРµРЅРґРµСЂ, С‡С‚РѕР±С‹ СЌС„С„РµРєС‚С‹,
      // С‡РёС‚Р°СЋС‰РёРµ rendererRef, СѓРІРёРґРµР»Рё РіРѕС‚РѕРІС‹Р№ СЂРµРЅРґРµСЂ. Рљ СЂРµРІРёР·РёРё Р±РѕСЏ РЅРµ
      // РѕС‚РЅРѕСЃРёС‚СЃСЏ вЂ” СЌС‚Рѕ СЃРѕР±С‹С‚РёРµ РјРѕРЅС‚РёСЂРѕРІР°РЅРёСЏ РїСЂРµРґСЃС‚Р°РІР»РµРЅРёСЏ.
      setRendererReady(true);
    });
    return () => {
      gone = true;
      rendererRef.current = null;
      renderer.destroy();
    };
    // РЎСЃС‹Р»РєР° РІРІРѕРґР° РЅРµРёР·РјРµРЅРЅР°: РїРѕРґРїРёСЃРєР° РѕРґРЅР° РЅР° РІСЂРµРјСЏ СЌРєСЂР°РЅР°, Р° РѕР±СЂР°С‚РЅС‹Рµ
    // РІС‹Р·РѕРІС‹ СЃСЂРµРґСЃС‚РІРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ Р±РµСЂС‘С‚ РёР· РЅРµС‘ РїСЂРё РєР°Р¶РґРѕРј СЃРѕР±С‹С‚РёРё.
  }, [inputRef]);

  const aimBreakCell = useMemo(() => {
    if (!hit || !selected || !aimed) return null;
    // breakCell С‚РµРїРµСЂСЊ РІС‹С‡РёСЃР»СЏРµС‚СЃСЏ СЏРґСЂРѕРј РІ previewAttack (В§7, В§9.3).
    if (hit.breakCell) return hit.breakCell;
    return null;
  }, [hit, selected, aimed]);

  const hoverCell = useMemo(() => {
    if (skillTargetPos) return skillTargetPos;
    if (!preview) return null;
    const [xs, ys] = preview.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const tile = snapshot.grid.tiles.find((t) => t.x === x && t.y === y);
    return { x, y, z: tile?.z ?? 0 };
  }, [preview, skillTargetPos, snapshot.grid]);

  // Р­С‚Р°Рї 3.1: Р±РёРѕРј РєР°СЂС‚С‹ вЂ” РёР· РєРѕРЅС„РёРіСѓСЂР°С†РёРё СЂРµР¶РёРјР°, РєРѕС‚РѕСЂС‹Р№ СЃРѕР·РґР°Р» РјР°С‚С‡.
  const battleBiome = useMemo(() => {
    if (isTraining && trainingMission) return trainingMission.map.biome;
    if (isPrologue && prologueMission) return prologueMission.map.biome;
    if (battleKind === "campaign" && activeMissionId) {
      return session.getCampaign().getMission(activeMissionId)?.map.biome;
    }
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      return content.pvp.map?.biome ?? content.quickMatch.map.biome;
    }
    if (battleKind === "replay") return replayJournal?.options.map.biome;
    return content.quickMatch.map.biome;
  }, [
    isTraining,
    trainingMission,
    isPrologue,
    prologueMission,
    battleKind,
    activeMissionId,
    session,
    content,
    replayJournal,
  ]);

  // Р­С‚Р°Рї 3.6: РґРѕР»СЏ СЃС‡С‘С‚С‡РёРєР° РўСЊРјС‹ РєР°РјРїР°РЅРёРё вЂ” С…РѕР»РѕРґРЅС‹Р№ СЃР»РѕР№ РїРѕРІРµСЂС… СЃС†РµРЅС‹.
  const darknessRatio = useMemo(() => {
    if (battleKind !== "campaign") return 0;
    const state = session.getCampaign().getState();
    if (!state || state.darknessMax <= 0) return 0;
    return Math.min(1, Math.max(0, state.darkness / state.darknessMax));
  }, [battleKind, session]);

  // Р­С‚Р°Рї 2.6 (РїСЂР°РІРєР° РїРѕ СЂРµРІСЊСЋ): РѕР±Р»Р°СЃС‚РЅРѕР№ РїСЂРёС†РµР» РІРёРґРµРЅ СЃСЂР°Р·Сѓ РїСЂРё РІС‹Р±РѕСЂРµ
  // СѓРјРµРЅРёСЏ СЃ РѕР±Р»Р°СЃС‚СЊСЋ, РІРєР»СЋС‡Р°СЏ В«РєСЂСѓРіРѕРІРѕР№ РІР·РјР°С…В» Р±РѕРіР°С‚С‹СЂСЏ (self + СЂР°РґРёСѓСЃ).
  // Р“РµРѕРјРµС‚СЂРёСЏ РїСЂРёС…РѕРґРёС‚ РёР· С‚РѕРіРѕ Р¶Рµ preview-РІС‹Р·РѕРІР° СЏРґСЂР°, РєРѕС‚РѕСЂС‹Р№ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ
  // Р±РѕРµРІС‹Рј СЌРєСЂР°РЅРѕРј, РїРѕСЌС‚РѕРјСѓ renderer РЅРµ РјРѕР¶РµС‚ СЂР°СЃС…РѕР¶РґРµРЅРёСЏРјРё Math.hypot
  // РїРѕС‚РµСЂСЏС‚СЊ РґРёР°РіРѕРЅР°Р»СЊРЅС‹Рµ РєР»РµС‚РєРё.
  const areaPreview = useMemo(() => {
    void battleRevision;
    if (action?.type !== "skill" || selectedId === null || paused || busy) return null;
    const skill = skills[action.id];
    if (!skill) return null;
    const hasArea =
      (skill.radius ?? 0) > 0 || skill.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");
    if (!hasArea) return null;

    const center =
      skill.category === "self"
        ? selected
        : skillTargetPos
          ? { x: skillTargetPos.x, y: skillTargetPos.y, z: skillTargetPos.z }
          : undefined;
    if (!center) return null;

    // РЈ self-РЅР°РІС‹РєР° Р±РµР· С†РµР»Рё hit РЅР°РјРµСЂРµРЅРЅРѕ null: СЌС‚Рѕ РЅРµ РѕРґРёРЅРѕС‡РЅС‹Р№ target
    // preview. Р—Р°РїСЂР°С€РёРІР°РµРј С‚РѕС‚ Р¶Рµ SkillPreview РѕС‚РґРµР»СЊРЅРѕ, С‡С‚РѕР±С‹ РїРѕР»СѓС‡РёС‚СЊ
    // areaCells Рё РЅРµ РґСѓР±Р»РёСЂРѕРІР°С‚СЊ РіРµРѕРјРµС‚СЂРёСЋ РІ UI РёР»Рё renderer.
    const skillPreview =
      skill.category === "self" && !usesNetSnapshot ? session.getBattleSkillPreview(selectedId, action.id) : hit;
    if (!skillPreview?.areaCells?.length) return null;

    return {
      center: { x: center.x, y: center.y, z: center.z },
      radius: skill.radius ?? 0,
      areaCells: skillPreview.areaCells,
      // РљСЂР°СЃРЅРѕРµ РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ РЅСѓР¶РЅРѕ С‚РѕР»СЊРєРѕ С‚Р°Рј, РіРґРµ Р°С‚Р°РєР° РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ
      // РґРѕРїСѓСЃРєР°РµС‚ friendly fire; Р»РµС‡РµРЅРёРµ/РїСЂРёР·С‹РІ СЃ filter="all" РЅРµ РѕРїР°СЃРЅС‹.
      warnFriendly: skill.resolution === "attack" && (skill.filter === "all" || skill.filter === "allies"),
    };
    // РћР±Р»Р°СЃС‚СЊ РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂР° Р·Р°РІРёСЃРёС‚ РѕС‚ СЃРѕСЃС‚РѕСЏРЅРёСЏ Р±РѕСЏ вЂ” СЂРµРІРёР·РёСЏ СЃР»СѓР¶РёС‚
    // С‚СЂРёРіРіРµСЂРѕРј РїРµСЂРµСЃС‡С‘С‚Р° (0.21.11); РІС‹Р±РѕСЂ/РЅР°РІРµРґРµРЅРёРµ РѕСЃС‚Р°СЋС‚СЃСЏ СЏРІРЅС‹РјРё.
  }, [
    battleRevision,
    action,
    selectedId,
    selected,
    skillTargetPos,
    skills,
    paused,
    busy,
    usesNetSnapshot,
    session,
    hit,
  ]);

  // Р­С‚Р°Рї 4.8: РєР°СЂС‚РѕС‡РєР° РїСЂРёС†РµР»РёРІР°РЅРёСЏ РїРѕРґС‚СЏРіРёРІР°РµС‚СЃСЏ Рє С†РµР»Рё (РґРѕР»Рё СЌРєСЂР°РЅР°).
  const [aimCardPos, setAimCardPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (aimId === null || !hit) {
      setAimCardPos(null);
      return;
    }
    const position = rendererRef.current?.getEntityScreenPosition?.(aimId) ?? null;
    if (!position) {
      setAimCardPos(null);
      return;
    }
    // РЈРґРµСЂР¶Р°РЅРёРµ РІ РїСЂРµРґРµР»Р°С… СЌРєСЂР°РЅР°; РєР°СЂС‚РѕС‡РєР° РЅРµ РїРµСЂРµРєСЂС‹РІР°РµС‚ СЃР°РјСѓ С†РµР»СЊ вЂ”
    // СЃРјРµС‰Р°РµС‚СЃСЏ РІРїСЂР°РІРѕ-РІРЅРёР· РѕС‚ С‚РѕС‡РєРё РїСЂРёС†РµР»РёРІР°РЅРёСЏ.
    setAimCardPos({
      x: Math.min(88, Math.max(14, position.x * 100 + 9)),
      y: Math.min(66, Math.max(12, position.y * 100 + 8)),
    });
  }, [aimId, hit, snapshot]);

  useEffect(() => {
    rendererRef.current?.update({
      matchSeed,
      snapshot,
      selectedId,
      aimId,
      reachable,
      // Р С‹РІРѕРє (0.20.50): РјР°СЂС€СЂСѓС‚ РІРµРґС‘С‚ РІ РєР»РµС‚РєСѓ РїРѕРґС…РѕРґР°, Р° Р»СѓС‡
      // РїСЂРёС†РµР»РёРІР°РЅРёСЏ РЅР°С‡РёРЅР°РµС‚СЃСЏ С‚Р°Рј Р¶Рµ вЂ” РёРіСЂРѕРє РІРёРґРёС‚, РѕС‚РєСѓРґР° СѓРґР°СЂРёС‚.
      path: charge ? charge.path : previewPath,
      aimFrom: charge ? charge.step : null,
      aimOk: Boolean(hit?.available) || Boolean(charge),
      // Р­С‚Р°Рї 1.4: СЃРѕСЃС‚РѕСЏРЅРёРµ РєРѕР»СЊС†Р° С†РµР»Рё вЂ” Р±РµР»РѕРµ (РїСЂРµРґРІР°СЂРёС‚РµР»СЊРЅРѕ РІС‹Р±СЂР°РЅР°),
      // СЏРЅС‚Р°СЂРЅРѕРµ (Р°С‚Р°РєР° РіРѕС‚РѕРІР°), РєСЂР°СЃРЅРѕРµ (РЅРµРІРѕР·РјРѕР¶РЅРѕ).
      aimState:
        aimId === null ? undefined : charge ? "ready" : !hit ? "preselect" : hit.available ? "ready" : "blocked",
      // Р­С‚Р°Рї 2.7: С†РµР»СЊ РѕС‚РєСЂС‹С‚Р° СЃ С„Р»Р°РЅРіР° вЂ” РєСЂР°СЃРЅС‹Рµ СѓРіРѕР»РєРё-СЃРєРѕР±РєРё.
      aimFlanked: Boolean(hit?.available && hit.flanked),
      // Р­С‚Р°Рї 2.6 (РїСЂР°РІРєР°): РѕР±Р»Р°СЃС‚РЅРѕР№ РїСЂРёС†РµР» вЂ” С†РµРЅС‚СЂ Рё СЂР°РґРёСѓСЃ РёР· РѕРїСЂРµРґРµР»РµРЅРёСЏ
      // СѓРјРµРЅРёСЏ; РґР»СЏ СѓРјРµРЅРёР№ В«РЅР° СЃРµР±СЏВ» С†РµРЅС‚СЂ вЂ” СЃР°Рј Р±РѕРµС† (РєСЂСѓРіРѕРІРѕР№ РІР·РјР°С…).
      areaPreview,
      // Р­С‚Р°Рї 2.1: Р»РѕРєР°Р»РёР·РѕРІР°РЅРЅР°СЏ СЃС‚СЂРѕРєР° В«РџСЂРѕРјР°С…В» РґР»СЏ РІСЃРїР»С‹РІР°СЋС‰РµРіРѕ С‡РёСЃР»Р°.
      missLabel: t("combat.miss"),
      // Р­С‚Р°Рї 3.1: Р±РёРѕРј РєР°СЂС‚С‹ (РїР°Р»РёС‚СЂР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё, СЃС‚РёР»СЊ СѓРєСЂС‹С‚РёР№, РґРµРєРѕСЂ).
      biome: battleBiome,
      // Р­С‚Р°Рї 3.6: РґРѕР»СЏ РўСЊРјС‹ РєР°РјРїР°РЅРёРё РґР»СЏ С…РѕР»РѕРґРЅРѕРіРѕ СЃР»РѕСЏ Р°С‚РјРѕСЃС„РµСЂС‹.
      darkness: darknessRatio,
      heightMod: hit?.heightMod ?? 0,
      debugMovement,
      visibleCells,
      exploredCells,
      // Р‘Р°Р·РѕРІС‹Р№ РєР°РґСЂ РґРµСЂР¶РёС‚ СЃРІРѕРёС… Р±РѕР№С†РѕРІ: РїРѕР»Рµ РєСЂСѓРїРЅРµРµ РѕРєРЅР° Р±РѕР»СЊС€Рµ РЅРµ
      // РІР»РµР·Р°РµС‚ С†РµР»РёРєРѕРј, Рё СЃРµСЂРµРґРёРЅР° РєР°СЂС‚С‹ РѕСЃС‚Р°РІРёР»Р° Р±С‹ РѕС‚СЂСЏРґ Р·Р° РєР°РґСЂРѕРј (0.20.42).
      homeOwner: viewOwner,
      aimBreakCell,
      hoverCell,
      trainingHighlight,
      trainingFocus,
    });
    // rendererReady: РїРѕСЃР»Рµ Р°СЃРёРЅС…СЂРѕРЅРЅРѕРіРѕ РјРѕРЅС‚Р°Р¶Р° СЃСЂРµРґСЃС‚РІР° РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ СЌС„С„РµРєС‚
    // РѕР±СЏР·Р°РЅ РѕС‚СЂР°Р±РѕС‚Р°С‚СЊ РµС‰С‘ СЂР°Р· Рё РѕС‚РїСЂР°РІРёС‚СЊ РїРµСЂРІС‹Р№ РєР°РґСЂ (СЂР°РЅСЊС€Рµ СЌС‚Рѕ РґРµР»Р°Р»
    // setTick). snapshot/visibleCells РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ РїРѕ СЂРµРІРёР·РёРё Р±РѕСЏ.
  }, [
    rendererReady,
    matchSeed,
    snapshot,
    selectedId,
    aimId,
    reachable,
    previewPath,
    hit,
    hit?.heightMod,
    paused,
    debugMovement,
    visibleCells,
    exploredCells,
    aimBreakCell,
    hoverCell,
    trainingHighlight,
    trainingFocus,
    action,
    t,
    battleBiome,
    darknessRatio,
    areaPreview,
    charge,
    viewOwner,
  ]);

  // Р–РµСЃС‚С‹ С…РѕР»СЃС‚Р° Р·Р°РєСЂС‹С‚С‹, РїРѕРєР° РёСЃС…РѕРґ Р±РѕСЏ РµС‰С‘ РЅРµ РїРѕРєР°Р·Р°РЅ (0.20.40): РїР°СѓР·Р°
  // РїСЂРёРЅР°РґР»РµР¶РёС‚ РїСЂРѕРёРіСЂС‹РІР°РЅРёСЋ Р±РѕСЏ, Р° РЅРµ РёРіСЂРѕРєСѓ. РЎС†РµРЅР° РґРµСЂР¶РёС‚ Р·Р°РјРѕРє СЃР°РјР°,
  // РїРѕСЌС‚РѕРјСѓ СЃРЅСЏС‚РёРµ Р·Р°РјРєР° СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕ РѕР±РѕРёРј РёСЃС‚РѕС‡РЅРёРєР°Рј вЂ” РёРЅР°С‡Рµ СЌРєСЂР°РЅ
  // СЂР°Р·Р±Р»РѕРєРёСЂРѕРІР°Р» Р±С‹ РїРѕР»Рµ РІ С…РІРѕСЃС‚Рµ РµС‰С‘ РёРґСѓС‰РµР№ СЃС†РµРЅС‹.
  useEffect(() => {
    rendererRef.current?.setInputLocked?.(outcomePending || cutscenePlaying);
  }, [outcomePending, cutscenePlaying]);

  // Р­С‚Р°Рї 2.10: РїРµСЂРµРєР»СЋС‡Р°С‚РµР»СЊ С‚РµРјРїР° Р±РѕСЏ вЂ” РґРІРѕР№РЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЊ РґР»СЏ РІСЃРµС… РїР°СѓР·,
  // РїРµСЂРµРјРµС‰РµРЅРёР№ Рё СЌС„С„РµРєС‚РѕРІ РїРѕР»СЏ, Р° С‚Р°РєР¶Рµ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРіРѕ РїСЂРѕРёРіСЂС‹РІР°РЅРёСЏ
  // РїРѕРІС‚РѕСЂРѕРІ (РїРѕРІС‚РѕСЂС‹ РёРґСѓС‚ С‡РµСЂРµР· С‚РѕС‚ Р¶Рµ РєРѕРЅРІРµР№РµСЂ play() СЂРµРЅРґРµСЂРµСЂР°).
  const [fastPace, setFastPace] = useState(false);
  useEffect(() => {
    rendererRef.current?.setSpeed(fastPace ? 2 : 1);
  }, [fastPace]);

  // Р­С‚Р°Рї 1.7: СЃРёСЃС‚РµРјРЅР°СЏ РЅР°СЃС‚СЂРѕР№РєР° В«СѓРјРµРЅСЊС€РёС‚СЊ РґРІРёР¶РµРЅРёРµВ» СЂР°СЃРїСЂРѕСЃС‚СЂР°РЅСЏРµС‚СЃСЏ РЅР°
  // Р±РѕРµРІРѕР№ СЌРєСЂР°РЅ вЂ” С‚СЂСЏСЃРєР° РєР°РјРµСЂС‹, В«РґС‹С…Р°РЅРёРµВ» С„РёС€РµРє Рё РґСЂРµР№С„ С‚СѓРјР°РЅР° РѕС‚РєР»СЋС‡Р°СЋС‚СЃСЏ.
  useEffect(() => {
    // jsdom (Р°РІС‚РѕС‚РµСЃС‚С‹) РЅРµ СЂРµР°Р»РёР·СѓРµС‚ matchMedia вЂ” СЃС‡РёС‚Р°РµРј РЅР°СЃС‚СЂРѕР№РєСѓ РІС‹РєР»СЋС‡РµРЅРЅРѕР№.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = (): void => rendererRef.current?.setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // РЎРЅСЏС‚РёРµ РїСЂРёС†РµР»РёРІР°РЅРёСЏ СЃ РєР»Р°РІРёР°С‚СѓСЂС‹ (0.20.59): РїСЂРёС†РµР» Рё РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ
  // СЃР±СЂР°СЃС‹РІР°СЋС‚СЃСЏ СЃРѕР±С‹С‚РёРµРј cancel, РІС‹Р±СЂР°РЅРЅС‹Р№ Р±РѕРµС† РѕСЃС‚Р°С‘С‚СЃСЏ.
  const cancelKeyboardAim = useCallback((): void => {
    setIntent({ type: "cancel" });
  }, [setIntent]);

  // РљР»Р°РІРёР°С‚СѓСЂР°: СЂРµС€РµРЅРёСЏ вЂ” РІ РјРѕРґСѓР»Рµ battle-keyboard, Р·РґРµСЃСЊ С‚РѕР»СЊРєРѕ РїСЂРѕРІРѕРґРєР° Рє
  // СЃРѕСЃС‚РѕСЏРЅРёСЋ СЌРєСЂР°РЅР° (0.20.59). РџСЂРµР¶РґРµ РєР°СЂС‚Р° РєР»Р°РІРёС€ Р¶РёР»Р° РІРЅСѓС‚СЂРё СЌС„С„РµРєС‚Р° Рё
  // Р·Р°РЅРёРјР°Р»Р° СЃС‚Рѕ С‚СЂРёРґС†Р°С‚СЊ СЃС‚СЂРѕРє РїРѕСЃСЂРµРґРё РєРѕРјРїРѕРЅРµРЅС‚Р°.
  //
  // РљРѕРЅС‚РµРєСЃС‚ Рё РґРµР№СЃС‚РІРёСЏ СЃРєР»Р°РґС‹РІР°СЋС‚СЃСЏ РІ СЃСЃС‹Р»РєСѓ Рё РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ РїРѕСЃР»Рµ РєР°Р¶РґРѕРіРѕ
  // РєР°РґСЂР°. Р—Р°РјС‹РєР°РЅРёСЏ РєРѕРјР°РЅРґ (applyCommand, applySelfSkill) РїРµСЂРµСЃРѕР·РґР°СЋС‚СЃСЏ
  // РєР°Р¶РґС‹Р№ СЂРµРЅРґРµСЂ; Р±СѓРґСЊ РѕРЅРё РІ Р·Р°РІРёСЃРёРјРѕСЃС‚СЏС…, РѕРєРЅРѕ РїРµСЂРµРїРѕРґРїРёСЃС‹РІР°Р»РѕСЃСЊ Р±С‹ РЅР°
  // РєР°Р¶РґРѕРј РєР°РґСЂРµ, Р° Р±РµР· РЅРёС… РІ РѕР±СЂР°Р±РѕС‚С‡РёРєРµ РѕСЃС‚Р°Р»Р°СЃСЊ Р±С‹ СѓСЃС‚Р°СЂРµРІС€Р°СЏ РєРѕРјР°РЅРґР°.
  // РЎСЃС‹Р»РєР° РґР°С‘С‚ СЃРІРµР¶РёРµ Р·Р°РјС‹РєР°РЅРёСЏ РїСЂРё РѕРґРЅРѕР№ РїРѕРґРїРёСЃРєРµ РЅР° РІСЂРµРјСЏ СЌРєСЂР°РЅР°.
  const keyboard = useLatest<{ ctx: BattleKeyContext; apply: (intent: BattleKeyIntent) => void }>({
    ctx: {
      paused,
      busy,
      outcomePending,
      cutscenePlaying,
      isTraining,
      trainingActorId,
      trainingDirective,
      trainingAllows,
      selectedId,
      selected: selected ?? null,
      action,
      skills,
      snapshot,
      viewOwner,
      side,
    },
    apply: (intent) => {
      switch (intent.kind) {
        case "none":
          return;
        case "skipCutscene":
          director.skip();
          return;
        case "togglePause":
          session.setPaused(!paused);
          return;
        case "select":
          // РћР±Р·РѕСЂ РєР»РµС‚РєРё РЅРµ СЃРЅРёРјР°РµРј: РїРµСЂРµР±РѕСЂ Р±РѕР№С†РѕРІ РєР»Р°РІРёС€Р°РјРё РЅРµ РѕС‚РјРµРЅСЏРµС‚
          // РїРѕРґСЃРІРµС‚РєСѓ СѓР¶Рµ РѕСЃРјРѕС‚СЂРµРЅРЅРѕР№ РєР»РµС‚РєРё (select СЃРѕС…СЂР°РЅСЏРµС‚ placing).
          setIntent({ type: "select", actorId: intent.id });
          return;
        case "defend":
          applyCommand({ type: "DEFEND", actorId: intent.actorId });
          cancelKeyboardAim();
          return;
        case "overwatch":
          applyCommand({ type: "OVERWATCH", actorId: intent.actorId });
          cancelKeyboardAim();
          return;
        case "applySelfSkill":
          applySelfSkill(intent.skillId);
          return;
        case "armSkill":
          if (selectedId !== null) setIntent({ type: "toggleAction", actorId: selectedId, action: intent.entry });
          return;
        case "toggleAction":
          setIntent({
            type: "toggleAction",
            actorId: selectedId ?? 0,
            action: action?.type === intent.entry.type && action.id === intent.entry.id ? null : intent.entry,
          });
          return;
        case "pan":
          rendererRef.current?.pan(intent.dx, intent.dy);
          return;
      }
    },
  });
  // РџРѕРґРїРёСЃРєР° РѕРґРЅР° РЅР° РІСЂРµРјСЏ СЌРєСЂР°РЅР°: СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РёС‚Р°РµС‚СЃСЏ РёР· СЃСЃС‹Р»РєРё.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Р РµС€РµРЅРёРµ РїСЂРёРЅРёРјР°РµС‚ battle-keyboard, РёСЃРїРѕР»РЅРµРЅРёРµ вЂ” СЌРєСЂР°РЅ: Р·Р°РјС‹РєР°РЅРёСЏ
      // РєРѕРјР°РЅРґ СЃРІРµР¶РёРµ, РїРѕС‚РѕРјСѓ С‡С‚Рѕ РёСЃРїРѕР»РЅРёС‚РµР»СЊ РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РєР°Р¶РґС‹Р№ РєР°РґСЂ.
      keyboard.current.apply(resolveBattleKey(event, keyboard.current.ctx));
    };
    const onContext = (event: MouseEvent): void => {
      event.preventDefault();
      cancelKeyboardAim();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
    // РЎСЃС‹Р»РєР° РЅРµРёР·РјРµРЅРЅР°, РїРѕСЌС‚РѕРјСѓ РїРѕРґРїРёСЃРєР° РѕРґРЅР° РЅР° РІСЂРµРјСЏ СЌРєСЂР°РЅР°;
    // cancelKeyboardAim СЃС‚Р°Р±РёР»РµРЅ (useCallback РїРѕРІРµСЂС… СЃС‚Р°Р±РёР»СЊРЅРѕРіРѕ setIntent).
  }, [keyboard, cancelKeyboardAim]);

  // Р’ РґСЂСѓР¶РёРЅРµ вЂ” С‚РѕР»СЊРєРѕ Р±РѕР№С†С‹ (0.20.45). РЈРІСЏР·С€РёР№ РІ С‚СЂСЏСЃРёРЅРµ Р¤РµРґРѕС‚ РІС‹С…РѕРґРёС‚
  // РёР· СЃРїРёСЃРєР°: РїРѕРєР° РѕРЅ immobile (maxAp 0), СѓРїСЂР°РІР»СЏС‚СЊ РёРј РЅРµР»СЊР·СЏ, Рё РїСѓСЃС‚Р°СЏ
  // РєР°СЂС‚РѕС‡РєР° СЃ РїСѓСЃС‚РѕР№ С€РєР°Р»РѕР№ РћР” РѕР±РµС‰Р°Р»Р° Р±С‹ РёРіСЂРѕРєСѓ РІС‚РѕСЂРѕРіРѕ Р±РѕР№С†Р°, РєРѕС‚РѕСЂРѕРіРѕ
  // Сѓ РЅРµРіРѕ РЅРµС‚. РќР° РїРѕР»Рµ РѕРЅ РІРёРґРµРЅ, Р° С†РµР»СЊ РјРёСЃСЃРёРё РЅР°Р·РІР°РЅР° РІ С€Р°РїРєРµ.
  const roster = snapshot.entities.filter(
    (entity) =>
      (isSpectator ? entity.owner === 1 || entity.owner === 2 : entity.owner === viewOwner) &&
      entity.coverType === 0 &&
      (entity.dead || entity.maxAp > 0),
  );
  const sideKey = isSpectator
    ? "net.spectator"
    : battleKind === "pvp" || battleKind === "pvpNet"
      ? viewOwner === 1
        ? "pvp.side1"
        : "pvp.side2"
      : snapshot.activeOwner === ENEMY_OWNER
        ? "field.sideEnemy"
        : "field.sidePlayer";

  // РџРѕРєР°Р·С‹РІР°С‚СЊ РїРѕСЂС‚СЂРµС‚С‹ РїСЂРѕС‚РёРІРЅРёРєРѕРІ С‚РѕР»СЊРєРѕ РµСЃР»Рё РѕРЅРё РІ Р·РѕРЅРµ РІРёРґРёРјРѕСЃС‚Рё
  // (РёР»Рё СѓР¶Рµ РјРµСЂС‚РІС‹ Рё Р±С‹Р»Рё РІРёРґРЅС‹). Р’ РїРѕРѕС‡РµСЂС‘РґРЅРѕР№ РёРіСЂРµ вЂ” РїСЂРѕС‚РёРІРЅРёРєРё Р°РєС‚РёРІРЅРѕР№
  // СЃС‚РѕСЂРѕРЅС‹; Сѓ РЅР°Р±Р»СЋРґР°С‚РµР»СЏ вЂ” РІСЃРµ Р±РѕР№С†С‹ РѕР±РµРёС… СЃС‚РѕСЂРѕРЅ.
  const knownEnemies = snapshot.entities.filter((entity) => {
    if (entity.owner !== enemyOwner || entity.coverType !== 0) return false;
    if (isSpectator && entity.owner !== 1 && entity.owner !== 2) return false;
    // РЎРЅРёРјРѕРє СЃС‚РѕСЂРѕРЅС‹ СЃРѕРґРµСЂР¶РёС‚ С‚РѕР»СЊРєРѕ РІРёРґРёРјС‹С… С‡СѓР¶РёС… СЋРЅРёС‚РѕРІ (math В§8.3):
    // РїРѕРіРёР±С€РёР№ РїСЂРѕС‚РёРІРЅРёРє РѕСЃС‚Р°С‘С‚СЃСЏ РІ РїРѕР»РѕСЃРµ, РїРѕРєР° РµРіРѕ РєР»РµС‚РєР° РЅР°Р±Р»СЋРґР°РµРјР°.
    return visibleCells.has(cellKey(entity.x, entity.y));
  });

  /**
   * Р—Р°РїРѕРјРЅРµРЅРЅС‹Рµ РїСЂРѕС‚РёРІРЅРёРєРё (0.20.42). РЎРЅРёРјРѕРє СЃС‚РѕСЂРѕРЅС‹ РѕС‚РґР°С‘С‚ С‚РѕР»СЊРєРѕ С‚РµС…,
   * РєРѕРіРѕ РґСЂСѓР¶РёРЅР° РІРёРґРёС‚ СЃРµР№С‡Р°СЃ, РїРѕСЌС‚РѕРјСѓ РІС‹С€РµРґС€РёР№ РёР· РїРѕР»СЏ Р·СЂРµРЅРёСЏ РїСЂРѕС‚РёРІРЅРёРє
   * РїСЂРѕСЃС‚Рѕ РёСЃС‡РµР·Р°Р» Р±С‹ РёР· РїРѕР»РѕСЃС‹ вЂ” РёРіСЂРѕРє С‚РµСЂСЏР» Р±С‹ СЃС‡С‘С‚ РІСЂР°РіР°Рј. РџРѕСЂС‚СЂРµС‚
   * РѕСЃС‚Р°С‘С‚СЃСЏ, РЅРѕ РїСЂРёРіР»СѓС€С‘РЅ: РєР°РјРµСЂСѓ Рє С‚Р°РєРѕРјСѓ РІСЂР°РіСѓ РІРµСЃС‚Рё РЅРµРєСѓРґР°.
   */
  const seenEnemiesRef = useRef(new Map<number, RememberedEnemy>());
  rememberEnemies(knownEnemies, seenEnemiesRef.current);
  const enemyStrip = buildEnemyStrip(seenEnemiesRef.current, knownEnemies);

  return (
    <div
      className={`battle-screen${battleKind === "pvp" ? (viewOwner === 1 ? " is-pvp-side1" : " is-pvp-side2") : ""}${trainingFocus ? " is-training-focus" : ""}`}
    >
      <div ref={hostRef} className="battle-stage" />
      <div className="battle-hud">
        {isTraining && trainingMission ? (
          // Р•РґРёРЅР°СЏ РѕР±СѓС‡Р°СЋС‰Р°СЏ РїР°РЅРµР»СЊ В«РЅР°СЃС‚Р°РІРЅРёРєВ»: РїРѕСЂС‚СЂРµС‚, С€Р°Рі Рё РёРЅСЃС‚СЂСѓРєС†РёСЏ
          // СЃРѕР±СЂР°РЅС‹ РІ РѕРґРЅСѓ РєРѕРјРїР°РєС‚РЅСѓСЋ РєР°СЂС‚РѕС‡РєСѓ Сѓ РІРµСЂС…РЅРµРіРѕ РєСЂР°СЏ, С‡С‚РѕР±С‹ РЅРµ
          // РїРµСЂРµРєСЂС‹РІР°С‚СЊ С†РµРЅС‚СЂ РїРѕР»СЏ (РґРѕСЂР°Р±РѕС‚РєР° РІС‘СЂСЃС‚РєРё РѕР±СѓС‡РµРЅРёСЏ).
          <div className="training-coach" role="status" aria-live="polite">
            {unitPortrait("chronicler") ? (
              <img className="training-coach-face" src={unitPortrait("chronicler")} alt="" draggable={false} />
            ) : null}
            <div className="training-coach-body">
              <div className="training-coach-head">
                <span className="training-coach-name">{t("training.mentor")}</span>
                {activeHint ? (
                  <span className="training-hint-step">
                    {t("training.step", { current: hintStep + 1, total: trainingHints.length })}
                  </span>
                ) : null}
              </div>
              <p className="training-coach-line">
                {activeHint ? t(activeHint.textKey) : t(`training.${trainingMission.id}.intro`)}
              </p>
              {activeHint && activeHint.until === "noop" ? (
                <button type="button" className="training-continue" onClick={() => setHintStep((value) => value + 1)}>
                  {t("training.continue")}
                </button>
              ) : null}
            </div>
            {/* РџСЂРѕРїСѓСЃРє С€Р°РіР° вЂ” С‚РѕР»СЊРєРѕ РїСЂРё РїРѕРІС‚РѕСЂРЅРѕРј РїСЂРѕС…РѕР¶РґРµРЅРёРё СѓР¶Рµ
                РїСЂРѕР№РґРµРЅРЅРѕР№ РјРёСЃСЃРёРё (0.20.2): РїРµСЂРІРѕРµ РїСЂРѕС…РѕР¶РґРµРЅРёРµ РІРµРґС‘С‚СЃСЏ
                РїРѕ С€Р°РіР°Рј Р±РµР· РїСЂРѕРїСѓСЃРєР° (РґРѕРІРѕРґРєР° РѕР±СѓС‡РµРЅРёСЏ). */}
            {activeHint && (trainingDoneMissions ?? []).includes(trainingMission.id) ? (
              <button type="button" className="training-skip" onClick={() => setHintStep((value) => value + 1)}>
                {t("training.skip")}
              </button>
            ) : null}
            {activeHint ? (
              <span className="training-step-dots" aria-hidden="true">
                {trainingHints.map((item, index) => (
                  <i
                    key={item.step}
                    className={`training-step-dot${index < hintStep ? " is-done" : index === hintStep ? " is-current" : ""}`}
                  />
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        {trainingNote ? (
          // Р РµР°РєС‚РёРІРЅС‹Рµ РїР»Р°С€РєРё (СЏРґ, РІРѕСЃРєСЂРµС€РµРЅРёРµ, РїСЂРёР·С‹РІ) вЂ” Сѓ РЅРёР¶РЅРµРіРѕ РєСЂР°СЏ,
          // РЅР°Рґ РїР°РЅРµР»СЊСЋ РґРµР№СЃС‚РІРёР№, С‡С‚РѕР±С‹ РЅРµ РїРµСЂРµРєСЂС‹РІР°С‚СЊ С†РµРЅС‚СЂ РїРѕР»СЏ.
          <div className="training-note" role="status" aria-live="polite">
            <span className="training-note-mark" aria-hidden="true">
              вњ¦
            </span>
            {t(trainingNote)}
          </div>
        ) : null}
        {activeBattleHint ? (
          <CampaignHint
            key={activeBattleHint}
            hintId={activeBattleHint}
            variant={activeBattleHint === "first_battle" ? "modal" : "banner"}
            onClose={closeBattleHint}
            action={
              // РўСѓС‚РѕСЂРёР°Р» В«РїРµСЂРІС‹Р№ Р±РѕР№В» РїСЂРµРґР»Р°РіР°РµС‚ СЂРµР¶РёРј РѕР±СѓС‡РµРЅРёСЏ РёРіСЂРѕРєСѓ,
              // РєРѕС‚РѕСЂС‹Р№ РµРіРѕ РµС‰С‘ РЅРµ РїСЂРѕС€С‘Р» (0.20.2, РґРѕРІРѕРґРєР° РѕРЅР±РѕСЂРґРёРЅРіР°).
              activeBattleHint === "first_battle" &&
              !content.training.missions.every((mission) => (trainingDoneMissions ?? []).includes(mission.id))
                ? {
                    label: t("training.offerOpen"),
                    run: () => {
                      closeBattleHint();
                      session.goTo("training");
                    },
                  }
                : undefined
            }
          />
        ) : null}
        {isReplay ? (
          <div className="replay-bar" role="status">
            <span className="replay-label">{t("replay.watching")}</span>
            <span className="replay-progress">
              <i
                style={{
                  width: `${replayJournal ? Math.min(100, (replayIndex / Math.max(1, replayJournal.commands.length)) * 100) : 0}%`,
                }}
              />
            </span>
            <span className="muted">
              {replayIndex}/{replayJournal?.commands.length ?? 0}
            </span>
            {replayDone ? <span className="replay-done">{t("replay.done")}</span> : null}
          </div>
        ) : null}
        <header className="battle-top">
          <div className="top-controls">
            <button type="button" className="hud-btn" onClick={() => session.setPaused(true)}>
              {t("battle.pause")}
            </button>
            {/* Р­С‚Р°Рї 2.10: РїРµСЂРµРєР»СЋС‡Р°С‚РµР»СЊ С‚РµРјРїР° Р±РѕСЏ вЂ” РѕР±С‹С‡РЅР°СЏ Рё РґРІРѕР№РЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЊ.
                РЎРѕСЃС‚РѕСЏРЅРёРµ РїРѕРґРїРёСЃР°РЅРѕ РїРѕРґСЃРєР°Р·РєРѕР№, РґРѕСЃС‚СѓРїРЅРѕ СЃ РєР»Р°РІРёР°С‚СѓСЂС‹,
                РїРѕРјРµС‡РµРЅРѕ Р°С‚СЂРёР±СѓС‚РѕРј РЅР°Р¶Р°С‚РѕСЃС‚Рё. */}
            <button
              type="button"
              className={`hud-btn hud-icon-btn pace-toggle${fastPace ? " is-on" : ""}`}
              onClick={() => setFastPace((value) => !value)}
              aria-pressed={fastPace}
              title={t(fastPace ? "battle.fastPaceHint" : "battle.fastPace")}
              aria-label={t("battle.fastPace")}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 5l7 7-7 7M13 5l7 7-7 7" />
              </svg>
            </button>
            {isTraining ? (
              <button
                type="button"
                className="hud-btn hud-icon-btn training-exit"
                onClick={() => session.goTo("training")}
                title={t("training.exitHint")}
                aria-label={t("training.exit")}
              >
                <ExitIcon />
              </button>
            ) : null}
            {debug ? (
              <>
                <button
                  type="button"
                  className={`hud-btn hud-icon-btn debug-toggle${debugMovement ? " is-on" : ""}`}
                  onClick={() => setDebugMovement((value) => !value)}
                  title={t(debugMovement ? "battle.debugMovementHint" : "battle.debugMovement")}
                  aria-pressed={debugMovement}
                  aria-label={t("battle.debugMovement")}
                >
                  <DebugIcon />
                </button>
                <button
                  type="button"
                  className="hud-btn hud-icon-btn debug-win"
                  onClick={() => debugAutoWin()}
                  title={t("battle.debugAutoWinHint")}
                  aria-label={t("battle.debugAutoWin")}
                >
                  <AutoWinIcon />
                </button>
              </>
            ) : null}
          </div>
          <div className="battle-objective">
            <p className="eyebrow">
              {battleKind === "campaign" ? (
                <>
                  <span className="mission-badge">{t("campaign.mission")}</span>
                  {activeMissionId ?? ""}
                </>
              ) : battleKind === "pvp" ? (
                t("menu.pvp")
              ) : isTraining ? (
                t("training.battleLabel")
              ) : isPrologue && prologueMission ? (
                t(prologueMission.titleKey)
              ) : (
                t("menu.quickMatch")
              )}
            </p>
            <p>
              {isPrologue
                ? t(prologueObjectiveKey)
                : battleKind === "campaign" && mission
                  ? t(`battle.objective.${mission.type}`)
                  : isTraining && trainingMission
                    ? t(`training.objective.${trainingMission.id}`)
                    : t("battle.objectiveQuick")}
            </p>
            <p className="muted">
              {t("field.turn", { turn: snapshot.turnNumber })}
              {" В· "}
              {t(sideKey)}
            </p>
            {snapshot.apple ? (
              <div className="apple-hud" aria-label={t("pvp.appleLabel")}>
                <span className="apple-hud-icon" aria-hidden="true">
                  в—Џ
                </span>
                <span className="apple-hud-text">
                  {snapshot.apple.carrierId !== null
                    ? (() => {
                        const carrier = snapshot.entities.find((entity) => entity.id === snapshot.apple?.carrierId);
                        const side = carrier?.owner === 1 ? t("pvp.side1") : t("pvp.side2");
                        return t("pvp.appleCarrier", { side });
                      })()
                    : t("pvp.appleLying")}
                </span>
              </div>
            ) : null}
            {objectiveEntity ? (
              <div className="objective-hud" aria-label={t("campaign.objective")}>
                {unitPortrait(objectiveEntity.configId) ? (
                  <img
                    className={`objective-face${objectiveEntity.dead ? " is-dead" : ""}`}
                    src={unitPortrait(objectiveEntity.configId)}
                    alt=""
                    draggable={false}
                  />
                ) : null}
                <span className="objective-meta">
                  <span className="objective-name">{t(unitNameKey(objectiveEntity.configId))}</span>
                  <span
                    className="objective-hp"
                    aria-label={t("battle.hp", { current: objectiveEntity.hp, max: objectiveEntity.maxHp })}
                  >
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, (objectiveEntity.hp / objectiveEntity.maxHp) * 100))}%`,
                      }}
                    />
                  </span>
                </span>
              </div>
            ) : null}
            {enemyStrip.length > 0 ? (
              <div className="enemies-strip" aria-label={t("field.sideEnemy")}>
                {enemyStrip.map((enemy) => {
                  const name = t(unitNameKey(enemy.configId));
                  return (
                    <EnemyFace
                      key={enemy.id}
                      configId={enemy.configId}
                      dead={enemy.dead}
                      seen={enemy.seen}
                      label={enemy.seen || enemy.dead ? name : `${name} В· ${t("field.enemyUnseen")}`}
                      onFocus={() => {
                        // РљР»РёРє РІРµРґС‘С‚ РєР°РјРµСЂСѓ Рє РїСЂРѕС‚РёРІРЅРёРєСѓ вЂ” РЅРѕ С‚РѕР»СЊРєРѕ Рє С‚РѕРјСѓ,
                        // РєРѕРіРѕ РІРёРґРёС‚ С…РѕС‚СЊ РѕРґРёРЅ Р±РѕРµС† РґСЂСѓР¶РёРЅС‹ (0.20.42).
                        rendererRef.current?.focusEntity?.(enemy.id);
                      }}
                      onInspect={() => {
                        // РћРєРЅРѕ РёРЅС„РѕСЂРјР°С†РёРё Рѕ РїСЂРѕС‚РёРІРЅРёРєРµ: РёР· СЃРЅРёРјРєР° РІРёРґРµРЅ С‚РѕР»СЊРєРѕ
                        // С‚РѕС‚, РєРѕРіРѕ РґСЂСѓР¶РёРЅР° РЅР°Р±Р»СЋРґР°РµС‚ РїСЂСЏРјРѕ СЃРµР№С‡Р°СЃ.
                        const live = knownEnemies.find((candidate) => candidate.id === enemy.id);
                        if (live) setUnitInfo(buildUnitInfo(live, { weapons, skills, side: "enemy" }, t));
                      }}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
          {battleKind === "pvp" ? (
            <div className="pvp-sides-strip" aria-label={t("pvp.objective")}>
              <span className={`pvp-side-emblem is-side1${viewOwner === 1 ? " is-active" : ""}`} aria-hidden="true">
                1
              </span>
              <span className="pvp-side-emblem-sep" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
                  <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
                </svg>
              </span>
              <span className={`pvp-side-emblem is-side2${viewOwner === 2 ? " is-active" : ""}`} aria-hidden="true">
                2
              </span>
            </div>
          ) : null}
          <div className="roster" aria-label={t("field.sidePlayer")}>
            {roster.map((entity) => (
              <RosterCard
                key={entity.id}
                entity={entity}
                selected={entity.id === selectedId}
                name={t(unitNameKey(entity.configId))}
                onSelect={() => {
                  if (entity.dead) return;
                  // РћР±СѓС‡РµРЅРёРµ: РІС‹Р±РѕСЂ РёРЅРѕРіРѕ Р±РѕР№С†Р° Р·Р°РїСЂРµС‰С‘РЅ вЂ” РґРµР№СЃС‚РІСѓРµС‚ С‚РѕР»СЊРєРѕ
                  // РёСЃРїРѕР»РЅРёС‚РµР»СЊ С‚РµРєСѓС‰РµРіРѕ СѓРєР°Р·Р°РЅРёСЏ (СЃС‚СЂРѕРіРёР№ СЃС†РµРЅР°СЂРёР№, 0.20.13).
                  if (isTraining && trainingActorId !== null && entity.id !== trainingActorId) {
                    setLog(t("training.locked.actor"));
                    return;
                  }
                  setIntent({ type: "select", actorId: entity.id });
                  // РљР°РјРµСЂР° РїР»Р°РІРЅРѕ РїСЂРёС…РѕРґРёС‚ Рє РІС‹Р±СЂР°РЅРЅРѕРјСѓ Р±РѕР№С†Сѓ (0.20.42):
                  // РїРѕР»Рµ РєСЂСѓРїРЅРµРµ РѕРєРЅР°, Рё Р±РѕРµС† РјРѕРі СЃС‚РѕСЏС‚СЊ Р·Р° РєР°РґСЂРѕРј.
                  rendererRef.current?.focusEntity?.(entity.id);
                }}
                onInspect={() => setUnitInfo(buildUnitInfo(entity, { weapons, skills, side: "ally" }, t))}
              />
            ))}
          </div>
        </header>

        <div className="battle-mid">
          {saveNotice ? (
            <p className="save-toast" role="status" aria-live="polite">
              <span className="save-toast-mark" aria-hidden="true">
                вњ“
              </span>
              {t("battle.saved")}
            </p>
          ) : null}
          {log ? (
            <p className="battle-log" role="status">
              {log}
            </p>
          ) : null}
          {hit ? (
            <div
              className={`aim-card${aimCardPos ? " is-floating" : ""}`}
              style={aimCardPos ? { left: `${aimCardPos.x}%`, top: `${aimCardPos.y}%` } : undefined}
            >
              <div className="aim-header">
                <span className={`aim-chance${hit.available ? "" : " blocked"}`}>
                  {hit.available
                    ? hit.chance === undefined
                      ? t("combat.available")
                      : `${hit.chance}%`
                    : t("combat.unavailable")}
                </span>
                {hit.available && hit.coverTarget ? (
                  // РђС‚Р°РєР° РїРѕ СЃСѓС‰РЅРѕСЃС‚Рё СѓРєСЂС‹С‚РёСЏ: РїРѕРїР°РґР°РЅРёРµ РЅРµ РёСЃРїС‹С‚С‹РІР°РµС‚СЃСЏ,
                  // СѓРєСЂС‹С‚РёРµ СЂР°Р·СЂСѓС€Р°РµС‚СЃСЏ (В§10.4 math) вЂ” С‡РёСЃР»Р° СѓСЂРѕРЅР° РЅРµ РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ.
                  <span className="aim-dmg cover-destroy">{t("combat.destroyCover")}</span>
                ) : hit.available && hit.dmgMin !== undefined && hit.dmgMax !== undefined ? (
                  <span className="aim-dmg">{t("combat.dmg", { dmg: `${hit.dmgMin}-${hit.dmgMax}` })}</span>
                ) : null}
                {hit.breakdown ? (
                  <button
                    type="button"
                    className="aim-copy-btn"
                    title={t("combat.copyBreakdown")}
                    onClick={() => {
                      const b = hit.breakdown!;
                      const lines = [
                        `в•ђв•ђв•ђ ${t("combat.bdTotal")}: ${b.finalChance}% в•ђв•ђв•ђ`,
                        `${t("combat.bdBaseAim")}: +${b.baseAim}`,
                        b.weaponMod !== 0
                          ? `${t("combat.bdWeaponMod")}: ${b.weaponMod > 0 ? "+" : ""}${b.weaponMod}`
                          : null,
                        b.heightAim !== 0
                          ? `${t("combat.bdHeight")}: ${b.heightAim > 0 ? "+" : ""}${b.heightAim}`
                          : null,
                        b.targetDefense > 0 ? `${t("combat.bdDefense")}: в€’${b.targetDefense}` : null,
                        b.stanceDefense > 0 ? `${t("combat.bdDefend")}: в€’${b.stanceDefense}` : null,
                        b.coverPenalty > 0 ? `${t("combat.bdCover")}: в€’${b.coverPenalty}` : null,
                        b.rangePenalty > 0 ? `${t("combat.bdRange")}: в€’${b.rangePenalty}` : null,
                        b.coverDetails.length > 0 ? "" : null,
                        b.coverDetails.length > 0 ? t("combat.bdObstacleList") : null,
                        ...b.coverDetails.map((d) => `  ${t(d.label)}`),
                      ].filter(Boolean);
                      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                ) : null}
              </div>
              {hit.breakdown ? (
                <div className="breakdown-detail">
                  <span className="bd-item pos">
                    {t("combat.bdBaseAim")}: +{hit.breakdown.baseAim}
                  </span>
                  {hit.breakdown.weaponMod !== 0 ? (
                    <span className={`bd-item${hit.breakdown.weaponMod > 0 ? " pos" : " neg"}`}>
                      {t("combat.bdWeaponMod")}: {hit.breakdown.weaponMod > 0 ? "+" : ""}
                      {hit.breakdown.weaponMod}
                    </span>
                  ) : null}
                  {hit.breakdown.heightAim !== 0 ? (
                    <span className={`bd-item${hit.breakdown.heightAim > 0 ? " pos" : " neg"}`}>
                      {t("combat.bdHeight")}: {hit.breakdown.heightAim > 0 ? "+" : ""}
                      {hit.breakdown.heightAim}
                    </span>
                  ) : null}
                  {hit.breakdown.targetDefense > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdDefense")}: в€’{hit.breakdown.targetDefense}
                    </span>
                  ) : null}
                  {hit.breakdown.stanceDefense > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdDefend")}: в€’{hit.breakdown.stanceDefense}
                    </span>
                  ) : null}
                  {hit.breakdown.coverPenalty > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdCover")}: в€’{hit.breakdown.coverPenalty}
                    </span>
                  ) : null}
                  {hit.breakdown.rangePenalty > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdRange")}: в€’{hit.breakdown.rangePenalty}
                    </span>
                  ) : null}
                  {hit.breakdown.coverDetails.length > 0 ? (
                    <div className="bd-details">
                      <span className="bd-details-title">{t("combat.bdObstacleList")}</span>
                      {hit.breakdown.coverDetails.map((d, i) => (
                        <span key={i} className="bd-obs">
                          {t(d.label)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!hit.available && hit.reason === "NO_LOS" && hit.breakCell ? (
                <div className="bd-details">
                  <span className="bd-obs">
                    {t("combat.blocked.NO_LOS")}: ({hit.breakCell.x},{hit.breakCell.y}) z={hit.breakCell.z}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {isSpectator ? (
          <footer className="battle-bottom spectator-bar">
            <div className="spectator-note" role="status">
              <span className="spectator-eye" aria-hidden="true">
                в—‰
              </span>
              {t("net.spectator")}
              <span className="muted"> вЂ” {t("net.spectatorBody")}</span>
            </div>
          </footer>
        ) : (
          <footer className={`battle-bottom${outcomePending ? " is-outcome-pending" : ""}`}>
            <div className="battle-selected">
              {selected ? (
                <div className="sel-row">
                  {unitPortrait(selected.configId) ? (
                    <img className="sel-face" src={unitPortrait(selected.configId)} alt="" draggable={false} />
                  ) : null}
                  <div className="sel-info">
                    <p className="eyebrow">{t(unitNameKey(selected.configId))}</p>
                    <p>{t("battle.hp", { current: selected.hp, max: selected.maxHp })}</p>
                    <div className="hp-segs" aria-hidden="true">
                      {Array.from({ length: selected.maxHp }, (_, index) => (
                        <i key={index} className={index < selected.hp ? "on" : ""} />
                      ))}
                    </div>
                    <div
                      className={`diamonds${hintPanelKey === "ap" ? " hint-pulse" : ""}`}
                      aria-label={t("field.ap", { current: selected.ap, max: selected.maxAp })}
                    >
                      {Array.from({ length: selected.maxAp }, (_, index) => (
                        <span key={index} className={index < selected.ap ? "diamond is-on" : "diamond"} />
                      ))}
                    </div>
                    <div className="status-list" aria-label={t("battle.statuses")}>
                      {selected.poison ? (
                        <span className="status-chip poison">
                          {t("status.poison", { turns: selected.poison.turnsLeft })}
                        </span>
                      ) : null}
                      {selected.panic ? <span className="status-chip panic">{t("status.panic")}</span> : null}
                      {selected.immobileTurns ? (
                        <span className="status-chip immobile">{t("status.immobile")}</span>
                      ) : null}
                      {selected.hidden ? <span className="status-chip hidden">{t("status.hidden")}</span> : null}
                      {selected.flying ? <span className="status-chip flying">{t("status.flying")}</span> : null}
                      {selected.timedLife !== undefined ? (
                        <span className="status-chip timed">{t("status.timed", { turns: selected.timedLife })}</span>
                      ) : null}
                      {selected.defending ? (
                        <span className="status-chip defending">{t("status.defending")}</span>
                      ) : null}
                      {selected.overwatch ? (
                        <span className="status-chip overwatch">{t("status.overwatch")}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <p>{t("battle.empty")}</p>
              )}
            </div>
            <div className="skill-row">
              {(selected?.weaponIds ?? (selected?.weaponId ? [selected.weaponId] : [])).map((weaponId, index) => {
                const weapon = weapons[weaponId];
                const active = action?.type === "weapon" && action.id === weaponId;
                const info = weapon ? weaponActionInfo(weaponId, weapon, t) : null;
                return (
                  <ActionSlot
                    key={`weapon-${weaponId}`}
                    id={weaponId}
                    name={t(`weapon.${weaponId}.name`)}
                    art={actionArt(weaponId)}
                    shortcut={ACTION_SHORTCUTS[index]}
                    active={active}
                    hinted={hintPanelKey === "weapon" && trainingWeaponAllowed(weaponId)}
                    accent={accentWeaponId === weaponId}
                    disabled={
                      !selected ||
                      selected.ap <= 0 ||
                      busy ||
                      snapshot.activeOwner !== viewOwner ||
                      !trainingWeaponAllowed(weaponId) ||
                      prologueStanceLock
                    }
                    onInspect={info ? () => setActionInfo(info) : undefined}
                    onPress={() => {
                      // Р С‹РІРѕРє СЃС‡РёС‚Р°Р»СЃСЏ РїРѕРґ РїСЂРµР¶РЅРµРµ РѕСЂСѓР¶РёРµ: РїСЂРё РїРµСЂРµРєР»СЋС‡РµРЅРёРё
                      // РґРµР№СЃС‚РІРёСЏ СЃРЅРёРјР°РµС‚СЃСЏ вЂ” toggleAction РІРѕР·РІСЂР°С‰Р°РµС‚ Рє
                      // РІС‹Р±СЂР°РЅРЅРѕРјСѓ Р±РѕР№С†Сѓ Р»РёР±Рѕ РІРѕРѕСЂСѓР¶Р°РµС‚ РЅРѕРІРѕРµ РґРµР№СЃС‚РІРёРµ (0.20.50).
                      if (selectedId !== null)
                        setIntent({
                          type: "toggleAction",
                          actorId: selectedId,
                          action: active ? null : { type: "weapon", id: weaponId },
                        });
                    }}
                  />
                );
              })}
              {(selected?.skillIds ?? []).map((skillId) => {
                const skill = skills[skillId];
                const active = action?.type === "skill" && action.id === skillId;
                const shortcut = selected ? shortcutForAction(selected, "skill", skillId) : undefined;
                const cooldown = selected?.skillCooldowns?.[skillId] ?? 0;
                const uses = selected?.skillUses?.[skillId] ?? 0;
                const usesLeft =
                  skill?.maxUsesPerBattle === undefined ? undefined : Math.max(0, skill.maxUsesPerBattle - uses);
                const exhausted = usesLeft === 0;
                const info = skill ? skillActionInfo(skillId, skill, t) : null;
                return (
                  <ActionSlot
                    key={`skill-${skillId}`}
                    id={skillId}
                    name={t(`skill.${skillId}.name`)}
                    art={actionArt(skillId)}
                    shortcut={shortcut}
                    active={active}
                    hinted={hintPanelKey === "skill" && trainingSkillAllowed(skillId)}
                    cooldown={cooldown}
                    usesLeft={usesLeft}
                    title={
                      cooldown > 0
                        ? t("battle.cooldownHint", { turns: cooldown })
                        : exhausted
                          ? t("battle.noUsesHint")
                          : undefined
                    }
                    disabled={
                      !selected ||
                      selected.ap < (skill?.apCost ?? 1) ||
                      cooldown > 0 ||
                      exhausted ||
                      busy ||
                      snapshot.activeOwner !== viewOwner ||
                      !trainingSkillAllowed(skillId) ||
                      prologueStanceLock
                    }
                    onInspect={info ? () => setActionInfo(info) : undefined}
                    onPress={() => {
                      // Р С‹РІРѕРє СЃС‡РёС‚Р°Р»СЃСЏ РїРѕРґ РїСЂРµР¶РЅРµРµ РґРµР№СЃС‚РІРёРµ: РїРµСЂРµРєР»СЋС‡РµРЅРёРµ
                      // РґРµР№СЃС‚РІРёСЏ РµРіРѕ СЃРЅРёРјР°РµС‚ (0.20.50, С‡РµСЂРµР· toggleAction).
                      // Р­С‚Р°Рї-РїСЂР°РІРєР°: СѓРјРµРЅРёРµ В«РЅР° СЃРµР±СЏВ» СЃ РѕР±Р»Р°СЃС‚СЊСЋ (РєСЂСѓРіРѕРІРѕР№ РІР·РјР°С…)
                      // РїРѕРґС‚РІРµСЂР¶РґР°РµС‚СЃСЏ РІС‚РѕСЂС‹Рј С‚Р°РїРѕРј вЂ” РїРµСЂРІС‹Р№ РїРѕРєР°Р·С‹РІР°РµС‚ РѕР±Р»Р°СЃС‚СЊ.
                      if (skill?.category === "self") {
                        if ((skill.radius ?? 0) > 0) {
                          const alreadyArmed = action?.type === "skill" && action.id === skillId;
                          if (alreadyArmed) applySelfSkill(skillId);
                          else if (selectedId !== null)
                            setIntent({
                              type: "toggleAction",
                              actorId: selectedId,
                              action: { type: "skill", id: skillId },
                            });
                        } else {
                          applySelfSkill(skillId);
                        }
                      } else if (selectedId !== null) {
                        setIntent({
                          type: "toggleAction",
                          actorId: selectedId,
                          action: active ? null : { type: "skill", id: skillId },
                        });
                      }
                    }}
                  />
                );
              })}
              {liberatable ? (
                <ActionSlot
                  id="free"
                  name={t("battle.free")}
                  art={actionArt("free")}
                  active={false}
                  disabled={
                    !selected ||
                    selected.ap < 1 ||
                    busy ||
                    snapshot.activeOwner !== viewOwner ||
                    prologueStanceLock
                  }
                  title={t("battle.freeHint")}
                  onInspect={() => setActionInfo(liberateActionInfo(t))}
                  onPress={applyLiberate}
                />
              ) : null}
              <ActionSlot
                id="defend"
                name={t("battle.defend")}
                art={actionArt("defend")}
                shortcut="9"
                active={Boolean(selected?.defending)}
                hinted={hintPanelKey === "defend"}
                disabled={
                  !selected ||
                  selected.ap <= 0 ||
                  busy ||
                  snapshot.activeOwner !== viewOwner ||
                  !trainingAllows("defend")
                }
                title={t("battle.defendHint")}
                onInspect={() => setActionInfo(stanceActionInfo("defend", t))}
                onPress={() => {
                  if (selectedId === null) return;
                  // Р•РґРёРЅС‹Р№ РїСѓС‚СЊ РєРѕРјР°РЅРґ (0.19.2): РєР°Рє Рё РєР»Р°РІРёС€Р° 9 вЂ” С‡РµСЂРµР·
                  // applyCommand (С‚СЂР°РЅСЃРїРѕСЂС‚ РІ СЃРѕСЃС‚СЏР·Р°С‚РµР»СЊРЅРѕРј СЂРµР¶РёРјРµ, Р°РЅРёРјР°С†РёСЏ
                  // Рё РїСЂРѕРґРІРёР¶РµРЅРёРµ РїРѕРґСЃРєР°Р·РєРё РІ РѕР±СѓС‡РµРЅРёРё).
                  applyCommand({ type: "DEFEND", actorId: selectedId });
                  setIntent({ type: "cancel" });
                }}
              />
              <ActionSlot
                id="overwatch"
                name={t("battle.overwatch")}
                art={actionArt("overwatch")}
                shortcut="0"
                active={Boolean(selected?.overwatch)}
                hinted={hintPanelKey === "overwatch"}
                disabled={
                  !selected ||
                  selected.ap <= 0 ||
                  busy ||
                  snapshot.activeOwner !== viewOwner ||
                  !trainingAllows("overwatch") ||
                  prologueStanceLock
                }
                title={t("battle.overwatchHint")}
                onInspect={() => setActionInfo(stanceActionInfo("overwatch", t))}
                onPress={() => {
                  if (selectedId === null) return;
                  // Р•РґРёРЅС‹Р№ РїСѓС‚СЊ РєРѕРјР°РЅРґ (0.19.2): РєР°Рє Рё РєР»Р°РІРёС€Р° 0 вЂ” С‡РµСЂРµР·
                  // applyCommand (С‚СЂР°РЅСЃРїРѕСЂС‚ РІ СЃРѕСЃС‚СЏР·Р°С‚РµР»СЊРЅРѕРј СЂРµР¶РёРјРµ, Р°РЅРёРјР°С†РёСЏ
                  // Рё РїСЂРѕРґРІРёР¶РµРЅРёРµ РїРѕРґСЃРєР°Р·РєРё РІ РѕР±СѓС‡РµРЅРёРё).
                  applyCommand({ type: "OVERWATCH", actorId: selectedId });
                  setIntent({ type: "cancel" });
                }}
              />
            </div>
            <button
              type="button"
              className={`hud-btn hud-btn-primary end-turn${allOwnApSpent(snapshot.entities, viewOwner) ? " is-ready" : ""}${hintPanelKey === "end_turn" ? " hint-pulse" : ""}`}
              // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅР°СЏ СЃС‚РѕР№РєР° Р·Р°РєСЂС‹РІР°РµС‚ Рё В«РљРѕРЅРµС† С…РѕРґР°В» (0.20.45):
              // РёРЅР°С‡Рµ РёРіСЂРѕРє СѓС…РѕРґРёР» Р±С‹ РѕС‚ Р·Р°СЃР°РґС‹ С†РµРЅРѕР№ РїСЂРѕРїСѓС‰РµРЅРЅРѕРіРѕ СѓСЂРѕРєР°.
              disabled={busy || snapshot.activeOwner !== viewOwner || !trainingAllows("endTurn") || prologueStanceLock}
              onClick={() => endTurn()}
            >
              {t("field.endTurn")}
            </button>
          </footer>
        )}
      </div>

      {enemyPhase ? (
        <div className="phase-banner" role="status">
          {t("battle.enemyTurn")}
        </div>
      ) : null}

      {battleKind === "pvp" && !passReady ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="pass-title">
            <p className="eyebrow">{t("pvp.passHint")}</p>
            <h2 id="pass-title" className="pass-side-title">
              {viewOwner === 1 ? t("pvp.side1") : t("pvp.side2")}
            </h2>
            <p className="muted">{t("pvp.passBody")}</p>
            <button type="button" className="hud-btn hud-btn-primary pass-ready-btn" onClick={() => setPassReady(true)}>
              {t("pvp.ready")}
            </button>
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && !session.getNetSnapshot() ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-sync-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-sync-title" className="pass-side-title">
              {t("net.syncing")}
            </h2>
            <p className="muted">{t("net.syncingBody")}</p>
            <span className="net-sync-spinner" aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && session.getNetSnapshot() && snapshot.activeOwner !== viewOwner ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-wait-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-wait-title" className="pass-side-title">
              {t("net.opponentTurn")}
            </h2>
            <p className="muted">{t("net.waitBody")}</p>
          </div>
        </div>
      ) : null}

      {netDisconnected ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-lost-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-lost-title" className="pass-side-title">
              {t("net.connectionLost")}
            </h2>
            <p className="muted">
              {disconnectLeft > 0 ? t("net.reconnectIn", { seconds: disconnectLeft }) : t("net.reconnectExpired")}
            </p>
            <div className="net-lost-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // РЎРѕС…СЂР°РЅРµРЅРёРµ РїРѕРІС‚РѕСЂР° РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ СЃР»РѕРµРј РїСЂРёР»РѕР¶РµРЅРёСЏ (persistRef).
                  session.finishReplayDraft(null);
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.saveReplay")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.leaveRoom")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isPrologue && prologueCard && prologueMission ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card training-over-card" role="dialog" aria-modal="true">
            <p className="eyebrow">{t(prologueMission.titleKey)}</p>
            <h2>{prologueCard === "intro" ? t(prologueMission.introKey) : t(prologueMission.outroKey)}</h2>
            <button
              type="button"
              className="hud-btn hud-btn-primary"
              onClick={() => {
                if (prologueCard === "intro") {
                  prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
                    type: "skip_cutscene",
                    missionId: prologueMission.id,
                  });
                  setPrologueCard(null);
                  // Р”Р°Р»СЊС€Рµ РєР°РґСЂРѕРј СѓРїСЂР°РІР»СЏРµС‚ СЃС†РµРЅР° РјРёСЃСЃРёРё: РіРµСЂРѕР№ в†’ С†РµР»СЊ в†’ РіРµСЂРѕР№,
                  // Рё С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ СЌС‚РѕРіРѕ РёРіСЂРѕРє РїРѕР»СѓС‡Р°РµС‚ СѓРїСЂР°РІР»РµРЅРёРµ (В§13.4).
                  void director.runCutscene({ type: "missionStart" });
                  return;
                }
                const nextId = prologueMission.nextMissionId ?? null;
                if (prologueRunRef.current?.outcome === "defeat") {
                  prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
                    type: "restart_pressed",
                    missionId: prologueMission.id,
                  });
                  session.startPrologue(prologueMission.id, true);
                  return;
                }
                session.advancePrologue(nextId);
              }}
            >
              {t(
                prologueCard === "intro"
                  ? "common.ok"
                  : prologueMission.nextMissionId && prologueMission.id === "prologue_brushwood"
                    ? "prologue.next.toCry"
                    : "prologue.next.toMap",
              )}
            </button>
          </div>
        </div>
      ) : null}

      {storyNote ? (
        // РЎСЋР¶РµС‚РЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ (0.20.52): РѕРєРЅРѕ РїРѕРІРµСЂС… РїРѕР»СЏ, Р·Р°РєСЂС‹РІР°РµС‚СЃСЏ
        // РєРЅРѕРїРєРѕР№ Р»РёР±Рѕ С‰РµР»С‡РєРѕРј РїРѕ С„РѕРЅСѓ; РєРЅРѕРїРєРё РїР°РЅРµР»Рё РѕРЅРѕ РЅРµ Р·Р°РґРµРІР°РµС‚.
        // РЎ 0.21.21 Р·РґРµСЃСЊ Р¶Рµ С‡РёС‚Р°СЋС‚СЃСЏ СЃСЋР¶РµС‚РЅС‹Рµ РїРѕРґСЃРєР°Р·РєРё РїСЂРѕР»РѕРіР° вЂ” РїР»Р°С€РєР°
        // `.training-note` РїРѕРґ РЅРёРјРё СѓР±СЂР°РЅР°, С‡С‚РѕР±С‹ РЅРµ Р»РѕР¶РёС‚СЊСЃСЏ РЅР° РєРЅРѕРїРєСѓ
        // Р·Р°С‰РёС‚РЅРѕР№ СЃС‚РѕР№РєРё.
        <div className="pause-root story-note-root" role="presentation" onClick={closeStoryNote}>
          <div
            className="pause-card story-note-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-note-text"
            onClick={(event) => event.stopPropagation()}
          >
            {isPrologue && prologueMission ? <p className="eyebrow">{t(prologueMission.titleKey)}</p> : null}
            <p id="story-note-text" className="story-note-text">
              {storyNote}
            </p>
            <button type="button" className="hud-btn hud-btn-primary" onClick={closeStoryNote}>
              {t("common.ok")}
            </button>
          </div>
        </div>
      ) : null}

      {cutscenePlaying ? (
        <button type="button" className="cutscene-skip" onClick={director.skip}>
          {t("battle.cutscene.skip")}
        </button>
      ) : null}

      {isTraining && trainingOver ? (
        <div className="pause-root" role="presentation">
          <div
            className="pause-card training-over-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-over-title"
          >
            <p className="eyebrow">{trainingMission ? t(trainingMission.titleKey) : t("training.title")}</p>
            <h2 id="training-over-title">
              {trainingOver === "victory" ? t("training.over.victory") : t("training.over.defeat")}
            </h2>
            <p className="muted">
              {trainingOver === "victory" ? t("training.over.victoryBody") : t("training.over.defeatBody")}
            </p>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.goTo("training")}>
              {t("training.over.back")}
            </button>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <h2 id="pause-title">{t("battle.pause")}</h2>
            <details className="controls-help">
              <summary>{t("battle.controlsTitle")}</summary>
              <ul>
                <li>
                  <kbd>1вЂ“8</kbd> {t("battle.controls.weapons")}
                </li>
                <li>
                  <kbd>9</kbd> {t("battle.controls.defend")}
                </li>
                <li>
                  <kbd>0</kbd> {t("battle.controls.overwatch")}
                </li>
                <li>
                  <kbd>Tab</kbd> {t("battle.controls.next")}
                </li>
                <li>
                  <kbd>Esc</kbd> {t("battle.controls.pause")}
                </li>
                <li>{t("battle.controls.touch")}</li>
              </ul>
            </details>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.setPaused(false)}>
              {t("battle.resume")}
            </button>
            {battleKind === "campaign" ? (
              // В«Рљ РєР°СЂС‚Рµ РєРѕСЂР°Р±Р»СЏВ» РїСЂРёРѕСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ РјРёСЃСЃРёСЋ, РЅРµ РїРѕРєРёРґР°СЏ РµС‘
              // (0.20.18): РЅР° РєР°СЂС‚Рµ РјРѕР¶РЅРѕ РІРµСЂРЅСѓС‚СЊСЃСЏ РІ РјРёСЃСЃРёСЋ РёР»Рё РѕСЃРѕР·РЅР°РЅРЅРѕ
              // РїРѕРєРёРЅСѓС‚СЊ РµС‘; В«РџСЂРѕРґРѕР»Р¶РёС‚СЊВ» РјРµРЅСЋ С‚РѕР¶Рµ РІРѕР·РІСЂР°С‰Р°РµС‚ РІ Р±РѕР№.
              <button type="button" className="hud-btn" onClick={() => session.suspendCampaignMission()}>
                {t("battle.toCampaignMap")}
              </button>
            ) : null}
            <button
              type="button"
              className="hud-btn"
              onClick={() => {
                // Р’С‹С…РѕРґ РІ РјРµРЅСЋ РёР· Р±РѕСЏ РєР°РјРїР°РЅРёРё РџР РРћРЎРўРђРќРђР’Р›РР’РђР•Рў РјРёСЃСЃРёСЋ
                // (0.20.17): suspendCampaignBattle СЃР°Рј РїРµСЂРµРІРѕРґРёС‚ РІ РјРµРЅСЋ,
                // СЃРѕС…СЂР°РЅСЏСЏ СЃРЅРёРјРѕРє РїР°СЂС‚РёРё РІ СЃРµСЃСЃРёРё вЂ” В«РџСЂРѕРґРѕР»Р¶РёС‚СЊВ» РіР»Р°РІРЅРѕРіРѕ
                // РјРµРЅСЋ РІРѕР·РІСЂР°С‰Р°РµС‚ РІ Р±РѕР№. РџРѕРєРёРЅСѓС‚СЊ РјРёСЃСЃРёСЋ РјРѕР¶РЅРѕ РѕСЃРѕР·РЅР°РЅРЅРѕ вЂ”
                // РєРЅРѕРїРєРѕР№ В«Рљ РєР°СЂС‚Рµ РєРѕСЂР°Р±Р»СЏВ». РРЅС‹Рµ Р±РѕРё РІС‹С…РѕРґСЏС‚ РІ РјРµРЅСЋ РєР°Рє
                // РїСЂРµР¶РґРµ (РёС… РїР°СЂС‚РёСЏ СЌС„РµРјРµСЂРЅР°).
                if (battleKind === "campaign" || battleKind === "prologue") session.suspendCampaignBattle();
                else session.goTo("menu");
              }}
            >
              {t("battle.toMenu")}
            </button>
          </div>
        </div>
      ) : null}
      {/* РћРєРЅРѕ РёРЅС„РѕСЂРјР°С†РёРё Рѕ РґРµР№СЃС‚РІРёРё: РїРѕРІРµСЂС… Р±РѕСЏ, РІСЃС‘ РѕСЃС‚Р°Р»СЊРЅРѕРµ Р·Р°С‚РµРјРЅРµРЅРѕ. */}
      {actionInfo ? <ActionInfoDialog info={actionInfo} onClose={() => setActionInfo(null)} /> : null}
      {/* РћРєРЅРѕ РёРЅС„РѕСЂРјР°С†РёРё Рѕ Р±РѕР№С†Рµ: РїРѕСЂС‚СЂРµС‚, РѕРїРёСЃР°РЅРёРµ, РїР°СЂР°РјРµС‚СЂС‹ Рё СЌРєРёРїРёСЂРѕРІРєР°. */}
      {unitInfo ? <UnitInfoDialog info={unitInfo} onClose={() => setUnitInfo(null)} /> : null}
    </div>
  );
}
