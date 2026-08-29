/**
 * Окантовка рельефа за кромкой карты (0.20.41).
 *
 * Кадр сцены центрирует цель ровно по центру окна (0.20.40), поэтому камера
 * вправе показать пространство за кромкой поля: палка первой миссии стоит в
 * последней колонке, и без выхода за границу её невозможно привести в центр.
 * Голая подложка читалась бы как обрыв мира, а ровная заливка — как «недоклеенный
 * фон». Здесь считается опушка: детерминированный лес из крон, кустов и травы,
 * густеющий к краю поля и глохнущий в глубине. Взгляд читает переход «поляна →
 * чаща», а не границу карты.
 *
 * Геометрия считается чистой функцией без Пикси: её можно покрыть тестами и
 * переиспользовать в любом средстве отображения. Рисует окантовку
 * `field-renderer` (`paintFringe`), один раз на карту.
 */

/** На сколько клеток окантовка рельефа выходит за кромку карты. */
export const FRINGE_CELLS = 12;

/** Вид детали опушки: крона, куст, пучок травы. */
export type FringeKind = "canopy" | "bush" | "grass";

export interface FringeDecor {
  /** Клетка в координатах раскладки: лежит за пределами поля. */
  cellX: number;
  cellY: number;
  kind: FringeKind;
  /** Размер детали в долях клетки. */
  size: number;
  /** Прозрачность: чем дальше от кромки поля, тем тише деталь. */
  alpha: number;
  /** Детерминированный сдвиг внутри клетки (доли клетки, −0,5..0,5). */
  dx: number;
  dy: number;
}

/**
 * Хэш клетки: один и тот же вход всегда даёт один и тот же выход. Без этого
 * опушка перескакивала бы при каждом перерисовывании статики.
 */
function hash(a: number, b: number, salt: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(salt, 1442695041)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Как глубоко клетка лежит за кромкой поля: 1 клетка — сразу за краем,
 * `radius` — внешняя граница окантовки. Внутри поля глубина равна нулю.
 */
export function fringeDepth(cellX: number, cellY: number, cols: number, rows: number, radius: number): number {
  const outside = Math.max(-cellX, cellX - (cols - 1), -cellY, cellY - (rows - 1), 0);
  if (outside <= 0 || radius <= 0) return 0;
  return Math.min(1, outside / radius);
}

/**
 * Опушка вокруг поля: детали, из которых собирается лес за кромкой карты.
 *
 * Плотность падает с глубиной — у кромки лес сомкнут, в глубине редеет, —
 * поэтому граница кадра не выглядит обрезанной, а край поля не загорожен
 * стеной пятен. Порядок обхода фиксирован: результат воспроизводим.
 */
export function fringeDecor(cols: number, rows: number, radius: number = FRINGE_CELLS): FringeDecor[] {
  const items: FringeDecor[] = [];
  if (cols <= 0 || rows <= 0 || radius <= 0) return items;
  for (let cellY = -radius; cellY <= rows - 1 + radius; cellY += 1) {
    for (let cellX = -radius; cellX <= cols - 1 + radius; cellX += 1) {
      const depth = fringeDepth(cellX, cellY, cols, rows, radius);
      if (depth <= 0) continue;
      // Густота: от сомкнутой опушки до редких деревьев в глубине.
      const chance = 0.8 - depth * 0.52;
      if (hash(cellX, cellY, 0x5f3ac1) > chance) continue;
      const roll = hash(cellX, cellY, 0x11b7d3);
      const kind: FringeKind = roll < 0.44 ? "canopy" : roll < 0.76 ? "bush" : "grass";
      const sizeRoll = hash(cellX, cellY, 0x2c9d55);
      const size = kind === "canopy" ? 0.36 + sizeRoll * 0.22 : kind === "bush" ? 0.22 + sizeRoll * 0.16 : 0.12 + sizeRoll * 0.12;
      // Свет гаснет с глубиной: взгляд не ищет конца леса.
      const strength = (kind === "canopy" ? 0.9 : kind === "bush" ? 0.75 : 0.6) * (1 - depth * 0.7);
      items.push({
        cellX,
        cellY,
        kind,
        size,
        alpha: Math.max(0.05, strength),
        dx: (hash(cellX, cellY, 0x7a1f19) - 0.5) * 0.5,
        dy: (hash(cellX, cellY, 0x3e5cb7) - 0.5) * 0.5,
      });
    }
  }
  return items;
}
