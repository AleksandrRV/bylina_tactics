/**
 * Режиссура камеры (0.20.37, doc/campaign.md §13.4).
 *
 * Описание кинематографической сцены живёт в данных миссии (Zod-схема —
 * в `packages/content`, которая не зависит от ядра; типы здесь — структурное
 * зеркало схемы, как уже сделано для `PrologueScript`). Никаких правил боя
 * модуль не содержит: он только сопоставляет триггер с произошедшим событием
 * и отдаёт сцену проигрывателю.
 */

/**
 * Виды шага сцены. `focus` — кадр на цели, `pan` — проезд камеры, `hold` —
 * удержание, `fade` — затемнение или проявление; `handOff` — передача хода
 * сопернику внутри сцены (0.20.40): шаг разыгрывает чужой ход обычными
 * событиями боя, а следующие шаги сцены продолжаются уже после него.
 */
export type CutsceneStepKind = "focus" | "pan" | "hold" | "fade" | "handOff";

/** Цель шага: клетка, сущность по записи бестиария или маркер раскладки. */
export interface CutsceneTarget {
  cell?: { x: number; y: number };
  configId?: string;
  marker?: string;
}

export interface CutsceneStep {
  /** `focus` — кадр на цели, `pan` — плавный переход, `hold` — пауза,
   *  `fade` — затемнение (`out`) или проявление (`in`) экрана. */
  kind: CutsceneStepKind;
  target?: CutsceneTarget;
  /** Длительность перехода в мс. */
  durationMs?: number;
  /** Пауза на цели после перехода. */
  holdMs?: number;
  /** Направление затемнения. */
  fade?: "out" | "in";
  /** Проиграть вбегание сущности в её клетку из-за предела карты. */
  runInMs?: number;
  /**
   * Вести камеру за сущностью во время вбегания (0.20.40): кадр встаёт на
   * точку у кромки карты, откуда сущность выбегает, и едет следом за ней.
   */
  follow?: boolean;
  /**
   * Подсветить цель шага пульсирующим янтарным кольцом (0.20.40): кадр
   * называет предмет не только приближением, но и светом.
   */
  accent?: boolean;
}

export type CutsceneTriggerKind = "missionStart" | "onSpawn" | "onFlag" | "onPickup";

export interface CutsceneTrigger {
  kind: CutsceneTriggerKind;
  configId?: string;
  flag?: string;
  itemId?: string;
}

export interface CutsceneConfig {
  id: string;
  trigger: CutsceneTrigger;
  steps: CutsceneStep[];
  /** Блокировать ввод игрока на время сцены (по умолчанию — да). */
  lockInput?: boolean;
  /** Допустим пропуск кнопкой или клавишей (campaign.md §1.8, по умолчанию — да). */
  skippable?: boolean;
  /**
   * Приближение камеры на время сцены: множитель к игровому масштабу
   * (0.20.39). Без приближения проезд камеры невозможен: при подгонке
   * «поле целиком» окно камеры не меньше поля.
   */
  zoom?: number;
  /**
   * Играть сцену один раз за бой (0.20.45). Триггер `onSpawn` срабатывает
   * на каждое появление записи бестиария, и сцена первого выхода —
   * засады в М2 — не должна повторяться на каждой волне: следующая
   * подходящая сцена из данных миссии играется вместо неё.
   */
  once?: boolean;
}

/** Событие, на которое откликается проигрыватель сцен. */
export type CutsceneEvent =
  | { type: "missionStart" }
  | { type: "spawn"; configId: string }
  | { type: "flag"; flag: string }
  | { type: "pickup"; itemId: string };

/**
 * Отвечает ли триггер сцены произошедшему событию.
 *
 * `fired` — идентификаторы уже сыгранных сцен: сцена с `once` повторно
 * не выбирается (0.20.45), и её триггер достаётся следующей подходящей
 * сцене из данных миссии.
 */
export function cutsceneMatches(config: CutsceneConfig, event: CutsceneEvent, fired: readonly string[] = []): boolean {
  if (config.once && fired.includes(config.id)) return false;
  const trigger = config.trigger;
  switch (trigger.kind) {
    case "missionStart":
      return event.type === "missionStart";
    case "onSpawn":
      return event.type === "spawn" && event.configId === trigger.configId;
    case "onFlag":
      return event.type === "flag" && event.flag === trigger.flag;
    case "onPickup":
      return event.type === "pickup" && event.itemId === trigger.itemId;
    default:
      return false;
  }
}

/**
 * Первая подходящая сцена: порядок в данных миссии задаёт приоритет.
 * `fired` — уже сыгранные сцены (0.20.45): помеченные `once` пропускаются.
 */
export function pickCutscene(
  configs: readonly CutsceneConfig[] | undefined,
  event: CutsceneEvent,
  fired: readonly string[] = [],
): CutsceneConfig | null {
  if (!configs) return null;
  return configs.find((config) => cutsceneMatches(config, event, fired)) ?? null;
}

/**
 * Приближение камеры сцены по умолчанию (0.20.39): множитель к игровому
 * масштабу. При подгонке «поле целиком» проезд камеры невозможен — окно
 * камеры не меньше поля, — поэтому сцена начинается с приближения.
 */
export const DEFAULT_CUTSCENE_ZOOM = 1.9;

/** Значения по умолчанию для необязательных полей (валидатор выдаёт их же). */
export function withCutsceneDefaults(config: CutsceneConfig): CutsceneConfig {
  return {
    ...config,
    lockInput: config.lockInput ?? true,
    skippable: config.skippable ?? true,
    zoom: config.zoom ?? DEFAULT_CUTSCENE_ZOOM,
  };
}
