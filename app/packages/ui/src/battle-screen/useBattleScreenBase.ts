import { useRef, useState } from "react";
import type { FieldRenderer } from "@bylina/render";
import type { TrainingEnemyScriptState } from "@bylina/core";

import { useServices, useT } from "../context.js";
import { useI18nTick, useSessionState, useSettingsState } from "../hooks.js";
import { useBattleInput } from "../useBattleInput.js";
import { createOutcomeGate, type OutcomeGate } from "../outcome-gate.js";
import type { ActionInfo } from "../action-info.js";
import type { UnitInfo } from "../unit-info.js";

export function useBattleScreenBase() {
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
    campaignHintsDone,
  } = useSessionState();

  const hintSettings = useSettingsState();
  const inputRef = useBattleInput();

  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);

  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enemyPhase, setEnemyPhase] = useState(false);
  // Готовность средства отображения: перерисовка после асинхронного монтажа,
  // чтобы эффекты, читающие rendererRef, увидели готовый рендер. Не связано с ревизией боя.
  const [rendererReady, setRendererReady] = useState(false);
  // Кинематографическая сцена (0.20.37): пока идёт, ввод игрока закрыт и на
  // экране доступна кнопка пропуска (campaign.md §1.8).
  const [cutscenePlaying, setCutscenePlaying] = useState(false);
  /**
   * Исход известен, но ещё не показан (0.20.40): от момента последнего
   * события до карточки итога кнопки управления скрыты, а управление
   * закрыто — иначе игрок успевает нажать лишнее в кадре, который
   * принадлежит проигрыванию боя.
   */
  const [outcomePending, setOutcomePending] = useState(false);
  const [fastPace, setFastPace] = useState(false);
  const [saveNotice, setSaveNotice] = useState(false);
  const [passReady, setPassReady] = useState(false);
  const [actionInfo, setActionInfo] = useState<ActionInfo | null>(null);
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null);
  /**
   * Сюжетное сообщение (0.20.52): реплика миссии, которую игроку нужно
   * прочесть. Прежде такие тексты уходили в строку журнала над панелью
   * действий и перекрывали кнопки — теперь это отдельное окно, как
   * вступление и итог миссии.
   */
  const [storyNote, setStoryNote] = useState<string | null>(null);
  /**
   * Ключ подсказки пролога, которую показывает открытое окно `storyNote`
   * (0.21.21). `null`, если окно открыто обычной репликой сцены (Летописец
   * после гибели). Закрытие окна, показывающего подсказку, снимает одноразовую
   * реплику с очереди — но сохранение принудительной подсказки.
   */
  const [storyNoteHintKey, setStoryNoteHintKey] = useState<string | null>(null);
  /** Персонаж сюжетного окна (портрет Летописца при повторе миссии). */
  const [storyNotePersona, setStoryNotePersona] = useState<string | null>(null);
  /**
   * Принудительная стойка М2 (0.20.45): после первого потраченного ОД хода
   * героя принадлежит защитной стойке. Кнопка стойки пульсирует, остальные
   * действия закрыты — включая «Конец хода». Единственное принуждение
   * пролога (campaign.md §1.1), поэтому состояние живёт ровно один ход.
   */
  const [prologueStanceLock, setPrologueStanceLock] = useState(false);
  /**
   * Сцены, уже сыгранные в этом бою (0.20.45). Сцена с `once` повторно не
   * выбирается: триггер `onSpawn` срабатывает на каждое появление, и
   * первая пара крыс М2 играется один раз, а волны — общей сценой стаи.
   */
  const firedCutscenesRef = useRef<Set<string>>(
    new Set(session.get().restoredPrologueProgress?.firedCutscenes ?? []),
  );

  /**
   * Позиция в очереди сценария Нави (0.20.13): живёт на время боя, очередь
   * с маркерами конца хода читается последовательно.
   */
  const enemyScriptRef = useRef<TrainingEnemyScriptState>({ index: 0 });

  const outcomeGateRef = useRef<OutcomeGate | null>(null);

  if (outcomeGateRef.current === null) {
    outcomeGateRef.current = createOutcomeGate({
      onPendingChange: setOutcomePending,
    });
  }

  const outcomeGate = outcomeGateRef.current;

  return {
    t,
    session,
    content,
    debug,

    paused,
    difficulty,
    battleKind,
    activeMissionId,
    deployment,
    matchSeed,
    trainingDoneMissions,
    campaignHintsDone,
    hintSettings,

    hostRef,
    rendererRef,
    inputRef,

    log,
    setLog,
    busy,
    setBusy,
    enemyPhase,
    setEnemyPhase,
    rendererReady,
    setRendererReady,
    cutscenePlaying,
    setCutscenePlaying,
    outcomePending,
    outcomeGate,
    fastPace,
    setFastPace,
    saveNotice,
    setSaveNotice,
    passReady,
    setPassReady,

    actionInfo,
    setActionInfo,
    unitInfo,
    setUnitInfo,

    storyNote,
    setStoryNote,
    storyNoteHintKey,
    setStoryNoteHintKey,
    storyNotePersona,
    setStoryNotePersona,

    prologueStanceLock,
    setPrologueStanceLock,

    firedCutscenesRef,
    enemyScriptRef,
  };
}

export type BattleScreenBase = ReturnType<typeof useBattleScreenBase>;
