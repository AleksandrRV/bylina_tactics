#!/usr/bin/env node
/**
 * Визуальный аудит выпуска (0.20.29, этап 5.5, по мотивам ревью-патча):
 * контраст семантических цветов (WCAG), наличие единого справочника и
 * motion-токенов, форменные дубли состояний в отрисовке, reduced-motion,
 * паритет ключей RU/EN и синхронизация версии комплекта документации.
 * Запуск: pnpm audit:visual  (входит в check:versions).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const failures = [];

function hexToRgb(hex) {
  const value = Number.parseInt(hex.replace(/^#/, ""), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function luminance(hex) {
  return hexToRgb(hex).reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrast(a, b) {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function paths(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key));
}

const [paletteSource, stylesSource, battleSource, campaignSource, rendererSource, ruSource, enSource, docsSource, packageJsonSource] =
  await Promise.all([
    read("packages/render/src/palette.ts"),
    read("apps/game-pwa/src/styles.css"),
    read("packages/ui/src/battle.css"),
    read("packages/ui/src/campaign.css"),
    read("packages/render/src/field-renderer.ts"),
    read("packages/i18n/locales/ru/ui.json"),
    read("packages/i18n/locales/en/ui.json"),
    read("../doc/README.md"),
    read("package.json"),
  ]);
const packageJson = JSON.parse(packageJsonSource);

// Контраст семантических цветов: текст 4.5:1, крупный/акцентный 3:1.
for (const [name, foreground, background, minimum] of [
  ["secondary text --mist-dim", "#a8a196", "#14181c", 6],
  ["primary text --mist", "#d5cfc0", "#14181c", 4.5],
  ["action amber", "#e0b34a", "#14181c", 3],
  ["danger accent", "#d84a3a", "#14181c", 3],
  ["movement blue", "#388cdc", "#14181c", 3],
  ["success green", "#74e071", "#14181c", 3],
]) {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) failures.push(`контраст ${name}: ${ratio.toFixed(2)}:1 < ${minimum}:1`);
}

// Единый справочник цветов и motion-токены этапа 4.10.
for (const token of ["--mist-dim", "--amber", "--amber-bright", "--danger", "--info", "--success"]) {
  if (!paletteSource.includes(`"${token}"`)) failures.push(`в palette.ts нет токена ${token}`);
}
for (const token of ["--pop-duration", "--pop-ease", "--danger-muted"]) {
  if (!stylesSource.includes(token)) failures.push(`в styles.css нет токена ${token}`);
}

// Форменные дубли и ключевые механизмы представления.
const rendererMarkers = [
  ["стек состояний", "statusStack"],
  ["радиусы слотов", "stackRadii"],
  ["подъём чисел", "FLOAT_RISE"],
  ["областной прицел", "areaPreview"],
  ["кэш тумана", "fogSignature"],
  ["стрелка обучения", "paintEdgeArrow"],
];
for (const [label, needle] of rendererMarkers) {
  if (!rendererSource.includes(needle)) failures.push(`отрисовка потеряла ${label} (${needle})`);
}
for (const [surface, source] of [["battle", battleSource], ["campaign", campaignSource]]) {
  if (!source.includes("prefers-reduced-motion")) failures.push(`${surface}: нет блока prefers-reduced-motion`);
}
if (!campaignSource.includes(".road-seg-glow") || !campaignSource.includes(".ship-flight-trail")) {
  failures.push("campaign.css: нет следа перелёта или свечения дороги");
}
if (!battleSource.includes(".aim-card.is-floating")) {
  failures.push("battle.css: карточка прицеливания не привязана к цели");
}

// Паритет локалей RU/EN.
const ruPaths = paths(JSON.parse(ruSource)).sort();
const enPaths = paths(JSON.parse(enSource)).sort();
if (JSON.stringify(ruPaths) !== JSON.stringify(enPaths)) {
  failures.push(`словари RU/EN расходятся (${ruPaths.length} vs ${enPaths.length} ключей)`);
} else if (ruPaths.length < 100) {
  failures.push("словари подозрительно малы");
}

// Документация синхронна версии.
if (!docsSource.includes(`Текущая версия комплекта: ${packageJson.version}`)) {
  failures.push(`doc/README.md не синхронизирован с ${packageJson.version}`);
}

if (failures.length > 0) {
  console.error("Визуальный аудит провален:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Визуальный аудит пройден: контраст, семантика цвета, motion, reduced-motion, ${ruPaths.length} ключей локалей.`);
}
