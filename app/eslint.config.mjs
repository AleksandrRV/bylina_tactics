/**
 * Правила проверки кода.
 *
 * Прежде в проекте не было ни линтера, ни форматтера: стиль держался на
 * внимании, а мёртвый код и случайные ошибки находил только просмотр.
 * Здесь — ровно тот минимум, который ловит реальные дефекты и не спорит
 * с форматтером: базовый набор ESLint, набор typescript-eslint и отключение
 * правил форматирования, отданных Prettier.
 *
 * Форматирование — не дело линтера: за него отвечает `pnpm format`.
 *
 * Фазы рефакторинга:
 *   - фаза 0 (0.20.55): появился базовый набор, предупреждения не роняют
 *     сборку, а правятся по мере касания файлов;
 *   - фаза 1 (0.21.7, день 8): добавлен типизированный набор
 *     `recommendedTypeChecked` на `projectService`. Типизированные правила
 *     требуют загрузки программы TypeScript (заметно медленнее), поэтому
 *     они применяются только к типизированным файлам в `src`/`tests` —
 *     каталогах, покрытых package-tsconfig; конфиги (`*.config.ts`) на
 *     базовом наборе. Все находки типизированного набора в фазе 1 —
 *     предупреждения: `no-floating-promises` и `no-misused-promises`, как и
 *     остальные, видны и попадают в зафиксированный список, но сборку не
 *     роняют. Часть находок (require-await, небезопасные any и пр.)
 *     разбирается в следующей фазе — здесь только зафиксировать.
 *   - фаза 2 (0.21.14, день 15): список `no-floating-promises` и
 *     `no-misused-promises` к этому дню пуст (ни одного предупреждения на
 *     всём src/tests), поэтому оба правила повышены до `error` для
 *     типизированных файлов: необработанный промис — тихий отказ, который
 *     трек укрепления закрывал в первую очередь. Остальные предупреждения
 *     типизированного набора (require-await, unsafe-any и пр.) остаются в
 *     фазе 1 и разбираются по мере касания файлов.
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const sources = ["**/*.{js,mjs,cjs,ts,tsx}"];
/** Сценарии и ретранслятор: Node, вывод в консоль — их рабочий инструмент. */
const nodeFiles = ["**/scripts/**/*.{js,mjs,cjs}", "apps/signaling-server/**/*.{js,mjs,cjs}", "**/*.cjs"];
/** Код приложения и пакетов: обозреватель (тесты идут в jsdom). */
const browserFiles = [
  "packages/*/src/**/*.{ts,tsx}",
  "packages/*/tests/**/*.{ts,tsx}",
  "apps/game-pwa/src/**/*.{ts,tsx}",
];
/**
 * Типизированные файлы для фазы 1: только каталоги, покрытые package
 * tsconfig (`src`/`tests`). Конфиги сборки (`*.config.ts` в корне пакета) в
 * tsconfig не входят — для них типизированный набор не поднимается.
 */
const typedFiles = ["packages/*/src/**/*.ts", "packages/*/tests/**/*.ts", "apps/*/src/**/*.ts", "**/*.tsx"];

/**
 * Фаза 1: правила типизированного набора приводятся к `warn` — сборку не
 * роняют, но предупреждения видны в выводе и попадают в зафиксированный
 * список. Ужесточение до `error` — следующая фаза, по мере разбора.
 */
const typeCheckedWarn = tseslint.configs.recommendedTypeChecked.flatMap((block) =>
  Object.entries(block.rules ?? {}).map(([ruleId]) => [ruleId, "warn"]),
);

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "apps/game-pwa/public/**",
      "artifacts/**",
    ],
  },
  { files: sources, ...js.configs.recommended },
  // Набор typescript-eslint — только для типизированных файлов.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.{ts,tsx}"] })),
  // Фаза 1 (0.21.7): типизированный набор на projectService. projectService
  // сам находит ближайший tsconfig по файлу; tsconfigRootDir заякорен на app/.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
  {
    // Правила типизированного набора в фазе 1 — предупреждения: видны в
    // выводе и попадают в зафиксированный список, но сборку не роняют
    // (no-floating-promises и no-misused-promises в том числе). Список —
    // ровно правила recommendedTypeChecked; применяется к тем же
    // типизированным файлам, где поднят projectService.
    files: typedFiles,
    rules: Object.fromEntries(typeCheckedWarn),
  },
  {
    files: sources,
    // Плагин обязан быть объявлен в том же объекте, что и его правила:
    // иначе ESLint не знает, откуда брать @typescript-eslint/* и
    // react-hooks/* (фаза 0). Правила типизированного набора в фазе 1 —
    // предупреждения: видны, но сборку не роняют.
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Правила, отданные Prettier, отключены: два инструмента об одном и
      // том же спорить не должны.
      ...prettier.rules,
      // Ошибки: то, что почти всегда дефект, а не выбор.
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      // Последовательный await в цикле — осознанный приём проигрывателя
      // событий, поэтому правило включено: каждое такое место обязано
      // сказать об этом директивой, а не молча уйти в ошибку.
      // Проигрыватель событий ждёт по очереди — это осознанный приём,
      // поэтому правило предупреждает, но не роняет сборку.
      "no-await-in-loop": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // Предупреждения: правятся по мере касания файла, сборку не роняют.
      "prefer-const": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      // Правила реакт-хуков: в коде уже есть директивы под них, и без
      // плагина они были бы мёртвыми комментариями.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Видимость переменных в TS-файлах проверяет сам TypeScript: no-undef
    // даёт ложные срабатывания (React при jsx-runtime, DOM/сервис-типы) и
    // официально отключается вместе с typescript-eslint.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: nodeFiles,
    languageOptions: { globals: globals.node },
    // Сценарий обходит файлы по очереди — это его естественный порядок,
    // а консоль для него — рабочий инструмент.
    rules: { "no-console": "off", "no-await-in-loop": "off" },
  },
  { files: browserFiles, languageOptions: { globals: globals.browser } },
  {
    // Фаза 2 (0.21.14, день 15): два promise-правила типизированного набора
    // повышены до `error` — их список на этот день пуст. Правила требуют
    // информации типов, поэтому действуют только на типизированных файлах;
    // блок стоит после правил фазы 1 (warn) и перекрывает их точечно.
    files: typedFiles,
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Тестам позволено больше: неиспользуемая переменная в заготовке — не беда.
    files: ["**/tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
      "no-await-in-loop": "off",
    },
  },
);
