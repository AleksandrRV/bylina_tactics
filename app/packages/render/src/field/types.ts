/**
 * Публичные и внутренние типы рендерера поля.
 * Перенесены из field-renderer.ts без изменений.
 */

import type { CellPos, EntityState, GameEvent, MatchState, ReachableCell } from "@bylina/core";

export interface FieldView {
  /** Seed identifies the generated terrain; it changes only when a new map is created. */
  matchSeed: number;
  snapshot: MatchState;
  selectedId: number | null;
  aimId: number | null;
  reachable: ReachableCell[];
  path: CellPos[];
  aimOk: boolean;
  heightMod: -1 | 0 | 1;
  debugMovement?: boolean;
  /** Клетки, которые сторона наблюдает сейчас (ключи «x,y»). Пустое множество = без тумана. */
  visibleCells?: Set<string>;
  /** Клетки, которые сторона когда-либо наблюдала (ключи «x,y»). */
  exploredCells?: Set<string>;
  /** Клетка, до которой линия прицеливания сплошная (препятствие или макс. дальность). */
  aimBreakCell?: CellPos | null;
  /** Клетка, над которой сейчас курсор (для подсветки защиты при перемещении). */
  hoverCell?: CellPos | null;
  /** Подсветка обучающей подсказки (0.19.0): клетка либо сущность. */
  trainingHighlight?: { kind: "cell" | "entity"; x: number; y: number } | null;
  /**
   * Режим обучения: активный шаг сценария (0.20.13). Поле приглушается
   * («свет прожектора»), а подсветка указания — единственный яркий элемент:
   * прежде золотистая рамка терялась на жёлтой подсветке клеток рывка.
   */
  trainingFocus?: boolean;
  /**
   * Состояние кольца цели прицеливания (0.20.20, этап 1.4): белое — цель
   * предварительно выбрана; янтарное — атака готова и подтверждается
   * следующим нажатием; красное — выстрел невозможен. Когда не задано,
   * используется прежняя пара `aimOk` (доступно → янтарное).
   */
  aimState?: "preselect" | "ready" | "blocked";
  /** Цель прицеливания открыта с фланга (этап 2.7): красные уголки-скобки. */
  aimFlanked?: boolean;
  /**
   * Начало луча прицеливания (0.20.50). По умолчанию луч идёт от самого
   * бойца; при рывке к цели — от клетки подхода, чтобы игрок видел,
   * откуда именно будет удар (а не луч через полкарты с текущей клетки).
   */
  aimFrom?: CellPos | null;
  /**
   * Областной прицел выбранного умения (0.20.x, этап 2.6): центр и радиус
   * нужны для оформления, а areaCells — точный результат preview ядра.
   * Renderer не пересчитывает область самостоятельно.
   */
  areaPreview?: {
    center: CellPos;
    radius: number;
    areaCells: readonly CellPos[];
    /** Показывать friendly-fire warning для атак, допускающих союзников. */
    warnFriendly?: boolean;
  } | null;
  /**
   * Локализованная строка «Промах» для всплывающего числа (этап 2.1):
   * средство отображения не знает языков — строка приходит из интерфейса.
   */
  missLabel?: string;
  /** Биом карты (0.20.25, этап 3.1): палитра поверхности, стиль укрытий и декор. */
  biome?: string;
  /**
   * Сторона, бойцов которой камера держит в кадре при подгонке (0.20.42).
   * Базовый кадр рассчитан на {@link CAMERA_CELLS_IN_VIEW} клеток по
   * меньшей оси экрана, поэтому крупное поле больше не влезает целиком:
   * без этого кадра начало боя показывало бы середину карты, а отряд
   * оставался за краем.
   */
  homeOwner?: number;
  /**
   * Наступающая Тьма (этап 3.6): доля счётчика Тьмы кампании 0..1.
   * Холодный полупрозрачный слой поверх сцены; вне кампании не задаётся.
   */
  darkness?: number;
}

export interface FieldRenderer {
  mount(host: HTMLElement): Promise<void>;
  update(view: FieldView): void;
  play(events: GameEvent[]): Promise<void>;
  pan(dx: number, dy: number): void;
  destroy(): void;
  setOnActivate(handler: (x: number, y: number) => void): void;
  setOnHover(handler: (x: number, y: number) => void): void;
  /** Системная настройка «уменьшить движение» (этап 1.7): гасит анимации поля. */
  setReducedMotion(flag: boolean): void;
  /** Темп боя (этап 2.10): множитель скорости пауз и эффектов поля (2 — двойная). */
  setSpeed(scale: number): void;
  /**
   * Экранная позиция сущности в долях холста 0..1 (этап 4.8): интерфейс
   * подтягивает карточку прицеливания к цели. null, если цель недоступна.
   */
  getEntityScreenPosition?(entityId: number): { x: number; y: number } | null;
  /**
   * Проиграть кинематографическую сцену (0.20.37, campaign.md §13.4).
   * Возвращает `true`, если сцену пропустили, — вызывающий учитывает это
   * в телеметрии (`skip_cutscene`).
   */
  playCinematic?(plan: CinematicPlan): Promise<boolean>;
  /** Пропустить текущую сцену: камера сразу встаёт на финальную точку. */
  skipCinematic?(): void;
  /** Идёт ли сцена прямо сейчас. */
  isCinematicPlaying?(): boolean;
  /**
   * Плавно привести клетку в кадр (0.20.42): верхняя панель ведёт камеру
   * к выбранному персонажу или противнику. Во время сцены жест
   * игнорируется: кадром владеет режиссура.
   */
  focusCell?(cell: CellPos, durationMs?: number): void;
  /** Плавно привести бойца в кадр (0.20.42): то же, что по клетке бойца. */
  focusEntity?(entityId: number, durationMs?: number): void;
  /**
   * Текущий масштаб камеры (0.20.41). Экран запоминает его перед первой
   * половиной сцены, чтобы вторая половина вернулась к игровому кадру, а не
   * к приближению, оставшемуся от первой.
   */
  getCameraScale?(): number;
  /** Затемнение (`out`) или проявление (`in`) экрана. */
  fadeScreen?(mode: "out" | "in", durationMs?: number): Promise<void>;
  /** Заблокировать жесты холста на время сцены. */
  setInputLocked?(locked: boolean): void;
  /**
   * Скрыть сущности до их появления сценой (0.20.39). Скриптованное
   * появление происходит в ядре сразу, а на поле сущность должна возникнуть
   * только когда сцена проиграет вбегание: иначе противник появляется
   * в своей клетке, пропадает и выбегает заново. Список заменяет прежний;
   * пустой список — больше ничего не скрыто.
   */
  setHiddenEntities?(ids: readonly number[]): void;
}

