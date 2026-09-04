/**
 * Режиссёр сцен пролога (0.20.67).
 *
 * Восемь постановщиков — проигрывание кинематографической сцены, скрытие и
 * выход сущностей появления, открытие зоны эвакуации, повтор миссии с начала
 * после гибели, пропуск сцены, сценарий хода героя — жили в экране боя: сто
 * восемьдесят строк, которые делят общие ссылки состояния и вызывают друг
 * друга. Экран от них не зависит ничем, кроме вызовов, поэтому они собраны
 * здесь, а экран получил обратно один объект.
 *
 * Хук, а не модуль: постановщики держат состояние между вызовами (какие
 * сцены уже проиграны, где стоит сценарий миссии) — оно принадлежит экрану
 * и приходит ссылками. Зависимости читаются через `useLatest`, поэтому
 * замыкания остаются свежими, а сами постановщики стабильны: эффект,
 * вызвавший сцену при монтировании, не держит устаревшую функцию.
 */

import {
  PLAYER_OWNER,
  pickCutscene,
  withCutsceneDefaults,
  type CutsceneEvent,
  type GameEvent,
  type TacticsKernel,
} from "@bylina/core";
import type { FieldRenderer } from "@bylina/render";
import { useMemo } from "react";
import { useLatest } from "./hooks.js";
import type { OutcomeGate } from "./outcome-gate.js";
import {
  afterPrologueApply,
  buildPrologueContext,
  revealPrologueExtract,
  takePrologueSpawnEvents,
  tickProloguePlayerTurn,
  recordTelemetry,
  type PrologueRunState,
  type TelemetryLog,
} from "./prologue-battle.js";
import {
  buildCinematicPlan,
  splitAtHandOff,
  splitSpawnEvents,
  stagedEntityIds,
  type LayoutMarkers,
} from "./prologue-cutscene.js";
import type { AppServices } from "./context.js";

/**
 * Миссия пролога в том виде, в каком её принимает сценарий: обе копии
 * содержимого в рабочем пространстве объявляют тип миссии порознь, поэтому
 * имя типа брать нельзя — берём его от функции, которой миссию передаём.
 */
type Mission = Parameters<typeof buildPrologueContext>[0];

/** Всё, чем постановщики пользуются из экрана боя. */
export interface PrologueDirectorDeps {
  session: AppServices["session"];
  content: AppServices["content"];
  hintSettings: { showHints: boolean };
  isPrologue: boolean;
  mission: Mission | null;
  /** Точки расстановки сцен: выходы, засады, точки интереса. */
  markers: LayoutMarkers | null;
  kernel: TacticsKernel | null;
  /** Состояние сцены миссии: сценарий, подсказки, вехи. */
  runRef: { current: PrologueRunState | null };
  /** Журнал телеметрии обучения миссии. */
  telemetryRef: { current: TelemetryLog };
  /** Сцены, проигранные в этой миссии (для `once`). */
  firedRef: { current: Set<string> };
  /** Средство отображения поля: камера, проигрывание, затемнение. */
  renderer: () => FieldRenderer | null;
  /** Передать ход противнику посреди сцены (шаг `handOff`, 0.20.40). */
  handOffTurn: () => Promise<void>;
  /** Показать сюжетное сообщение окном (0.20.52). Promise ждёт нажатия «ОК». */
  showStoryNote: (text: string, options?: { persona?: string }) => Promise<void>;
  translate: (key: string) => string;
  setCutscenePlaying: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  setPrologueStanceLock: (value: boolean) => void;
  setPrologueSkillLock: (value: string | null) => void;
  setPrologueObjectiveKey: (key: string) => void;
  setPrologueHintKey: (key: string | null) => void;
  /** Снять выбор, действие и прицел: после отката они недействительны. */
  resetSelection: () => void;
  /** Объявить события боя строкой журнала. */
  announce: (events: GameEvent[]) => void;
  battleOutcome: () => "ongoing" | "victory" | "defeat";
  outcomeGate: OutcomeGate;
  setPrologueCard: (card: "intro" | "outro" | null) => void;
}

