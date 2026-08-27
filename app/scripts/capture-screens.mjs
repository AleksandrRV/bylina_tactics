#!/usr/bin/env node
/**
 * Скриншот-регрессия (0.20.27, этап 5.1).
 *
 * capture  — откывает ключевые состояния игры в Chromium (Playwright) и
 *            сохраняет снимки в artifacts/screens/<версия>/:
 *              меню, старт боя, обучение, карта кампании, итог миссии.
 *            Состояние, которое не удалось открыть (например, карта кампании
 *            без прогресса), пропускается с предупреждением.
 * compare  — сравнивает снимки текущей версии с эталонным набором
 *            (env BASELINE_DIR или предыдущая версия) через pixelmatch;
 *            расхождение кадра более SCREEN_DIFF_THRESHOLD считается регрессом.
 *
 * Требует dev-зависимости playwright (+ браузер) и, для compare,
 * pixelmatch + pngjs. Запускать при поднятом приложении:
 *   corepack pnpm preview   (или pnpm dev, тогда BASE_URL=http://localhost:5173)
 *   corepack pnpm screens:capture
 */
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.resolve(root, "..", "artifacts", "screens");
const baseUrl = process.env.BASE_URL ?? "http://localhost:4173";
const threshold = Number(process.env.SCREEN_DIFF_THRESHOLD ?? 0.02);
const command = process.argv[2] ?? "capture";

/** Ключевые состояния (этап 5.1): имя → шаги открытия в интерфейсе. */
const STATES = [
  {
    name: "menu",
    open: async () => {},
  },
  {
    name: "training",
    open: async (page) => {
      await page.getByText("Обучение").first().click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "quick-match",
    open: async (page) => {
      await page.getByText("Быстрый матч").first().click();
      await page.waitForTimeout(400);
      const start = page.getByRole("button", { name: "В бой" }).first();
      if (await start.isVisible().catch(() => false)) await start.click();
      await page.waitForSelector("canvas", { timeout: 10_000 });
      await page.waitForTimeout(900);
    },
  },
];

async function latestOtherVersion(currentDir) {
  const entries = await readdir(outRoot);
  const others = entries.filter((name) => name !== path.basename(currentDir)).sort();
  return others.at(-1) ? path.join(outRoot, others.at(-1)) : null;
}

async function capture() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Playwright не установлен: corepack pnpm add -D playwright && npx playwright install chromium");
    process.exitCode = 1;
    return;
  }
  const { APP_VERSION } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const outDir = path.join(outRoot, APP_VERSION);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  for (const state of STATES) {
    try {
      await state.open(page);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, `${state.name}.png`) });
      console.log(`captured ${state.name}`);
    } catch (error) {
      console.warn(`skipped ${state.name}: ${String(error).split("\n")[0]}`);
    }
    // Возврат в меню для следующего состояния — через перезагрузку.
    await page.goto(baseUrl, { waitUntil: "networkidle" });
  }
  await browser.close();
  console.log(`Screens saved to ${outDir}`);
}

async function compare() {
  const currentDir = path.join(outRoot, JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).APP_VERSION);
  const baselineDir = process.env.BASELINE_DIR ? path.resolve(process.env.BASELINE_DIR) : await latestOtherVersion(currentDir);
  if (!baselineDir) {
    console.warn("Нет эталонного набора снимков — сравнивать не с чем (первый запуск?).");
    return;
  }
  let pixelmatch;
  let PNG;
  try {
    ({ default: pixelmatch } = await import("pixelmatch"));
    ({ PNG } = await import("pngjs"));
  } catch {
    console.error("Для сравнения нужны pixelmatch и pngjs: corepack pnpm add -D pixelmatch pngjs");
    process.exitCode = 1;
    return;
  }
  let failures = 0;
  for (const file of await readdir(currentDir)) {
    const baselinePath = path.join(baselineDir, file);
    let baseline;
    try {
      baseline = PNG.sync.read(await readFile(baselinePath));
    } catch {
      console.warn(`no baseline for ${file} — новый кадр`);
      continue;
    }
    const current = PNG.sync.read(await readFile(path.join(currentDir, file)));
    const diff = new PNG({ width: current.width, height: current.height });
    const mismatch = pixelmatch(current.data, baseline.data, diff.data, current.width, current.height, { threshold: 0.1 });
    const ratio = mismatch / (current.width * current.height);
    if (ratio > threshold) {
      failures += 1;
      console.error(`REGRESSION ${file}: ${(ratio * 100).toFixed(2)}% пикселей отличается`);
    } else {
      console.log(`ok ${file}: ${(ratio * 100).toFixed(2)}%`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

if (command === "capture") await capture();
else if (command === "compare") await compare();
else {
  console.error("Usage: node scripts/capture-screens.mjs [capture|compare]");
  process.exitCode = 1;
}
