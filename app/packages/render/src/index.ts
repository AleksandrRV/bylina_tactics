export { CELL_SIZE, RENDER_STATUS, createFieldRenderer } from "./field-renderer.js";
export type { FieldRenderer, FieldView } from "./field-renderer.js";
export {
  TRAINING_COMFORT,
  needsTrainingFocus,
  centerCameraOn,
  trainingGlideOffset,
  worldToScreen,
  zoomAroundPoint,
  type CameraPlane,
  type MapPlane,
  type Point,
  type ScreenSize,
} from "./camera.js";

export { BIOME_PALETTES, RENDER_COLORS, RENDER_CSS_VARIABLES, applyRenderColorVariables } from "./colors.js";
export type { RenderColors } from "./colors.js";
