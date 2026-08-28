/**
 * Камера боя: правила подводки к цели обучающего указания (0.20.14,
 * ui-design §4.5). Математика вынесена в чистый модуль — границы экрана и
 * «зона комфорта» вычисляются программно от фактического холста, поэтому
 * одни и те же правила работают на десктопе и на мобильных устройствах в
 * горизонтальной и вертикальной ориентации: меняются только размеры
 * {@link ScreenSize}, которые рендерер передаёт из PixiJS (resizeTo).
 */

export interface Point {
  x: number;
  y: number;
}

/** Размеры холста в экранных пикселях (CSS-пиксели, autoDensity). */
export interface ScreenSize {
  width: number;
  height: number;
}

/**
 * Камера: масштаб мира и позиция мира на холсте.
 * Экранная позиция мировой точки: offset + point * scale.
 */
export interface CameraPlane {
  scale: number;
  offset: Point;
}

/** Мировые границы поля (мир начинается в нуле): width × height. */
export interface MapPlane {
  width: number;
  height: number;
}

/**
 * «Зона комфорта» цели обучающего указания — доли холста, внутри которых
 * маркер считается достаточно далёким от краёв. Вертикальные полосы шире
 * горизонтальных: сверху плашка наставника, снизу панель действий —
 * на телефоне в горизонтальной ориентации они занимают заметную долю
 * экрана, и подсветка под ними теряется.
 */
export const TRAINING_COMFORT = {
  x0: 0.24,
  x1: 0.76,
  y0: 0.3,
  y1: 0.66,
} as const;

/** Экранная позиция мировой точки при данной камере. */
export function worldToScreen(point: Point, plane: CameraPlane): Point {
  return { x: plane.offset.x + point.x * plane.scale, y: plane.offset.y + point.y * plane.scale };
}

/**
 * Нужна ли подводка: цель за пределами «зоны комфорта» — то есть за краем
 * экрана или вплотную к нему (в пределах полос перекрытия интерфейсом).
 */
export function needsTrainingFocus(point: Point, plane: CameraPlane, screen: ScreenSize): boolean {
  if (screen.width <= 0 || screen.height <= 0 || plane.scale <= 0) return false;
  const at = worldToScreen(point, plane);
  return (
    at.x < screen.width * TRAINING_COMFORT.x0 ||
    at.x > screen.width * TRAINING_COMFORT.x1 ||
    at.y < screen.height * TRAINING_COMFORT.y0 ||
    at.y > screen.height * TRAINING_COMFORT.y1
  );
}

/** Ограничение камеры по одной оси: поле не уводится за край экрана. */
function clampAxis(target: number, mapSpan: number, screenSpan: number): number {
  // Поле уже вмещается в экран — выровнять по центру оси.
  if (mapSpan <= screenSpan) return (screenSpan - mapSpan) / 2;
  // Иначе окно камеры лежит в пределах поля: [screenSpan − mapSpan, 0].
  return Math.min(0, Math.max(screenSpan - mapSpan, target));
}

/**
 * Целевое положение камеры подводки: цель приводится к горизонтали центра
 * и чуть выше середины высоты (под плашку наставника, над панелью
 * действий), затем позиция ограничивается границами поля — камера не
 * показывает пустоту за краями карты ни на одной оси.
 */
/**
 * Виды кью камеры (0.20.20 + 0.20.37).
 *
 * `panTo` / `panThreat` / `panReturn` — подводка к цели обучающего указания,
 * источнику угрозы и возврат к герою; этим же набором описываются кинемато-
 * графические сцены миссий (doc/campaign.md §13.4). `focus` — мгновенный
 * кадр на цели (без проезда), `hold` — удержание текущего положения,
 * `fade` — затемнение или проявление экрана.
 */
export type CameraCueKind = "panTo" | "panThreat" | "panReturn" | "focus" | "hold" | "fade";

export interface CameraCue {
  kind: CameraCueKind;
  /** Цель в мировых координатах. Отсутствует у `hold` и `fade`. */
  point?: Point;
  /** Длительность в мс (проектное). */
  durationMs?: number;
  /** Пауза на цели после перехода. */
  holdMs?: number;
  /** Направление затемнения. */
  fade?: "out" | "in";
  /** Проиграть вбегание сущности в клетку из-за предела карты. */
  runInMs?: number;
  /** Сущность, которой принадлежит кадр (для вбегания и трекинга). */
  entityId?: number;
}

export interface CameraDirectorState {
  queue: CameraCue[];
  current: CameraCue | null;
  returnTo: Point | null;
  inputLocked: boolean;
}

export function createCameraDirector(origin: Point): CameraDirectorState {
  return { queue: [], current: null, returnTo: origin, inputLocked: false };
}

export function enqueueCameraCue(state: CameraDirectorState, cue: CameraCue): CameraDirectorState {
  return { ...state, queue: [...state.queue, cue] };
}

/** Начать следующий пан; ввод блокируется на время пана. */
export function beginCameraCue(state: CameraDirectorState): CameraDirectorState {
  const next = state.queue[0];
  if (!next) return { ...state, current: null, inputLocked: false };
  return {
    ...state,
    queue: state.queue.slice(1),
    current: next,
    inputLocked: true,
  };
}

export function skipCameraCue(state: CameraDirectorState): CameraDirectorState {
  return { ...state, current: null, inputLocked: false };
}

export function finishCameraCue(state: CameraDirectorState): CameraDirectorState {
  return { ...state, current: null, inputLocked: false };
}

export function trainingGlideOffset(
  point: Point,
  plane: CameraPlane,
  screen: ScreenSize,
  map: MapPlane,
): Point {
  const at = worldToScreen(point, plane);
  const rawX = plane.offset.x + (screen.width * 0.5 - at.x);
  const rawY = plane.offset.y + (screen.height * 0.44 - at.y);
  return {
    x: clampAxis(rawX, map.width * plane.scale, screen.width),
    y: clampAxis(rawY, map.height * plane.scale, screen.height),
  };
}
