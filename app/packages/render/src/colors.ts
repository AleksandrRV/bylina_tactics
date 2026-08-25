/**
 * Единый справочник цветов представления (Этап 1.1).
 *
 * Числа используются PixiJS, а те же значения публикуются как CSS custom
 * properties для оболочки и интерфейса. Справочник намеренно не содержит
 * цветов игрового баланса: это только семантика изображения.
 */
export const RENDER_COLORS = {
  ui: {
    ink: 0x14181c,
    ink2: 0x1c232a,
    ink3: 0x262f38,
    line: 0x3a4550,
    mist: 0xd5cfc0,
    // Поднят с #9a9384: вторичный текст теперь заметно контрастнее тёмного фона.
    mistDim: 0xb8b3a5,
    white: 0xf3ecdc,
    amber: 0xe0b34a,
    amberBright: 0xe8b64c,
    amberDim: 0x8a6a24,
    danger: 0xc45c5c,
    dangerBright: 0xd84a3a,
    movement: 0x388cdc,
    movementBright: 0x60c8ff,
    success: 0x74e071,
    warning: 0xffd268,
    fieldBackground: 0x101410,
    // Поверхности интерфейса: варианты исходной палитры, а не новые оттенки.
    buttonSurface: 0x1c2320,
    primarySurfaceTop: 0x222a32,
    primarySurfaceBottom: 0x1a2026,
    rosterSurface: 0x161c18,
    rosterSelected: 0x1d231b,
    navSurface: 0x131b10,
    backdropHighlight: 0x2a333c,
    brightText: 0xfff2c4,
  },
  terrain: {
    face: [0x2c3a2c, 0x43603f, 0x74925f] as const,
    riser: [0x171a12, 0x23291a, 0x38432a] as const,
    shadow: 0x081008,
    outline: 0x0c120c,
    edgeLight: 0xe8f0d0,
    pit: 0x070907,
    wall: 0x7a6a56,
  },
  faction: {
    druzhinaRing: 0xe8b64c,
    druzhinaRingDark: 0x57431a,
    druzhinaDisc: 0x241c12,
    navRing: 0x8bc34a,
    navRingDark: 0x1e3311,
    navDisc: 0x131b10,
    navFallback: 0x6d9a3a,
  },
  targeting: {
    selected: 0xffffff,
    ready: 0xe0b34a,
    blocked: 0xc45c5c,
    line: 0xe8b64c,
  },
  overlay: {
    fogHidden: 0x080a0c,
    fogExplored: 0x0c1218,
    fogMist: 0x8a9aaa,
    trainingDim: 0x060a08,
    shadow: 0x000000,
  },
  status: {
    poison: 0x78d83d,
    panic: 0xb94cff,
    immobile: 0x6f8f3d,
    hidden: 0x8fd3bc,
    flying: 0xbfe8ff,
    timed: 0x5fd6e8,
    defending: 0x68aee8,
  },
} as const;

export type RenderColors = typeof RENDER_COLORS;

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** CSS-переменные интерфейса, производимые из RENDER_COLORS, а не наоборот. */
export const RENDER_CSS_VARIABLES = {
  "--ink": colorToCss(RENDER_COLORS.ui.ink),
  "--ink-2": colorToCss(RENDER_COLORS.ui.ink2),
  "--ink-3": colorToCss(RENDER_COLORS.ui.ink3),
  "--line": colorToCss(RENDER_COLORS.ui.line),
  "--mist": colorToCss(RENDER_COLORS.ui.mist),
  "--mist-dim": colorToCss(RENDER_COLORS.ui.mistDim),
  "--white": colorToCss(RENDER_COLORS.ui.white),
  "--amber": colorToCss(RENDER_COLORS.ui.amber),
  "--amber-bright": colorToCss(RENDER_COLORS.ui.amberBright),
  "--amber-dim": colorToCss(RENDER_COLORS.ui.amberDim),
  "--danger": colorToCss(RENDER_COLORS.ui.danger),
  "--danger-bright": colorToCss(RENDER_COLORS.ui.dangerBright),
  "--movement": colorToCss(RENDER_COLORS.ui.movement),
  "--movement-bright": colorToCss(RENDER_COLORS.ui.movementBright),
  "--success": colorToCss(RENDER_COLORS.ui.success),
  "--warning": colorToCss(RENDER_COLORS.ui.warning),
  "--field-background": colorToCss(RENDER_COLORS.ui.fieldBackground),
  "--button-surface": colorToCss(RENDER_COLORS.ui.buttonSurface),
  "--primary-surface-top": colorToCss(RENDER_COLORS.ui.primarySurfaceTop),
  "--primary-surface-bottom": colorToCss(RENDER_COLORS.ui.primarySurfaceBottom),
  "--roster-surface": colorToCss(RENDER_COLORS.ui.rosterSurface),
  "--roster-selected": colorToCss(RENDER_COLORS.ui.rosterSelected),
  "--nav-surface": colorToCss(RENDER_COLORS.ui.navSurface),
  "--backdrop-highlight": colorToCss(RENDER_COLORS.ui.backdropHighlight),
  "--bright-text": colorToCss(RENDER_COLORS.ui.brightText),
  "--nav": colorToCss(RENDER_COLORS.faction.navRing),
} as const;

/**
 * Устанавливает переменные до первого рендера React. Это связывает CSS
 * оболочки с тем же источником, из которого PixiJS получает цвета.
 */
export function applyRenderColorVariables(target?: HTMLElement): void {
  if (typeof document === "undefined" && !target) return;
  const root = target ?? document.documentElement;
  for (const [name, value] of Object.entries(RENDER_CSS_VARIABLES)) root.style.setProperty(name, value);
}
