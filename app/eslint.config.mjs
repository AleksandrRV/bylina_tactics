/**
 * Правила проверки кода (0.20.55, фаза 0 рефакторинга).
 *
 * Прежде в проекте не было ни линтера, ни форматтера: стиль держался на
 * внимании, а мёртвый код и случайные ошибки находил только просмотр.
 * Здесь — ровно тот минимум, который ловит реальные дефекты и не спорит
 * с форматтером: базовый набор ESLint, набор typescript-eslint и отключение
 * правил форматирования, отданных Prettier.
 *
 * Форматирование — не дело линтера: за него отвечает `pnpm format`.
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
  {
    files: sources,
    // Плагин обязан быть объявлен в том же объекте, что и его правила:
    // иначе ESLint не знает, откуда брать @typescript-eslint/*.
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
      // Правила реакт-хуков: в коде уже есть директивы под ними, и без
      // плагина они были бы мёртвыми комментариями.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: nodeFiles,
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
  { files: browserFiles, languageOptions: { globals: globals.browser } },
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
