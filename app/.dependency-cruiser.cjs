/**
 * Границы модулей в CI (0.21.6, день 7, P1-5 часть 1).
 *
 * Правила переносят «Направление зависимостей» из doc/architecture.md §2 в
 * машиночитаемый вид. Слои (зависимости допустимы только вниз по списку):
 *
 *   1. content, i18n, settings
 *   2. core, campaign, replay          — модули ядер
 *   3. storage, net, signaling
 *   4. session
 *   5. ui, render
 *
 * Приложения (apps/*) — корень композиции, им можно всё. Относительные
 * импорты внутри пакета ни одному правилу не противоречат: шаблоны `to`
 * перечисляют конкретные пакеты-источники, а не свой каталог.
 *
 * Три правила:
 *   - no-cycles          — граф зависимостей ацикличен;
 *   - layers-point-down  — импорт только в нижележащий либо свой слой;
 *   - core-remains-pure  — ядра не зависят от DOM/React/отображения/связи.
 *
 * Проверка: `pnpm check:boundaries` (шаг «Module boundaries» в задаче lint CI).
 */

/**
 * Шаблон пути-цели: в pnpm-монорепозитории кросс-пакетные импорты
 * `@bylina/<pkg>` не резолвятся до файла из корня (симлинки лежат в
 * node_modules каждого пакета), поэтому цель матчим по спецификатору импорта
 * — он равен имени пакета как в «запрещённом», так и в резолвленном виде.
 * Относительные импорты внутри пакета (путь вида `./x`/`../x`) шаблону не
 * соответствуют.
 */
const importOf = (packages) => `^@bylina/(?:${packages.join("|")})$`;

/** Шаблон пути источника (файлы в src перечисленных пакетов). */
const srcOf = (packages) => `^packages/(?:${packages.join("|")})/src/`;

const LAYER_1 = ["content", "i18n", "settings"];
const LAYER_2 = ["core", "campaign", "replay"];
const LAYER_3 = ["storage", "net", "signaling"];
const LAYER_4 = ["session"];
const LAYER_5 = ["ui", "render"];

/** Все пакеты монорепозитория (для запрета импорта у слоя 1). */
const ALL_PACKAGES = [...LAYER_1, ...LAYER_2, ...LAYER_3, ...LAYER_4, ...LAYER_5];

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cycles",
      severity: "error",
      comment: "Циклические зависимости запрещены (architecture §2): отношения слоёв ацикличны.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "layers-point-down",
      severity: "error",
      comment:
        "Слой 1 (content/i18n/settings) — основание: ни одного импорта из других внутренних пакетов (architecture §2).",
      from: {
        path: srcOf(LAYER_1),
      },
      to: {
        // Импорт любого внутреннего пакета, кроме себя. Относительные
        // импорты внутри пакета не матчатся: они начинаются с «.»/«..».
        path: importOf(ALL_PACKAGES),
        pathNot: importOf(LAYER_1),
      },
    },
    {
      name: "layers-point-down",
      severity: "error",
      comment:
        "Слой 2 (core/campaign/replay) может зависеть только от слоя 1 и себя; запрет вверх — на storage/net/signaling/session/ui/render.",
      from: {
        path: srcOf(LAYER_2),
      },
      to: {
        path: importOf([...LAYER_3, ...LAYER_4, ...LAYER_5]),
      },
    },
    {
      name: "layers-point-down",
      severity: "error",
      comment: "Слой 3 (storage/net/signaling) не зависит от слоя 4 (session) и слоя 5 (ui/render).",
      from: {
        path: srcOf(LAYER_3),
      },
      to: {
        path: importOf([...LAYER_4, ...LAYER_5]),
      },
    },
    {
      name: "layers-point-down",
      severity: "error",
      comment: "Слой 4 (session) не зависит от слоя 5 (ui/render).",
      from: {
        path: srcOf(LAYER_4),
      },
      to: {
        path: importOf(LAYER_5),
      },
    },
    {
      name: "core-remains-pure",
      severity: "error",
      comment:
        "Модули ядер (core, campaign) не обращаются к библиотеке интерфейса (React) и средству отображения (PixiJS) (architecture §2). Объектная модель документа (window/localStorage) как глобаль — вне досягаемости импортов; её охраняет ESLint.",
      from: {
        path: srcOf(["core", "campaign"]),
      },
      to: {
        path: "^(react|react-dom|@pixi/|pixi\\.js)",
      },
    },
    {
      name: "core-remains-pure",
      severity: "error",
      comment:
        "Модули ядер (core, campaign) не импортируют модули связи, хранения, сессии, отображения и интерфейса (architecture §2).",
      from: {
        path: srcOf(["core", "campaign"]),
      },
      to: {
        path: importOf(["net", "signaling", "storage", "session", "ui", "render"]),
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^|/)(dist|node_modules)/",
    },
    // Единого tsconfig нет: типизация собирается по пакетам; для границ
    // достаточно резолюции расширений (.ts/.tsx) и до-компиляционных импортов.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".cjs", ".mjs", ".json"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
