#!/usr/bin/env node
/**
 * Проверка визуального набора состояний без зависимости от конкретного
 * браузера. Для каждого эталона фиксируются viewport, ключевые DOM/Pixi
 * ориентиры и digest исходников, влияющих на этот кадр. Любая правка
 * визуального слоя требует явного обновления эталона через
 * `pnpm visual:regression:update`, поэтому случайная «поплывшая» картинка не
 * проходит сборку молча.
 *
 * Полноразмерные PNG не хранятся в репозитории: PixiJS и системные шрифты
 * дают разные пиксели на CI, Android и локальной машине. Этот слой проверяет
 * стабильный визуальный контракт; ручной аудит выполняется в тех же шести
 * состояниях по рецептам из visual-baselines/states.json.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "visual-baselines", "states.json");
const packagePath = path.join(root, "package.json");
const sourceRoot = root;

const states = [
  {
    id: "battle-start",
    viewport: { width: 1280, height: 720 },
    route: "menu → quick match → normal",
    selector: ".battle-screen",
    landmarks: [".battle-top", ".battle-stage", ".battle-bottom", ".battle-objective"],
    sources: ["packages/ui/src/BattleScreenView.tsx", "packages/ui/src/battle.css", "packages/render/src/field-renderer.ts"],
  },
  {
    id: "aiming",
    viewport: { width: 1280, height: 720 },
    route: "battle-start → selected weapon → target preview",
    selector: ".aim-card",
    landmarks: [".aim-card", ".aim-chance", ".battle-stage", ".aim-dmg"],
    sources: ["packages/ui/src/BattleScreenView.tsx", "packages/ui/src/battle.css", "packages/render/src/field-renderer.ts"],
  },
  {
    id: "fog",
    viewport: { width: 1280, height: 720 },
    route: "battle-start → hidden cells",
    selector: ".battle-stage canvas",
    landmarks: [".battle-stage", "--fog", "fogBaseLayer", "paintFog"],
    sources: ["packages/ui/src/BattleScreenView.tsx", "packages/ui/src/battle.css", "packages/render/src/field-renderer.ts"],
  },
  {
    id: "training",
    viewport: { width: 390, height: 844 },
    route: "menu → training → first mission",
    selector: ".training-coach",
    landmarks: [".training-coach", ".training-step-dots", ".training-edge-hint", ".is-training-focus"],
    sources: ["packages/ui/src/BattleScreenView.tsx", "packages/ui/src/battle.css", "packages/ui/src/training-scenario.ts"],
  },
  {
    id: "campaign-map",
    viewport: { width: 1280, height: 720 },
    route: "menu → new tale",
    selector: ".campaign-map",
    landmarks: [".campaign-map", ".map-road-segment", ".map-marker", ".ship-marker"],
    sources: ["packages/ui/src/CampaignScreen.tsx", "packages/ui/src/campaign.css", "packages/campaign/src/index.ts"],
  },
  {
    id: "mission-result",
    viewport: { width: 1280, height: 720 },
    route: "campaign battle → victory/defeat result",
    selector: ".mission-result-screen",
    landmarks: [".mission-result-screen", ".roster-outcomes", ".rewards-strip", ".darkness-summary"],
    sources: ["packages/ui/src/MissionResultScreen.tsx", "packages/ui/src/campaign.css", "apps/game-pwa/src/styles.css"],
  },
];

function digestFor(state) {
  const hash = createHash("sha256");
  for (const relative of state.sources) {
    hash.update(relative);
    hash.update("\0");
    // The source list is intentionally explicit so new visual surfaces cannot
    // enter the contract without an intentional baseline review.
    hash.update(requireSource(relative));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const sourceCache = new Map();
function requireSource(relative) {
  const cached = sourceCache.get(relative);
  if (cached !== undefined) return cached;
  // Filled synchronously by the top-level async pass below. Keeping the helper
  // synchronous makes the digest algorithm easy to audit.
  throw new Error(`Source was not loaded: ${relative}`);
}

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const update = process.argv.includes("--update");

if (baseline.format !== 1) throw new Error(`${path.relative(root, baselinePath)}: unsupported format`);
if (!Array.isArray(baseline.states)) throw new Error(`${path.relative(root, baselinePath)}: states must be an array`);

for (const state of states) {
  for (const relative of state.sources) sourceCache.set(relative, await readFile(path.join(sourceRoot, relative), "utf8"));
}

const current = states.map((state) => ({ ...state, sourceDigest: digestFor(state) }));
const currentById = new Map(current.map((state) => [state.id, state]));
const failures = [];

if (baseline.version !== packageJson.version) failures.push(`baseline version ${baseline.version} does not match package ${packageJson.version}`);
if (baseline.states.length !== states.length) failures.push(`expected ${states.length} states, found ${baseline.states.length}`);
for (const expected of baseline.states) {
  const state = currentById.get(expected.id);
  if (!state) {
    failures.push(`unknown baseline state: ${expected.id}`);
    continue;
  }
  for (const field of ["viewport", "route", "selector", "landmarks", "sources"]) {
    if (JSON.stringify(expected[field]) !== JSON.stringify(state[field])) {
      failures.push(`${expected.id}: ${field} changed`);
    }
  }
  if (expected.sourceDigest !== state.sourceDigest) failures.push(`${expected.id}: source digest changed`);
}

const output = {
  format: 1,
  version: packageJson.version,
  description: "Deterministic visual-state contracts; browser-independent golden baselines.",
  states: current,
};

if (update) {
  await writeFile(baselinePath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Visual regression baselines updated: ${states.length} states`);
} else if (failures.length > 0) {
  console.error("Visual regression contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("If the visual change is intentional, run: pnpm visual:regression:update");
  process.exitCode = 1;
} else {
  console.log(`Visual regression contract passed: ${states.length} states`);
}
