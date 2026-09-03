import { useCallback, useEffect, useRef, useState } from "react";
import { compilePrologueLayout, dismissPrologueHint } from "@bylina/core";
import type { TacticsKernel } from "@bylina/core";
import {
  afterPrologueApply,
  buildPrologueContext,
  createPrologueRunState,
  createTelemetryLog,
  recordTelemetry,
  type PrologueRunState,
  type TelemetryLog,
} from "../prologue-battle.js";
import { usePrologueDirector } from "../prologue-director.js";
import type { LayoutMarkers } from "../prologue-cutscene.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattlePrologueState(
  base: BattleScreenBase,
  kinds: BattleKinds,
  kernel: TacticsKernel | null,
  snapshotModel: BattleSnapshotModel,
  handOffTurnToEnemyFn: () => Promise<void>,
  announceFn: (events: import("@bylina/core").GameEvent[]) => void,
  setIntentFn: (event: import("../battle-intent.js").IntentEvent) => void,
) {
  const {
    session,
    content,
    hintSettings,
    t,
    setLog,
    outcomeGate,
    firedCutscenesRef,
    setPrologueStanceLock,
    setStoryNote,
    setStoryNoteHintKey,
    storyNoteHintKey,
    setCutscenePlaying,
    setBusy,
  } = base;

  const { isPrologue, prologueMission } = kinds;

  const prologueRunRef = useRef<PrologueRunState | null>(
    isPrologue && prologueMission ? createPrologueRunState(prologueMission.id) : null,
  );

  /**
   * Исход, которым распоряжается сцена (0.20.45).
   *
   * В прологе общее правило «противников не осталось» неприменимо: крысы
   * М2 выходят с пометкой «не для истребления» и по общему правилу бой
   * считался бы выигранным в ту же секунду, когда они выбежали, — ход
   * Нави не начинался бы вовсе, и партия вставала. В прологе исход
   * объявляет контроллер миссии: М2 выигрывается эвакуацией обоих.
   */
  const battleOutcome = useCallback((): "ongoing" | "victory" | "defeat" => {
    if (!isPrologue) return session.getBattleOutcome();
    return prologueRunRef.current?.outcome ?? "ongoing";
  }, [isPrologue, session]);

  const prologueTelemetryRef = useRef<TelemetryLog>(createTelemetryLog());

  const [prologueObjectiveKey, setPrologueObjectiveKey] = useState(
    prologueRunRef.current?.objectiveKey ?? "prologue.objective.gather",
  );

  /**
   * Карточка вступления/итога миссии пролога: открывается вначале (intro) и
   * после завершения (outro). Закрытие вступительной карточки запускает
   * кинематическую сцену миссии. Закрытие итоговой переводит к следующей
   * миссии или к карте.
   */
  const [prologueCard, setPrologueCard] = useState<"intro" | "outro" | null>(isPrologue ? "intro" : null);

  /**
   * Ключ текущей подсказки пролога, которую показывает окно `storyNote`
   * (0.21.21). Назначается сценой, закрытие окна снимает реплику с очереди.
   */
  const [prologueHintKey, setPrologueHintKey] = useState<string | null>(null);

  /**
   * Маркеры авторской раскладки миссии: сцена ссылается на палку или точку
   * выхода крысы символом, средство отображения получает уже клетку.
   */
  const prologueMarkers = (() => {
    if (!prologueMission?.map.layout) return null;
    return compilePrologueLayout(prologueMission.map.layout).markers;
  })();

  // Показать сюжетное сообщение окном (0.20.52): строка журнала гасится,
  // чтобы короткая реплика боя не соседствовала с карточкой.
  const showStoryNote = useCallback(
    (text: string): void => {
      setLog(null);
      setStoryNoteHintKey(null);
      setStoryNote(text);
    },
    [setLog, setStoryNote, setStoryNoteHintKey],
  );

  /** Ключ текущей подсказки пролога: принудённая либо первая в очереди. */
  const currentPrologueHintKey = useCallback((): string | null => {
    const hints = prologueRunRef.current?.hints;
    if (!hints) return null;
    return hints.forcedKey ?? hints.queue[0] ?? null;
  }, []);

  /**
   * Показать сюжетную подсказку пролога отдельным окном (0.21.21).
   *
   * Раньше такие реплики ложились плашкой `.training-note` у нижнего края —
   * она вставала поверх кнопки защитной стойки и мешала нажать действие.
   * Теперь реплика читается в том же окне, что вступление и итог миссии,
   * а кнопка стойки остаётся свободной после закрытия.
   */
  const showPrologueHint = useCallback(
    (key: string): void => {
      const textKey = content.prologueHints.hints.find((hint) => hint.key === key)?.textKey ?? key;
      setLog(null);
      setStoryNoteHintKey(key);
      setStoryNote(t(textKey));
    },
    [content, setLog, setStoryNote, setStoryNoteHintKey, t],
  );

  /**
   * Закрыть окно сообщения. Окно подсказки пролога отличается от обычной
   * реплики: одноразовая реплика снимается с очереди, чтобы следующая
   * показалась своим окном, — а принудённую (стойка М2) оставляет жить до действия
   * сцены — закрытие только прячет текст, а кнопка стойки по-прежнему
   * единственно доступна, и иное действие вновь откроет сообщение.
   */
  const closeStoryNote = useCallback((): void => {
    const key = storyNoteHintKey;
    setStoryNote(null);
    setStoryNoteHintKey(null);
    if (!key || !isPrologue || !prologueRunRef.current) return;
    // Принуждённая подсказка живёт, пока сцена не отпустит ход: её закрытие
    // не снимает замок действий.
    if (prologueRunRef.current.hints.forcedKey === key) return;
    const next = dismissPrologueHint(prologueRunRef.current, key);
    prologueRunRef.current = next;
    const nextKey = next.hints.forcedKey ?? next.hints.queue[0] ?? null;
    if (nextKey !== prologueHintKey) setPrologueHintKey(nextKey);
  }, [isPrologue, prologueHintKey, storyNoteHintKey, setStoryNote, setStoryNoteHintKey]);

  /**
   * Показ подсказки пролога отдельным окном (0.21.21): как только сцена
   * назначает реплику (`prologueHintKey`), она открывается тем же окном,
   * что вступление и итог миссии. Принудённая стойка закрывается, когда
   * ход отпущен, — текст больше не висит над кнопкой.
   */
  const seenPrologueHintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPrologue || prologueCard) {
      seenPrologueHintRef.current = null;
      // Вступительная карточка либо итог миссии открыты — окно реплики
      // уступает им экран (0.21.21).
      if (storyNoteHintKey) {
        setStoryNote(null);
        setStoryNoteHintKey(null);
      }
      return;
    }
    if (!prologueHintKey) {
      seenPrologueHintRef.current = null;
      // Ход отпущен (стойка принята) — окно реплики закрыть, если оно
      // показывало подсказку, а не обычное сообщение сцены.
      if (storyNoteHintKey) {
        setStoryNote(null);
        setStoryNoteHintKey(null);
      }
      return;
    }
    if (seenPrologueHintRef.current === prologueHintKey) return;
    seenPrologueHintRef.current = prologueHintKey;
    showPrologueHint(prologueHintKey);
  }, [isPrologue, prologueCard, prologueHintKey, storyNoteHintKey, showPrologueHint, setStoryNote, setStoryNoteHintKey]);

  // Режиссёр сцен пролога (0.20.67): восемь постановщиков, деливших общие
  // ссылки состояния, собраны отдельно. Зависимости читаются из ссылки,
  // поэтому постановщики стабильны, а замыкания в них — свежие.
  const director = usePrologueDirector({
    session,
    content,
    hintSettings,
    isPrologue,
    mission: prologueMission ?? null,
    markers: prologueMarkers as LayoutMarkers | null,
    kernel,
    runRef: prologueRunRef,
    telemetryRef: prologueTelemetryRef,
    firedRef: firedCutscenesRef,
    renderer: () => base.rendererRef.current,
    handOffTurn: () => handOffTurnToEnemyFn(),
    showStoryNote,
    translate: t,
    setCutscenePlaying,
    setBusy,
    setPrologueStanceLock,
    setPrologueObjectiveKey,
    setPrologueHintKey,
    resetSelection: () => {
      setIntentFn({ type: "clearSelection" });
    },
    announce: announceFn,
    battleOutcome,
    outcomeGate,
    setPrologueCard,
  });

  return {
    prologueRunRef,
    prologueTelemetryRef,
    prologueObjectiveKey,
    setPrologueObjectiveKey,
    prologueCard,
    setPrologueCard,
    prologueHintKey,
    setPrologueHintKey,
    prologueMarkers,
    battleOutcome,
    showStoryNote,
    showPrologueHint,
    closeStoryNote,
    currentPrologueHintKey,
    director,
    // Экспортируем функции из prologue-battle для использования в CommandCenter и EnemyTurn
    afterPrologueApply,
    buildPrologueContext,
    recordTelemetry,
  };
}

export type BattlePrologueModel = ReturnType<typeof useBattlePrologueState>;
