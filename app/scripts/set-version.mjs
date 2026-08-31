#!/usr/bin/env node
/**
 * Установка версии приложения (0.20.54).
 *
 * Единственная точка правки номера: корневой манифест `app/package.json`.
 * Всё остальное выводится из него — внутренние манифесты версии не
 * объявляют, константы ядра, повтора и сессии читают номер через
 * `packages/core/src/version.ts`, тесты сверяются с манифестом, а не с
 * литералом. Скрипт правит номер в манифесте и в документации комплекта.
 *
 * Использование:
 *   pnpm version:set 0.20.55   — явно указанный номер;
 *   pnpm version:set patch     — увеличить последнюю часть (по умолчанию);
 *   pnpm version:set minor     — увеличить среднюю часть;
 *   pnpm version:set major     — увеличить первую часть.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "package.json");
const readmePath = path.join(root, "../doc/README.md");

const manifestText = await readFile(manifestPath, "utf8");
const current = manifestText.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/);
if (!current) {
  console.error("Не удалось прочесть версию из app/package.json");
  process.exitCode = 1;
  process.exit(1);
}

const [, major, minor, patch] = current;
const argument = process.argv[2] ?? "patch";
let next;
if (/^\d+\.\d+\.\d+$/.test(argument)) {
  next = argument;
} else if (argument === "major") {
  next = `${Number(major) + 1}.0.0`;
} else if (argument === "minor") {
  next = `${major}.${Number(minor) + 1}.0`;
} else if (argument === "patch") {
  next = `${major}.${minor}.${Number(patch) + 1}`;
} else {
  console.error(`Непонятная версия «${argument}»: нужен номер X.Y.Z или patch | minor | major`);
  process.exitCode = 1;
  process.exit(1);
}

// Номер меняется точечно, без перезаписи манифеста целиком: порядок ключей
// и форматирование файла остаются нетронутыми.
await writeFile(manifestPath, manifestText.replace(/"version":\s*"\d+\.\d+\.\d+"/, `"version": "${next}"`), "utf8");

const readmeText = await readFile(readmePath, "utf8");
const updatedReadme = readmeText.replace(
  /Текущая версия комплекта: \d+\.\d+\.\d+/,
  `Текущая версия комплекта: ${next}`,
);
if (updatedReadme === readmeText) {
  console.error("В doc/README.md не найдена строка «Текущая версия комплекта: …»");
  process.exitCode = 1;
  process.exit(1);
}
await writeFile(readmePath, updatedReadme, "utf8");

console.log(`Версия: ${major}.${minor}.${patch} → ${next}`);
console.log("  изменено: app/package.json (единственный источник), doc/README.md");
console.log("  не требует правки: внутренние манифесты (версии не объявляют),");
console.log("                     константы CORE_VERSION / REPLAY_VERSION / APP_VERSION,");
console.log("                     тесты версий (сверяются с манифестом, а не с литералом).");
console.log("\nПроверка: pnpm check:versions");
