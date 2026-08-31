/**
 * Единый канал команд боевого экрана (0.20.64).
 *
 * Прежде в одном замыкании `applyCommand` жило четыре разные обязанности:
 * куда уходит команда (своё ядро, ведущий в поочерёдной игре, ведущий в
 * сетевом бою), что разрешает строгий сценарий обучения, что разрешает сцена
 * пролога и что делать с итогами уже исполненной команды. Здесь остались
 * решения — «маршрут команды» и « итог пролога», а исполнение, как и прежде,
 * за экраном: он держит сессию, сцену и состояние.
 */

import type { Command, GameEvent, MatchState } from "@bylina/core";
import { shouldRestoreCheckpoint, takePrologueSpawnEvents, type PrologueRunState } from "./prologue-battle.js";
import type { TrainingActionKind } from "./training-scenario.js";

/** Куда ведёт команда: сеть, своё ядро или отказ. */
export type CommandRoute =
  /** Ввод не принимается: наблюдатель, повтор, исход ещё не показан. */
  | { kind: "drop" }
  /** Поочерёдный бой: команда уходит ведущему матча. */
  | { kind: "sendPvp" }
  /** Гость сетевого боя: команда уходит ведущему. */
  | { kind: "sendNet" }
  /** Команда исполняется ядром на этом устройстве; сцена могла её укоротить. */
  | { kind: "apply"; command: Command }
  /** Обучение: команда не совпадает с активным указанием (0.20.13). */
  | { kind: "denyTraining"; action: TrainingActionKind }
  /** Пролог: команда выдала бы героя раньше времени (0.20.45). */
  | { kind: "denyPrologue" };

/** Состояние, от которого зависит маршрут команды. */
export interface CommandRoutingContext {
  isSpectator: boolean;
  isReplay: boolean;
  /** Исход известен, но ещё не показан (0.20.40). */
  outcomePending: boolean;
  /** Поочерёдный бой ведётся транспортом, а не своим ядром. */
  isPvp: boolean;
  isNetGuest: boolean;
  isTraining: boolean;
  /** Допускает ли активное указание обучения эту команду. */
  trainingAllows: (command: Command) => boolean;
  /** Чем объяснить игроку отказ в обучении. */
  trainingDenial: (command: Command) => TrainingActionKind;
  isPrologue: boolean;
  /** Сцена пролога укорачивает команду (обрывает рывок, 0.20.45); `null` — не правит. */
  clampPrologue: ((command: Command) => Command) | null;
  /** Сцена пролога запрещает команду (шум); `null` — запрета нет. */
  prologueAllows: ((command: Command) => boolean) | null;
}

/**
 * Разобрать маршрут команды. Порядок проверок прежний: закрытый ввод,
 * транспорт, строгий сценарий обучения, сцена пролога. Укороченная прологом
 * команда возвращается в маршруте `apply` — исполнять нужно именно её.
 */
export function routeCommand(command: Command, ctx: CommandRoutingContext): CommandRoute {
  if (ctx.isSpectator || ctx.isReplay) return { kind: "drop" };
  // Исход известен, но ещё не показан: поле доигрывает бой, команды игрока
  // в этот кадр не принадлежат.
  if (ctx.outcomePending) return { kind: "drop" };
  if (ctx.isPvp) return { kind: "sendPvp" };
  if (ctx.isNetGuest) return { kind: "sendNet" };
  // Обучение: финальная проверка строгого сценария — команда обязана
  // совпадать с активным указанием. Жестовые проверки кнопок и кликов дают
  // удобство, эта точка гарантирует полноту запрета.
  if (ctx.isTraining && !ctx.trainingAllows(command)) {
    return { kind: "denyTraining", action: ctx.trainingDenial(command) };
  }
  let issued = command;
  if (ctx.isPrologue && ctx.clampPrologue) issued = ctx.clampPrologue(command);
  if (ctx.isPrologue && ctx.prologueAllows && !ctx.prologueAllows(issued)) return { kind: "denyPrologue" };
  return { kind: "apply", command: issued };
}

/** Что сцена пролога делает с итогами уже исполненной команды. */
export type PrologueAftermath =
  /** Откат к контрольной точке: бой переигрывается с неё. */
  | { kind: "restore"; state: PrologueRunState }
  /** Контрольной точки нет — честное поражение, а не «живой» труп на поле. */
  | { kind: "defeat"; state: PrologueRunState }
  /** Сущности созданы ядром, но выходят на поле сценой (0.20.39). */
  | { kind: "spawnBeats"; state: PrologueRunState; events: GameEvent[] }
  | { kind: "none"; state: PrologueRunState };

export interface PrologueAftermathInput {
  /** Состояние сцены, пересчитанное после команды. */
  next: PrologueRunState;
  events: readonly GameEvent[];
  /** Снимок боя после команды: по нему решается откат. */
  snapshot: MatchState;
  hasCheckpoint: boolean;
}

/**
 * Разобрать итог команды в прологе. Каждый вариант несёт новое состояние
 * сцены: вызывающий записывает его в ссылку, а затем исполняет ветвь —
 * откат, поражение или выход стаи.
 */
export function prologueAftermath(input: PrologueAftermathInput): PrologueAftermath {
  if (shouldRestoreCheckpoint(input.next, input.events, input.snapshot)) {
    return input.hasCheckpoint
      ? { kind: "restore", state: input.next }
      : { kind: "defeat", state: { ...input.next, outcome: "defeat" } };
  }
  const taken = takePrologueSpawnEvents(input.next);
  return taken.events.length > 0
    ? { kind: "spawnBeats", state: taken.state, events: taken.events }
    : { kind: "none", state: taken.state };
}
