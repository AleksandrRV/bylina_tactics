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
 * Меняет масштаб вокруг экранной точки. Мировая точка под курсором остаётся
 * на том же пикселе — в отличие от простого изменения `scale`, которое
 * выглядит как сдвиг поля. Функция чистая, поэтому правило одинаково для
 * колеса мыши и pinch-жеста и легко проверяется без PixiJS.
 */
export function zoomAroundPoint(
  screenPoint: Point,
  plane: CameraPlane,
  factor: number,
  minScale = 0.55,
  maxScale = 1.8,
): CameraPlane {
  if (!Number.isFinite(factor) || factor <= 0 || plane.scale <= 0) return plane;
  const scale = Math.min(maxScale, Math.max(minScale, plane.scale * factor));
  const worldPoint = {
    x: (screenPoint.x - plane.offset.x) / plane.scale,
    y: (screenPoint.y - plane.offset.y) / plane.scale,
  };
  return {
    scale,
    offset: {
      x: screenPoint.x - worldPoint.x * scale,
      y: screenPoint.y - worldPoint.y * scale,
    },
  };
}

/** Ограничение камеры по одной оси: поле не уводится за край экрана. */
function clampAxis(target: number, mapSpan: number, screenSpan: number): number {
  // Поле уже вмещается в экран — выровнять по центру оси.
  if (mapSpan <= screenSpan) return (screenSpan - mapSpan) / 2;
  // Иначе окно камеры лежит в пределах поля: [screenSpan − mapSpan, 0].
  return Math.min(0, Math.max(screenSpan - mapSpan, target));
}

/** Центрирует мировую точку, не показывая пустоту за границами карты. */
export function centerCameraOn(
  point: Point,
  plane: CameraPlane,
  screen: ScreenSize,
  map: MapPlane,
): CameraPlane {
  if (screen.width <= 0 || screen.height <= 0 || plane.scale <= 0) return plane;
  return {
    scale: plane.scale,
    offset: {
      x: clampAxis(screen.width * 0.5 - point.x * plane.scale, map.width * plane.scale, screen.width),
      y: clampAxis(screen.height * 0.5 - point.y * plane.scale, map.height * plane.scale, screen.height),
    },
  };
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

/**
 * Целевое положение камеры подводки: цель приводится к горизонтали центра
 * и чуть выше середины высоты (под плашку наставника, над панелью
 * действий), затем позиция ограничивается границами поля — камера не
 * показывает пустоту за краями карты ни на одной оси.
 */
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
