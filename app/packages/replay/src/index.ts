import type { Command, PvpMatchOptions } from "@bylina/core";

/**
 * Журнал повтора партии (roadmap 0.17.0, debug-mode §3.3).
 *
 * Повтор детерминирован: начальное значение генератора и последовательность
 * команд полностью воспроизводят партию. Журнал ведётся для состязательных
 * боёв (поочерёдная игра и сетевой режим) и сохраняется при завершении
 * либо обрыве соединения.
 */

export const REPLAY_VERSION = "0.20.51";

export interface ReplayJournal {
  version: string;
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

export interface ReplayRecorder {
  record(command: Command): void;
  finish(winner: 1 | 2 | null, title: string): ReplayJournal;
  getJournal(): ReplayJournal | null;
}

export function createReplayRecorder(options: PvpMatchOptions, title = "Бой"): ReplayRecorder {
  const journal: ReplayJournal = {
    version: REPLAY_VERSION,
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
      return { ...journal, commands: [...journal.commands], options: { ...journal.options, side1: [...journal.options.side1], side2: [...journal.options.side2], units: [...journal.options.units] } };
    },
    getJournal: () => journal,
  };
}

/** Проверка структуры журнала: повреждённая запись не воспроизводится. */
export function isReplayJournal(value: unknown): value is ReplayJournal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReplayJournal>;
  return (
    typeof candidate.version === "string" &&
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
