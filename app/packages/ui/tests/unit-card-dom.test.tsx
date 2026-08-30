// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseContent } from "@bylina/content";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";
import { createSession } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import type { FieldRenderer } from "@bylina/render";
import { ServicesProvider, Shell } from "../src/index.js";
import type { AppServices } from "../src/context.js";
import { dataTree } from "./training-sim.js";

/**
 * Портреты верхней панели (0.20.53): удержание открывает окно информации
 * о бойце — своём или видимом противнике, — а короткое нажатие делает
 * прежнюю работу: выбирает бойца или ведёт к противнику камеру. Поле боя
 * подменено заглушкой @bylina/render: PixiJS в jsdom не работает.
 */

const calls: { name: string; args: unknown[] }[] = [];

const rendererStub: FieldRenderer = {
  mount: vi.fn(async () => undefined),
  update: vi.fn(),
  play: vi.fn(async () => undefined),
  pan: vi.fn(),
  destroy: vi.fn(),
  setOnActivate: vi.fn(),
  setOnHover: vi.fn(),
  setReducedMotion: vi.fn(),
  setSpeed: vi.fn(),
  playCinematic: vi.fn(async () => false),
  skipCinematic: vi.fn(),
  isCinematicPlaying: vi.fn(() => false),
  getCameraScale: vi.fn(() => 1.25),
  fadeScreen: vi.fn(async () => undefined),
  setInputLocked: vi.fn(),
  setHiddenEntities: vi.fn(),
  focusEntity: vi.fn((...args: unknown[]) => {
    calls.push({ name: "focusEntity", args });
  }),
};

vi.mock("@bylina/render", () => ({
  createFieldRenderer: (): FieldRenderer => rendererStub,
  applyPaletteCssVariables: () => undefined,
}));

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Дождаться условия: ленивая загрузка экрана, ход Нави. */
async function waitFor(condition: () => boolean, timeoutMs = 10000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await act(async () => {
      await tick(40);
    });
  }
  throw new Error("condition was not met in time");
}

let root: Root;
let services: AppServices;

beforeAll(async () => {
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
  window.localStorage.clear();

  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error(`content parse failed: ${JSON.stringify(parsed.issues)}`);
  const i18n = createI18n({ manifest, catalogs: loadBundledCatalogs(), initialLanguage: "ru" });
  const settings = createSettings({ storage: null, allowedLanguages: manifest.languages.map((item) => item.code) });
  const session = createSession("menu");
  services = {
    i18n,
    settings,
    session,
    content: parsed.data,
    version: "test",
    install: { canInstall: false, installed: false, prompt: async () => undefined },
    debug: false,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <Shell />
      </ServicesProvider>,
    );
  });
  await act(async () => {
    await tick(20);
  });
  // Бой обучения «Удар»: богатырь и упырь на поле 8×8 — противник виден
  // со старта, поэтому в полосе есть его портрет.
  await act(async () => {
    session.startTrainingMission("combat");
  });
  await waitFor(() => document.querySelector(".battle-screen") !== null);
  await waitFor(() => document.querySelector(".roster .roster-card") !== null);
}, 60000);

afterAll(() => {
  document.body.innerHTML = "";
});

function pointerEvent(type: string): MouseEvent {
  // jsdom не знает PointerEvent: React слушает по имени события, поэтому
  // подходит мышиное событие с координатами.
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 12, clientY: 12 });
}

function face(selector: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`portrait not found: ${selector}`);
  return found;
}

/** Удержание дольше порога: жест открывает окно информации. */
async function hold(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(pointerEvent("pointerdown"));
  });
  await act(async () => {
    await tick(520);
  });
  await act(async () => {
    button.dispatchEvent(pointerEvent("pointerup"));
  });
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".unit-info");
  if (!found) throw new Error("окно информации о бойце не открыто");
  return found;
}

async function closeDialog(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await act(async () => {
    await tick(20);
  });
}

