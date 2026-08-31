/**
 * Проверки содержимого (0.20.56).
 *
 * Прежде все схемы жили в одном файле на восемьсот строк. Теперь они
 * разложены по предметным областям в каталоге `schemas/`, а этот файл
 * остаётся единственной точкой входа: потребители по-прежнему пишут
 * `from "./schemas.js"` и не знают о разбивке.
 */

export * from "./schemas/combat.js";
export * from "./schemas/world.js";
export * from "./schemas/campaign.js";
export * from "./schemas/modes.js";
export * from "./schemas/training.js";
export * from "./schemas/scripting.js";
export * from "./schemas/prologue.js";