/** Постановщики сцен пролога. */
export interface PrologueDirector {
  /** Проиграть кинематографическую сцену по событию-триггеру. */
  runCutscene: (event: CutsceneEvent, revealIds?: readonly number[]) => Promise<void>;
  /** Скрыть сущности, чьё появление ставит сцена (0.20.39). */
  hideSpawns: (events: readonly GameEvent[]) => void;
  /** Разыграть появления: обычные событиями, постановочные — сценой. */
  runSpawnBeats: (events: readonly GameEvent[]) => Promise<void>;
  /** Открыть зону эвакуации после сцены стаи (0.20.45). */
  revealExtractBeat: () => Promise<void>;
  /** Повтор миссии с начала: портрет Летописца, затемнение, новый запуск. */
  restartMission: () => Promise<void>;
  /** Пропустить текущую сцену (§1.8). */
  skip: () => void;
  /** Доиграть сценарий хода героя (после хода Нави). */
  runPlayerScript: () => Promise<void>;
  /** М3: после сцены волны передать ход Нави, чтобы раненый упырь бросился. */
  runPendingHandOff: () => Promise<void>;
}

export function usePrologueDirector(deps: PrologueDirectorDeps): PrologueDirector {
  const latest = useLatest(deps);
  return useMemo<PrologueDirector>(() => {
    const now = (): PrologueDirectorDeps => latest.current;

    /** Отдать план средству отображения; «true» — сцену пропустили. */
    const playPlan = async (plan: ReturnType<typeof buildCinematicPlan>): Promise<boolean> => {
      if (plan.steps.length === 0) return false;
      return (await now().renderer()?.playCinematic?.(plan)) ?? false;
    };

    const runCutscene = async (event: CutsceneEvent, revealIds: readonly number[] = []): Promise<void> => {
      const deps = now();
      if (!deps.mission?.cutscenes || !deps.kernel) return;
      const fired = [...deps.firedRef.current];
      const config = pickCutscene(deps.mission.cutscenes, event, fired);
      if (!config) return;
      // Помечаем до проигрывания: вторая крыса того же пакета уже не
      // заказывает свою копию сцены (0.20.45).
      if (config.once) deps.firedRef.current.add(config.id);
      const { before, after } = splitAtHandOff(config);
      // Игровой масштаб запоминаем до первой половины: она удерживает
      // приближение (чтобы укус игрался крупным планом), и вторая половина
      // обязана вернуться к игровому кадру, а не к удвоенному приближению.
      const baseScale = deps.renderer()?.getCameraScale?.() ?? null;
      deps.setCutscenePlaying(true);
      deps.setBusy(true);
      try {
        // Приближение держим до конца первой половины: укус крысы играется
        // крупным планом, а не между двумя переездами камеры (0.20.41).
        const skipped = await playPlan(
          buildCinematicPlan(withCutsceneDefaults(before), deps.markers, {
            holdZoom: after !== null,
            revealIds,
          }),
        );
        if (skipped) {
          deps.telemetryRef.current = recordTelemetry(deps.telemetryRef.current, {
            type: "skip_cutscene",
            missionId: deps.mission.id,
          });
        }
        if (!after) return;
        await deps.handOffTurn();
        // Вторая половина сцены ничего не выводит: стая уже выбежала.
        await playPlan(buildCinematicPlan(withCutsceneDefaults(after), deps.markers, { baseScale }));
      } finally {
        deps.setCutscenePlaying(false);
        deps.setBusy(false);
      }
    };

    /**
     * Скрыть сущности, чьё появление ставит сцена (0.20.39). Ядро создаёт
     * их сразу же — в тот же момент, когда срабатывает триггер, — а увидеть
     * их нужно только вбегающими в кадр. Вызывается до проигрывания событий
     * хода: иначе противник успевает показаться в клетке спавна.
     */
    const hideSpawns = (events: readonly GameEvent[]): void => {
      const deps = now();
      if (!deps.mission) return;
      const ids = stagedEntityIds(events, deps.mission.cutscenes, [...deps.firedRef.current]);
      if (ids.length > 0) deps.renderer()?.setHiddenEntities?.(ids);
    };

    /**
     * Появления противника, накопленные внутри `afterPrologueApply`: событие
     * рождается ядром не в `apply`, поэтому без этого канала крыса возникала
     * бы на поле без всякой анимации.
     */
    const runSpawnBeats = async (events: readonly GameEvent[]): Promise<void> => {
      const deps = now();
      if (!deps.mission || events.length === 0) return;
      const { staged, generic } = splitSpawnEvents(events, deps.mission.cutscenes, [...deps.firedRef.current]);
      if (generic.length > 0) await (deps.renderer()?.play(generic) ?? Promise.resolve());
      if (staged.length === 0) return;
      // Стая выбегает разом (0.20.45): одна сцена на пакет появлений, а не
      // сцена на каждую крысу — иначе шесть выходов игрались бы по очереди.
      // Сцена одна на весь пакет и выводит всех, кого скрыла: в засаде М2
      // обе крысы выбегают вместе (0.20.52).
      await runCutscene(
        staged[0]!.event,
        staged.map((entry) => entry.entityId),
      );
      // Сцена открыла своих героев: больше ничего не скрыто.
      deps.renderer()?.setHiddenEntities?.([]);
    };

    /**
     * Открыть зону эвакуации после сцены стаи (0.20.45). М2: зона
     * загорается не в момент освобождения Федота, а когда стая уже выбежала
     * на поле и отыграла своё появление. Цель миссии обновляется без
     * пояснительного текста: свет на западе виден сам.
     */
    const revealExtractBeat = async (): Promise<void> => {
      const deps = now();
      if (!deps.isPrologue || !deps.kernel || !deps.mission) return;
      if (!deps.runRef.current?.extractPending) return;
      const ctx = buildPrologueContext(deps.mission, deps.content, deps.hintSettings.showHints);
      deps.runRef.current = revealPrologueExtract(deps.kernel, deps.runRef.current, ctx);
      deps.setPrologueObjectiveKey("prologue.objective.evacuate");
      await runCutscene({ type: "flag", flag: "extractRevealed" });
    };

    /**
     * Повтор миссии с начала (§1.5): портрет Летописца, затемнение,
     * новый запуск той же миссии. Затемнение идёт через проигрыватель
     * поля, поэтому уважает настройку «уменьшить движение».
     */
    const restartMission = async (): Promise<void> => {
      const deps = now();
      const renderer = deps.renderer();
      const missionId = deps.mission?.id;
      deps.setPrologueStanceLock(false);
      deps.setPrologueSkillLock(null);
      deps.setBusy(true);
      try {
        await deps.showStoryNote(deps.translate("prologue.scene.revive"), { persona: "chronicler" });
        await (renderer?.fadeScreen?.("out", 600) ?? Promise.resolve());
        if (missionId) deps.session.startPrologue(missionId, true);
      } finally {
        deps.setBusy(false);
      }
    };

    /** Пропуск текущей сцены кнопкой или клавишей (§1.8). */
    const skip = (): void => {
      now().renderer()?.skipCinematic?.();
    };

    /** Сценарий хода героя: доигрывается после хода Нави. */
    const runPlayerScript = async (): Promise<void> => {
      const deps = now();
      if (!deps.kernel || !deps.mission || !deps.runRef.current) return;
      const ctx = buildPrologueContext(deps.mission, deps.content, deps.hintSettings.showHints);
      for (let guard = 0; guard < 8; guard += 1) {
        if (deps.session.getBattleSnapshot(PLAYER_OWNER).activeOwner !== PLAYER_OWNER) break;
        if (deps.battleOutcome() !== "ongoing") break;
        const decision = tickProloguePlayerTurn(deps.kernel, deps.runRef.current, ctx);
        deps.runRef.current = decision.state;
        if (!decision.command) break;
        const applied = deps.session.applyBattleCommand(decision.command);
        if (!applied.ok) break;
        await (deps.renderer()?.play(applied.events) ?? Promise.resolve());
        deps.announce(applied.events);
        const next = afterPrologueApply(deps.kernel, decision.command, applied.events, deps.runRef.current, ctx);
        deps.runRef.current = next;
        deps.setPrologueObjectiveKey(next.objectiveKey);
        const hint = next.hints.forcedKey ?? next.hints.queue[0] ?? null;
        deps.setPrologueHintKey(hint);
        const taken = takePrologueSpawnEvents(next);
        deps.runRef.current = taken.state;
        if (taken.events.length > 0) {
          // Появление по сцене: на поле сущности нет до вбегания (0.20.39).
          hideSpawns(taken.events);
          await runSpawnBeats(taken.events);
        }
        if (next.outcome !== "ongoing") deps.outcomeGate.report(() => deps.setPrologueCard("outro"));
      }
    };

    const runPendingHandOff = async (): Promise<void> => {
      const deps = now();
      if (!deps.runRef.current?.handOffPending) return;
      deps.runRef.current = { ...deps.runRef.current, handOffPending: false };
      await deps.handOffTurn();
    };

    return {
      runCutscene,
      hideSpawns,
      runSpawnBeats,
      revealExtractBeat,
      restartMission,
      skip,
      runPlayerScript,
      runPendingHandOff,
    };
  }, [latest]);
}
