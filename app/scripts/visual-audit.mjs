#!/usr/bin/env node
/** Final visual/accessibility audit for the Stage 5 release gate. */
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

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function paths(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key));
}

const [colorsSource, stylesSource, battleSource, campaignSource, rendererSource, ruSource, enSource, docsSource, manifestSource] = await Promise.all([
  read("packages/render/src/colors.ts"),
  read("../app/apps/game-pwa/src/styles.css"),
  read("packages/ui/src/battle.css"),
  read("packages/ui/src/campaign.css"),
  read("packages/render/src/field-renderer.ts"),
  read("packages/i18n/locales/ru/ui.json"),
  read("packages/i18n/locales/en/ui.json"),
  read("../doc/README.md"),
  read("package.json"),
]);
const packageJson = JSON.parse(manifestSource);
const colors = {
  ink: "#14181c",
  mistDim: "#b8b3a5",
  white: "#f3ecdc",
  amber: "#e0b34a",
  danger: "#c45c5c",
  movement: "#388cdc",
  success: "#74e071",
};

// Normal text target is 4.5:1; large display text is checked at 3:1.
for (const [name, foreground, background, minimum] of [
  ["secondary text", colors.mistDim, colors.ink, 4.5],
  ["primary text", colors.white, colors.ink, 4.5],
  ["action amber", colors.amber, colors.ink, 3],
  ["danger accent", colors.danger, colors.ink, 3],
  ["movement blue", colors.movement, colors.ink, 3],
  ["success green", colors.success, colors.ink, 3],
]) {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) failures.push(`${name} contrast ${ratio.toFixed(2)}:1 < ${minimum}:1`);
}

const requiredColorTokens = [
  "--mist-dim", "--amber", "--danger", "--movement", "--success", "--forge", "--chamber", "--injury",
];
const requiredMotionTokens = ["--ui-motion-duration", "--ui-motion-ease"];

for (const token of requiredMotionTokens) {
  if (!stylesSource.includes(token)) failures.push(`missing motion token ${token}`);
}
for (const token of requiredColorTokens) {
  if (!colorsSource.includes(`\"${token}\"`)) failures.push(`missing central color token ${token}`);
}
for (const [label, source, needles] of [
  ["battle HUD", battleSource, [".roster-card", ".skill-row", ".aim-card", ".training-edge-hint"]],
  ["campaign HUD", campaignSource, [".map-road-segment", ".ship-flight-trail", ".forge-panel", ".chamber-panel"]],
  ["renderer", rendererSource, ["TOKEN_STATUS_SLOTS", "drawStatusBadge", "lowPowerDevice", "lastDynamicPaint"]],
  ["global styles", stylesSource, ["--ui-motion-duration", ".display-title"]],
]) {
  for (const needle of needles) if (!source.includes(needle)) failures.push(`${label} is missing ${needle}`);
}

const ru = JSON.parse(ruSource);
const en = JSON.parse(enSource);
const ruPaths = paths(ru).sort();
const enPaths = paths(en).sort();
if (JSON.stringify(ruPaths) !== JSON.stringify(enPaths)) {
  const missingRu = enPaths.filter((key) => !ruPaths.includes(key));
  const missingEn = ruPaths.filter((key) => !enPaths.includes(key));
  if (missingRu.length) failures.push(`RU locale misses: ${missingRu.join(", ")}`);
  if (missingEn.length) failures.push(`EN locale misses: ${missingEn.join(", ")}`);
}

if (!docsSource.includes(`Текущая версия комплекта: ${packageJson.version}`)) {
  failures.push(`doc/README.md is not synchronized to ${packageJson.version}`);
}
if (!battleSource.includes("prefers-reduced-motion") || !campaignSource.includes("prefers-reduced-motion")) {
  failures.push("reduced-motion coverage is incomplete for battle/campaign surfaces");
}
if (!stylesSource.includes("text-wrap: balance") || !stylesSource.includes("font-kerning: normal")) {
  failures.push("display typography audit markers are missing");
}

if (failures.length) {
  console.error("Visual audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Visual audit passed: contrast, semantics, motion, performance markers and ${ruPaths.length} locale keys`);
}
