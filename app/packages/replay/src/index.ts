import { APP_VERSION, type Command, type PvpMatchOptions } from "@bylina/core";

/**
 * Журнал повтора партии (roadmap 0.17.0, debug-mode §3.3).
 *
 * Повтор детерминирован: начальное значение генератора и последовательность
 * команд полностью воспроизводят партию. Журнал ведётся для состязательных
 * боёв (поочерёдная игра и сетевой режим) и сохраняется при завершении
 * либо обрыве соединения.
 */

/**
 * Формат журнала независим от версии приложения — та же политика, что и у
 * SAVE_FORMAT_VERSION. Инкрементируется при изменении полей самого журнала
 * (порядок и имена полей, форма options/commands).
 */
export const REPLAY_FORMAT_VERSION = 1;

/**
 * Версия правил: инкрементируется при любом изменении боевых алгоритмов,
 * порядка обращений к ГПСЧ или контента, влияющего на исход (характеристики
 * оружия/умений). Журнал, записанный при других правилах, воспроизводится
 * иначе, чем шёл бой, — и не должен проигрываться молча.
 */
export const RULES_VERSION = 2;

export interface ReplayJournal {
  /** Версия формата журнала; определяет разбор полей ниже. */
  formatVersion: number;
  /** Версия правил, при которых записан журнал; влияет на совместимость воспроизведения. */
  rulesVersion: number;
  /** Версия приложения, записавшего журнал — только для диагностики, на совместимость не влияет. */
  appVersion: string;
  createdAt: number;
  /** Условие и состав партии (передаются в createPvpMatch). */
  options: PvpMatchOptions;
  /** Команды обеих сторон в порядке применения. */
  commands: Command[];
  /** Победившая сторона, если партия завершена. */
  winner: 1 | 2 | null;
  /** Имя партии (комната/метка) для списка. */
  title: string;
}

/** Результат сопоставления журнала текущим формату и правилам. */
export type ReplayCompatibility =
  | "ok" /** Формат распознан, но журнал записан при других правилах. */
  | "otherRules" /** Формат не поддерживается (старый или будущий) — воспроизводить нельзя. */
  | "unsupported";

/**
 * Сопоставляет журнал текущим формату и правилам. Вызывающий интерфейс
 * различает случаи: `otherRules` можно показать с предупреждением,
 * `unsupported` не воспроизводится вовсе.
 */
export function replayCompatibility(journal: ReplayJournal): ReplayCompatibility {
  if (journal.formatVersion !== REPLAY_FORMAT_VERSION) return "unsupported";
  if (journal.rulesVersion !== RULES_VERSION) return "otherRules";
  return "ok";
}

interface ReplayRecorder {
  record(command: Command): void;
  finish(winner: 1 | 2 | null, title: string): ReplayJournal;
  getJournal(): ReplayJournal | null;
}

export function createReplayRecorder(options: PvpMatchOptions, title = "Бой"): ReplayRecorder {
  const journal: ReplayJournal = {
    formatVersion: REPLAY_FORMAT_VERSION,
    rulesVersion: RULES_VERSION,
    appVersion: APP_VERSION,
    createdAt: Date.now(),
    options: {
      ...options,
      units: [...options.units],
      side1: [...options.side1],
      side2: [...options.side2],
      map: { ...options.map, heightMix: { ...options.map.heightMix } },
    },
    commands: [],
    winner: null,
    title,
  };
  return {
    record: (command) => {
      journal.commands.push(command);
    },
    finish: (winner, nextTitle) => {
      journal.winner = winner;
      journal.title = nextTitle;
      return {
        ...journal,
        commands: [...journal.commands],
        options: {
          ...journal.options,
          side1: [...journal.options.side1],
          side2: [...journal.options.side2],
          units: [...journal.options.units],
        },
      };
    },
    getJournal: () => journal,
  };
}

/**
 * Проверка структуры журнала для текущего формата. Журналы прежнего формата
 * (с полем `version: string` и без `formatVersion`) и будущих форматов здесь
 * не проходят: повреждённая либо несовместимая запись не воспроизводится
 * молча (0.21.4).
 */
export function isReplayJournal(value: unknown): value is ReplayJournal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReplayJournal>;
  return (
    candidate.formatVersion === REPLAY_FORMAT_VERSION &&
    typeof candidate.rulesVersion === "number" &&
    typeof candidate.appVersion === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.options === "object" &&
    candidate.options !== null &&
    Array.isArray(candidate.options.side1) &&
    Array.isArray(candidate.options.side2) &&
    Array.isArray(candidate.options.units) &&
    typeof candidate.options.map === "object" &&
    Array.isArray(candidate.commands) &&
    (candidate.winner === 1 || candidate.winner === 2 || candidate.winner === null) &&
    typeof candidate.title === "string"
  );
}
