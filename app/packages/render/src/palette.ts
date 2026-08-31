/**
 * Единый справочник цветов (0.20.20, этап 1.1 плана визуальных работ):
 * семантические величины, которыми рисуется поле боя и которые живут
 * параллельно в CSS-переменных интерфейса. Иллюстративные детали классов
 * (цвета туники богатыря, руны идола и т.п.) остаются внутри функций
 * рисования — они не несут семантики и не используются стилями.
 *
 * Цветовая семантика проекта неизменна: янтарный — действие и акцент
 * дружины; тёмно-красный — угроза; синий — информация/шаг; зелёный —
 * успех и Нави; жёлтый — рывок и предупреждение.
 */

/** Верхние грани по уровням: низ — холодный мох, земля — луг, верх — светлее. */
export const TERRAIN_FACE = [0x2c3a2c, 0x43603f, 0x74925f] as const;
/** Откос (южная стена яруса): тёмная земляная огранка. */
export const TERRAIN_RISER = [0x171a12, 0x23291a, 0x38432a] as const;

export interface FactionLook {
  ring: number;
  ringDark: number;
  disc: number;
}

/** Дружина: янтарное кольцо действия. */
export const DRUZHINA_LOOK: FactionLook = { ring: 0xe8b64c, ringDark: 0x57431a, disc: 0x241c12 };
/** Нави: зелёное кольцо (природа Нави). */
export const NAV_LOOK: FactionLook = { ring: 0x8bc34a, ringDark: 0x1e3311, disc: 0x131b10 };

/** Резервная заливка фишки без собственной иллюстрации класса. */
export const FALLBACK_TOKEN_ART = { druzhina: 0xc9a24b, nav: 0x6d9a3a } as const;

/* ---------- биомы (0.20.25, этап 3.1) ---------- */

export type BiomeId = "meadow" | "swamp" | "thicket" | "scorched";

export interface BiomeLook {
  /** Базовый цвет верхней грани по ярусам. */
  face: readonly [number, number, number];
  /** Цвет откоса по ярусам. */
  riser: readonly [number, number, number];
  /** Стиль укрытий (этап 3.4): брёвна, каменные глыбы или кусты. */
  coverStyle: "wood" | "stone" | "bush";
  /** Набор редкого декора (~3% клеток, этап 3.2). */
  decor: "flowers" | "reeds" | "mushrooms" | "bones";
}

/** Луг — прежний облик поля; отсутствие биома трактуется как луг. */
const BIOME_MEADOW: BiomeLook = {
  face: [0x2c3a2c, 0x43603f, 0x74925f],
  riser: [0x171a12, 0x23291a, 0x38432a],
  coverStyle: "wood",
  decor: "flowers",
};

/** Болото кикиморы: холодная зелень, кусты и камыш. */
const BIOME_SWAMP: BiomeLook = {
  face: [0x243226, 0x39513a, 0x5d7350],
  riser: [0x12160f, 0x1c2114, 0x2c3320],
  coverStyle: "bush",
  decor: "reeds",
};

/** Чаща лешего: густая тёмная зелень, брёвна и грибы. */
const BIOME_THICKET: BiomeLook = {
  face: [0x1e2c1e, 0x31482e, 0x54684a],
  riser: [0x101409, 0x181d10, 0x26301c],
  coverStyle: "wood",
  decor: "mushrooms",
};

/** Выжженная земля: пепельные тона, каменные глыбы и кости. */
const BIOME_SCORCHED: BiomeLook = {
  face: [0x33302a, 0x4a4438, 0x6b5f4c],
  riser: [0x14120e, 0x1e1a14, 0x2c261c],
  coverStyle: "stone",
  decor: "bones",
};

export const BIOMES: Record<BiomeId, BiomeLook> = {
  meadow: BIOME_MEADOW,
  swamp: BIOME_SWAMP,
  thicket: BIOME_THICKET,
  scorched: BIOME_SCORCHED,
};

const DEFAULT_BIOME: BiomeId = "meadow";

export function biomeLookOf(biome: string | undefined): BiomeLook {
  return BIOMES[(biome as BiomeId) ?? DEFAULT_BIOME] ?? BIOMES[DEFAULT_BIOME];
}

/** Подсветка достижимости: синий — шаг за 1 ОД, жёлтый — рывок за 2 ОД. */
export const MOVE_STEP_TINT = 0x388cdc;
export const MOVE_DASH_TINT = 0xe0b34a;
/** Маршрут перемещения. */
export const ROUTE_MARK = 0xf6f2e4;

/** Кольцо цели прицеливания (этап 1.4): цвет дублирует состояние атаки. */
export const AIM_PRESELECT = 0xf3ecdc; // белое — цель предварительно выбрана
export const AIM_READY = 0xe8b64c; // янтарное — атака подтверждается нажатием
export const AIM_IMPOSSIBLE = 0xd84a3a; // красное — выстрел сейчас невозможен

/** Зона эвакуации и домашние края состязания. */
export const EXTRACT_GLOW = 0xe8c96a;
export const EXTRACT_SPARK = 0xf2dd9a;
export const HOME_AMBER = 0xe0b34a;
export const HOME_BLUE = 0x6aa9d9;

/** Затемнение экрана: гибель героя в прологе и переходы сцен (0.20.37). */
export const FADE_COLOR = 0x0a0d0a;

/** Полоса здоровья фишки. */
export const HP_BACK = 0x0a0a0a;
export const HP_OK = 0x6fbf4a;
export const HP_LOW = 0xd84a3a;
/** Ромбы очков действия. */
export const AP_ON = 0xe8b64c;
export const AP_OFF = 0x3a382e;

/* ---------- CSS-переменные из того же справочника ---------- */

/**
 * Значения для стилей интерфейса, порождаемые этим же справочником:
 * отрисовка поля и стили UI гарантированно используют одни величины.
 */
export const PALETTE_CSS_VARIABLES: Record<string, string> = {
  "--ink": "#14181c",
  "--ink-2": "#1c232a",
  "--ink-3": "#262f38",
  "--line": "#3a4550",
  "--mist": "#d5cfc0",
  // Этап 1.8: приглушённый текст осветлён до контраста ≥ 6:1 с --ink.
  "--mist-dim": "#a8a196",
  "--amber": "#e0b34a",
  "--amber-bright": "#e8b64c",
  "--amber-dim": "#8a6a24",
  "--danger": "#d84a3a",
  "--info": "#388cdc",
  "--success": "#6fbf4a",
} as const;

/**
 * Наложить переменные справочника на документ. Статические значения
 * в styles.css остаются запасными на случай запуска вне обозревателя;
 * вызов при старте приложения делает справочник единственным источником.
 */
export function applyPaletteCssVariables(target: Document | HTMLElement = document): void {
  const style = "documentElement" in target ? target.documentElement.style : target.style;
  for (const [name, value] of Object.entries(PALETTE_CSS_VARIABLES)) {
    style.setProperty(name, value);
  }
}
