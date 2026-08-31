/**
 * Общая обвязка DOM-тестов интерфейса (0.20.55).
 *
 * Прежде каждый тест, работающий с экраном через jsdom, заводил свою копию
 * одного и того же: заглушку средства отображения, полизаполнение
 * `matchMedia`, подмену `PointerEvent`, ожидание `tick` и обход `waitFor`.
 * Семь файлов дублировали около сорока строк, а расхождение в мелочах
 * (какой метод пишет в журнал, какой масштаб камеры возвращает заглушка)
 * делало тесты несравнимыми.
 *
 * Здесь собрано ровно то, что нужно смонтировать экран и подействовать на
 * него. Обвязка не знает о правилах боя: они проверяются в ядре.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { FieldRenderer } from "@bylina/render";

/** Одно обращение к средству отображения. */
export interface RendererCall {
  name: string;
  args: unknown[];
}

/** Журнал обращений: порядок и аргументы. */
export interface RendererJournal {
  readonly calls: RendererCall[];
  /** Записать обращение; возвращает `undefined`, чтобы годится как обработчик. */
  record: (name: string, ...args: unknown[]) => void;
  /** Имена обращений в порядке вызова. */
  order: () => string[];
  /** Все обращения с этим именем. */
  callsOf: (name: string) => RendererCall[];
  /** Аргументы первого обращения с этим именем. */
  argsOf: (name: string) => unknown[] | undefined;
  /** Очистить журнал. */
  reset: () => void;
}

export function createRendererJournal(): RendererJournal {
  const calls: RendererCall[] = [];
  return {
    calls,
    record: (name, ...args) => {
      calls.push({ name, args });
    },
    order: () => calls.map((entry) => entry.name),
    callsOf: (name) => calls.filter((entry) => entry.name === name),
    argsOf: (name) => calls.find((entry) => entry.name === name)?.args,
    reset: () => {
      calls.length = 0;
    },
  };
}

/**
 * Заглушка средства отображения: PixiJS в jsdom не работает, поэтому поле
 * боя подменяется. Методы — заглушки, журнал по умолчанию пуст: что писать
 * в него, каждый тест решает сам через `overrides`.
 */
export function createRendererStub(
  overrides: Partial<FieldRenderer> = {},
  journal: RendererJournal = createRendererJournal(),
): FieldRenderer {
  const stub: FieldRenderer = {
    mount: vi.fn(async () => undefined),
    update: vi.fn(),
    play: vi.fn(async () => {
      journal.record("play");
    }),
    pan: vi.fn(),
    destroy: vi.fn(),
    setOnActivate: vi.fn(),
    setOnHover: vi.fn(),
    setReducedMotion: vi.fn(),
    setSpeed: vi.fn(),
    playCinematic: vi.fn(async () => false),
    skipCinematic: vi.fn(),
    isCinematicPlaying: vi.fn(() => false),
    // Игровой масштаб камеры: его сцена запоминает перед первой половиной,
    // чтобы вторая вернулась к игровому кадру (0.20.41).
    getCameraScale: vi.fn(() => 1.25),
    fadeScreen: vi.fn(async () => undefined),
    setInputLocked: vi.fn(),
    setHiddenEntities: vi.fn(),
    // Ведение камеры кликом по портрету в верхней панели (0.20.42).
    focusEntity: vi.fn(),
  };
  return { ...stub, ...overrides };
}

/**
 * Фабрика для `vi.mock("@bylina/render", ...)`. Помимо средства отображения
 * пакет отдаёт `applyPaletteCssVariables`: без неё приложение не собирает
 * переменные палитры, поэтому подмена обязана вернуть и её.
 */
export function renderMock(stub: FieldRenderer): {
  createFieldRenderer: () => FieldRenderer;
  applyPaletteCssVariables: () => void;
} {
  return { createFieldRenderer: () => stub, applyPaletteCssVariables: () => undefined };
}

/**
 * Окружение jsdom под React: флаг `act`, `matchMedia`, `scrollTo`.
 * Вызывается в `beforeEach` или `beforeAll`; повторный вызов безопасен.
 */
export function installDomTestEnv(): void {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia =
    window.matchMedia ??
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
  window.scrollTo = window.scrollTo ?? (() => undefined);
}

/** Пауза: реальные таймеры — анимации экрана идут на них. */
export const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Дождаться условия: ленивая загрузка экрана, ход Нави. */
export async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await act(async () => {
      await tick(40);
    });
  }
  throw new Error("condition was not met in time");
}

/** Смонтированный узел: корень, контейнер и аккуратное снятие. */
export interface Mounted {
  root: Root;
  host: HTMLElement;
  unmount: () => Promise<void>;
}

/** Смонтировать произвольный узел в контейнер на `document.body`. */
export async function mountView(node: React.ReactNode): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    root,
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/**
 * Смонтировать приложение целиком (App из `game-pwa`): путь «меню → бой»
 * проходит настоящими экранами, поэтому тест видит реальную сборку сервисов.
 */
export async function mountApp(): Promise<Mounted> {
  vi.resetModules();
  const { App } = await import("../../../apps/game-pwa/src/App.js");
  return mountView(<App />);
}

/** Кнопка или элемент с таким текстом. */
export function byText(part: string, selector = "button"): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((element) =>
    (element.textContent ?? "").includes(part),
  );
  if (!found) throw new Error(`element not found: ${part}`);
  return found;
}

/** Событие указателя: jsdom не знает `PointerEvent`, React слушает по имени. */
export function pointerEvent(type: string, x = 12, y = 12): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
}

/** Короткое нажатие мышью. */
export async function press(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await tick(60);
  });
}

/**
 * Удержание: `pointerdown`, пауза дольше порога жеста, `pointerup`.
 * Порог жеста — 420 мс (см. `src/use-long-press.ts`).
 */
export async function hold(element: Element, ms = 520): Promise<void> {
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerdown"));
  });
  await act(async () => {
    await tick(ms);
  });
  await act(async () => {
    element.dispatchEvent(pointerEvent("pointerup"));
  });
  await act(async () => {
    await tick(40);
  });
}