const rowValue = (label: string): string | undefined => {
  const row = [...dialog().querySelectorAll(".unit-info-row")].find(
    (candidate) => candidate.querySelector("dt")?.textContent === label,
  );
  return row?.querySelector("dd")?.textContent ?? undefined;
};

describe("portrait cards in the top panel (0.20.53)", () => {
  it(
    "opens the fighter window on a long press: description, parameters, equipment",
    async () => {
      const card = face(".roster .roster-card");
      expect(document.querySelector(".unit-info"), "окно закрыто").toBeNull();

      await hold(card);

      expect(dialog().getAttribute("role")).toBe("dialog");
      expect(dialog().querySelector(".eyebrow")?.textContent).toBe("Дружина");
      expect(dialog().querySelector("h3")?.textContent).toBe("Богатырь");
      // Описание из словаря — не сырой ключ.
      expect(dialog().querySelector(".unit-info-flavor")?.textContent?.length ?? 0).toBeGreaterThan(20);
      // Параметры из снимка боя: полное здоровье и полные очки действия.
      expect(rowValue("Здоровье")).toBe("12 / 12");
      expect(rowValue("Очки действия")).toBe("2 / 2");
      expect(rowValue("Меткость")).toBe("70");
      // Экипировка: в руках — меч, остальное перечислено рядом.
      const items = [...dialog().querySelectorAll(".unit-info-item")].map((item) => item.textContent ?? "");
      expect(items.join(" | ")).toContain("Меч");
      expect(items.join(" | ")).toContain("Палица");
      expect(dialog().querySelector(".unit-info-item-mark")?.textContent).toBe("в руках");
      expect(document.querySelector(".unit-info-backdrop"), "затемнение поверх боя").not.toBeNull();

      // Кнопка закрывает окно.
      await act(async () => {
        dialog().querySelector<HTMLButtonElement>(".unit-info-close")!.click();
      });
      expect(document.querySelector(".unit-info"), "окно закрыто кнопкой").toBeNull();
    },
    60000,
  );

  it(
    "keeps the short press: it selects the fighter and never opens the window",
    async () => {
      const card = face(".roster .roster-card");
      await act(async () => {
        card.dispatchEvent(pointerEvent("pointerdown"));
      });
      await act(async () => {
        await tick(80);
      });
      await act(async () => {
        card.dispatchEvent(pointerEvent("pointerup"));
        card.dispatchEvent(pointerEvent("click"));
      });
      await act(async () => {
        await tick(40);
      });
      expect(document.querySelector(".unit-info"), "короткое нажатие — не окно").toBeNull();
      expect(card.classList.contains("is-on"), "боец выбран").toBe(true);
    },
    60000,
  );

  it(
    "shows the enemy card with its own side and weapon",
    async () => {
      await waitFor(() => document.querySelector(".enemies-strip .enemy-face") !== null);
      const enemy = face(".enemies-strip .enemy-face");
      expect(enemy.disabled, "противник в поле зрения — портрет кликабелен").toBe(false);

      await hold(enemy);

      expect(dialog().querySelector(".eyebrow")?.textContent).toBe("Навь");
      expect(dialog().querySelector("h3")?.textContent).toBe("Упырь");
      expect(rowValue("Здоровье")).toBe("8 / 8");
      const items = [...dialog().querySelectorAll(".unit-info-item")].map((item) => item.textContent ?? "");
      // Упырь воюет когтями: умений у него нет, раздел один.
      expect(items.join(" | ")).toContain("Когти");
      expect(dialog().querySelectorAll(".unit-info-section").length).toBe(1);

      // Клик по фону закрывает окно, как у окна информации о действии.
      await act(async () => {
        document.querySelector<HTMLElement>(".unit-info-backdrop")!.click();
      });
      expect(document.querySelector(".unit-info"), "окно закрыто по фону").toBeNull();
    },
    60000,
  );
});