/** Цель шага сцены: клетка поля либо сущность по записи бестиария. */
export interface CinematicTarget {
  cell?: { x: number; y: number };
  configId?: string;
}

export interface CinematicStep {
  /** `focus` — кадр на цели, `pan` — проезд, `hold` — пауза, `fade` — затемнение. */
  kind: "focus" | "pan" | "hold" | "fade";
  target?: CinematicTarget;
  durationMs?: number;
  holdMs?: number;
  fade?: "out" | "in";
  /** Вбегание сущности в клетку из-за предела карты (мс). */
  runInMs?: number;
  /**
   * Вести камеру за сущностью во время вбегания (0.20.40): кадр встаёт на
   * точку у кромки карты, откуда сущность выбегает, и едет следом за ней.
   */
  follow?: boolean;
  /**
   * Подсветить цель шага пульсирующим янтарным кольцом (0.20.40): кадр
   * называет предмет или клетку не только приближением, но и светом.
   */
  accent?: boolean;
}

export interface CinematicPlan {
  id: string;
  steps: CinematicStep[];
  /**
   * Сущности, чьё появление ставит эта сцена (0.20.52). Они скрыты до
   * вбегания, и вбегают ВСЕ сразу: камера ведёт первого (`follow`), остальные
   * приходят тем же шагом рядом. Прежде сцена открывала лишь ту сущность,
   * за которой ехала, а вторая крыса засады возникала на поле уже после
   * сцены — «выбегала невидимой».
   */
  revealIds?: readonly number[];
  /** Блокировать ввод игрока на время сцены (по умолчанию — да). */
  lockInput?: boolean;
  /** Сцену можно пропустить (по умолчанию — да). */
  skippable?: boolean;
  /**
   * Держать приближение до конца сцены (0.20.41): сцена — лишь половина
   * кадра, вторую доигрывают события боя (передача хода шагом `handOff`).
   * Отъезд делают следующие шаги, а не эта половина: укус крысы читается
   * крупным планом, а не «отъехали — укусили — приехали».
   */
  holdZoom?: boolean;
  /**
   * Масштаб, к которому сцена возвращается (0.20.41). По умолчанию —
   * масштаб на входе. Сцена-продолжение (вторая половина разрезанной
   * `handOff` сцены) получает масштаб первой половины: иначе её `zoom`
   * домножился бы на уже приближённый кадр, и вторая половина уехала бы
   * в крупность, которой нет в данных.
   */
  baseScale?: number;
  /**
   * Приближение камеры на время сцены: множитель к игровому масштабу
   * (0.20.39). При подгонке «поле целиком» проезд невозможен — камера
   * упирается в границы поля, — поэтому масштаб сцены задаётся здесь:
   * герой и цель читаются крупно, а между ними есть куда ехать.
   * После сцены камера возвращается к игровому масштабу.
   */
  zoom?: number;
}

/** Отображаемое состояние сущности в момент проигрывания событий. */
export interface DisplayState {
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

/** Графический эффект, живущий несколько сотен миллисекунд. */
export type Fx =
  | { kind: "windup"; x: number; y: number; start: number; warm: boolean }
  | { kind: "flash"; x: number; y: number; start: number; crit: boolean; miss: boolean; angle: number }
  | { kind: "bolt"; x0: number; y0: number; x1: number; y1: number; start: number; dur: number; warm: boolean }
  | { kind: "poof"; x: number; y: number; start: number }
  | { kind: "extract"; x: number; y: number; start: number }
  | {
      kind: "skill";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      start: number;
      dur: number;
      style: string;
      success: boolean;
    }
  | { kind: "status"; x: number; y: number; start: number; status: string; applied: boolean }
  /** Гибель вне ямы (этап 2.4): детерминированные тёмные осколки с псевдогравитацией. */
  | { kind: "shards"; x: number; y: number; start: number; seed: number; palette: "dark" | "wood" }
  /** Гибель в яме (этап 2.5): провал темнеет, тело уходит вниз без осколков. */
  | { kind: "pitfall"; x: number; y: number; start: number }
  /** Открытие клетки (этап 3.5): мгла сжимается к центру и исчезает. */
  | { kind: "fogReveal"; x: number; y: number; start: number };

/** Всплывающее число над целью события (этап 2.1). */
export interface FloatText {
  text: import("pixi.js").Text;
  start: number;
  startY: number;
}

export type { EntityState };
