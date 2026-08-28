/**
 * Режиссура камеры (0.20.37, doc/campaign.md §13.4).
 *
 * Описание кинематографической сцены живёт в данных миссии (Zod-схема —
 * в `packages/content`, которая не зависит от ядра; типы здесь — структурное
 * зеркало схемы, как уже сделано для `PrologueScript`). Никаких правил боя
 * модуль не содержит: он только сопоставляет триггер с произошедшим событием
 * и отдаёт сцену проигрывателю.
 */

export type CutsceneStepKind = "focus" | "pan" | "hold" | "fade";

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
}

/** Событие, на которое откликается проигрыватель сцен. */
export type CutsceneEvent =
  | { type: "missionStart" }
  | { type: "spawn"; configId: string }
  | { type: "flag"; flag: string }
  | { type: "pickup"; itemId: string };

/** Отвечает ли триггер сцены произошедшему событию. */
export function cutsceneMatches(config: CutsceneConfig, event: CutsceneEvent): boolean {
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

/** Первая подходящая сцена: порядок в данных миссии задаёт приоритет. */
export function pickCutscene(
  configs: readonly CutsceneConfig[] | undefined,
  event: CutsceneEvent,
): CutsceneConfig | null {
  if (!configs) return null;
  return configs.find((config) => cutsceneMatches(config, event)) ?? null;
}

/** Значения по умолчанию для необязательных полей (валидатор выдаёт их же). */
export function withCutsceneDefaults(config: CutsceneConfig): CutsceneConfig {
  return { ...config, lockInput: config.lockInput ?? true, skippable: config.skippable ?? true };
}
