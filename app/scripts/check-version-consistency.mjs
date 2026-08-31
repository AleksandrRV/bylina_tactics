#!/usr/bin/env node
/**
 * Единый источник версии (0.20.54).
 *
 * Версия приложения объявлена ровно один раз — в корневом манифесте
 * `app/package.json`. Внутренние пакеты и приложения версии не объявляют
 * вовсе (они приватны и не публикуются), исходники читают номер из
 * манифеста через `packages/core/src/version.ts`, а документация обязана
 * называть текущий номер. Прежде номер был прописан в пятнадцати
 * манифестах, трёх константах и четырёх тестах: каждое увеличение
 * требовало двадцати трёх правок и легко расходилось.
 *
 * Скрипт проверяет пять правил и не заменяет типизацию и тесты:
 *
 *   1. корневой манифест содержит корректный номер X.Y.Z;
 *   2. ни один другой манифест не объявляет версию;
 *   3. ни один исходник не содержит литерала версии;
 *   4. `packages/core/src/version.ts` читает номер из корневого манифеста;
 *   5. `doc/README.md` называет текущий номер;
 *   6. версии формата и правил повторов объявлены в единственном месте
 *      (`packages/replay/src/index.ts`), а reminder-напоминание о ручном
 *      подъёме RULES_VERSION — на месте.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Обход каталога: файлы по предикату, без node_modules и служебных папок. */
async function walk(directory, accept) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full, accept)));
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}

const relative = (file) => path.relative(root, file);
const failures = [];

/** 1. Единственный источник — корневой манифест. */
const rootManifestPath = path.join(root, "package.json");
const rootVersion = JSON.parse(await readFile(rootManifestPath, "utf8")).version;
if (typeof rootVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(rootVersion)) {
  failures.push(`package.json: версия «${rootVersion ?? "отсутствует"}» не вида X.Y.Z`);
}

/** 2. Внутренние манифесты версии не объявляют. */
for (const file of await walk(root, (name) => name === "package.json")) {
  if (file === rootManifestPath) continue;
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifest.version !== undefined) {
    failures.push(
      `${relative(file)}: лишняя версия ${manifest.version} — версия объявляется только в корневом манифесте`,
    );
  }
}

/**
 * 3. В исходниках нет литералов версии.
 *
 * Проверяются только каталоги `src`: в тестах номер встречается по делу —
 * снимки сохранений прежних версий и номера форматов — и запрещать его там
 * нельзя.
 */
async function sourceRoots() {
  const roots = [];
  for (const group of ["packages", "apps"]) {
    const groupRoot = path.join(root, group);
    for (const entry of await readdir(groupRoot, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      roots.push(path.join(groupRoot, entry.name, "src"));
    }
  }
  return roots;
}

const sourceFiles = [];
for (const sourceRoot of await sourceRoots()) {
  sourceFiles.push(...(await walk(sourceRoot, (name) => /\.tsx?$/.test(name))));
}
for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  const match = text.match(/["'`](\d+\.\d+\.\d+)["'`]/);
  if (match) {
    failures.push(
      `${relative(file)}: литерал версии «${match[1]}» — номер читается из манифеста, а не прописывается в коде`,
    );
  }
}

/** 4. Мост к манифесту на месте: иначе константа молча станет литералом. */
const versionModule = path.join(root, "packages/core/src/version.ts");
const versionSource = await readFile(versionModule, "utf8").catch(() => "");
if (!versionSource.includes("package.json")) {
  failures.push("packages/core/src/version.ts: не читает корневой манифест — версия не выведена из единого источника");
}

/** 5. Документация называет актуальный номер. */
const readme = path.join(root, "../doc/README.md");
const readmeText = await readFile(readme, "utf8").catch(() => "");
if (!readmeText.includes(`Текущая версия комплекта: ${rootVersion}`)) {
  failures.push(`doc/README.md: не называет текущую версию ${rootVersion}`);
}

/**
 * 6. Версии формата и правил повторов (0.21.4–0.21.5) объявлены ровно один
 *    раз — в `packages/replay/src/index.ts`. Они не следуют за версией
 *    приложения: REPLAY_FORMAT_VERSION поднимается при изменении полей
 *    журнала, RULES_VERSION — при изменении боевых алгоритмов/контента.
 *    Проверка фиксирует единое место объявления и наличие напоминания о
 *    ручном подъёме; сам подъём скрипт выполнить не может — это решение
 *    автора изменения.
 */
const replayModule = path.join(root, "packages/replay/src/index.ts");
const replaySource = await readFile(replayModule, "utf8").catch(() => "");
for (const [name, marker] of [
  ["REPLAY_FORMAT_VERSION", "export const REPLAY_FORMAT_VERSION ="],
  ["RULES_VERSION", "export const RULES_VERSION ="],
]) {
  const declarations = replaySource.match(new RegExp(marker, "g")) ?? [];
  if (declarations.length === 0) {
    failures.push(`packages/replay/src/index.ts: не объявлена ${name} — единое место версии повторов утрачено`);
  } else if (declarations.length > 1) {
    failures.push(
      `packages/replay/src/index.ts: ${name} объявлена более одного раза — допустимо ровно одно объявление`,
    );
  }
}
for (const [file, needle] of [
  // Напоминание в документации модуля повторов.
  [replayModule, "инкрементируется при любом изменении боевых алгоритм"],
  // Напоминание в документации формата повторов для автора релиза.
  [path.join(root, "../doc/operations.md"), "RULES_VERSION"],
]) {
  const text = await readFile(file, "utf8").catch(() => "");
  if (!text.includes(needle)) {
    failures.push(
      `${relative(file)}: нет напоминания о подъёме RULES_VERSION («${needle}…») — изменение правил без подъёма версии рассинхронизирует повторы`,
    );
  }
}

if (failures.length > 0) {
  console.error(`Проверка версии не пройдена (источник — app/package.json: ${rootVersion}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nПодсказка: номер меняется одной командой `pnpm version:set X.Y.Z`.");
  process.exitCode = 1;
} else {
  console.log(`Версия согласована: ${rootVersion} (источник — app/package.json, литералов в исходниках нет).`);
}
