// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FieldRenderer } from "@bylina/render";

/**
 * Панель действий (0.20.46): кнопка-миниатюра с образом и мелким названием
 * под ним, активность — подсветкой самой кнопки (прежде перед названием
 * стоял кружок-радиомаркер), долгое нажатие открывает окно информации
 * поверх боя. Поле боя подменено заглушкой @bylina/render: PixiJS в
 * jsdom не работает.
 */

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
};

vi.mock("@bylina/render", () => ({
  createFieldRenderer: (): FieldRenderer => rendererStub,
  applyPaletteCssVariables: () => undefined,
}));

beforeEach(() => {
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
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Кнопка панели действий по названию. */
function slot(part: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".hud-btn.skill-slot")].find((button) =>
    (button.querySelector(".action-name")?.textContent ?? "").includes(part),
  );
  if (!found) {
    const names = [...document.querySelectorAll(".skill-slot .action-name")].map((n) => n.textContent);
    throw new Error(`action button not found: ${part} (есть: ${names.join(", ")})`);
  }
  return found;
}

function pointerEvent(type: string): MouseEvent {
  // jsdom не знает PointerEvent: React слушает по имени события, поэтому
  // подходит мышиное событие с координатами.
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 12, clientY: 12 });
}

const cssText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/battle.css"), "utf8");

async function mountQuickMatch(): Promise<void> {
  vi.resetModules();
  const { App } = await import("../../../apps/game-pwa/src/App.js");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await tick(1400);
  });
  const byText = (part: string): HTMLElement => {
    const found = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(part));
    if (!found) throw new Error(`button not found: ${part}`);
    return found as HTMLElement;
  };
  await act(async () => {
    byText("Быстрый матч").click();
  });
  await act(async () => {
    await tick(80);
  });
  // Быстрый матч начинается с выбора трудности.
  await act(async () => {
    byText("Обычный").click();
  });
  for (let i = 0; i < 40 && !document.querySelector(".battle-screen"); i += 1) {
    await act(async () => {
      await tick(60);
    });
  }
  expect(document.querySelector(".battle-screen"), "battle screen mounted").not.toBeNull();
}

describe("action panel (0.20.46)", () => {
  it("draws every action as a compact square button: art on top, small name under it", async () => {
    await mountQuickMatch();
    const slots = [...document.querySelectorAll<HTMLButtonElement>(".hud-btn.skill-slot")];
    expect(slots.length, "панель не пуста").toBeGreaterThan(0);
    for (const button of slots) {
      // Образ есть всегда: либо сама иконка, либо рамка-заглушка.
      expect(button.querySelector(".action-art"), "образ действия").not.toBeNull();
      const name = button.querySelector(".action-name");
      expect(name, "название").not.toBeNull();
      // Порядок в разметке — образ выше названия (название «под картинкой»).
      const children = [...button.children];
      expect(children.indexOf(button.querySelector(".action-art") as Element)).toBeLessThan(
        children.indexOf(name as Element),
      );
    }
    // Кнопки квадратные: ширина и высота заданы одинаково.
    const rule = cssText.slice(
      cssText.indexOf("\n.skill-slot {"),
      cssText.indexOf("}", cssText.indexOf("\n.skill-slot {")),
    );
    expect(rule).toContain("width: 64px");
    expect(rule).toContain("height: 64px");
  }, 60000);

  it("marks the active action by highlighting the button, not by a radio marker", async () => {
    // Кружок-радиомаркер перед названием убран: состояние читается рамкой
    // и свечением самой кнопки.
    expect(cssText).not.toMatch(/\.skill-slot::before/);
    expect(cssText).not.toMatch(/padding-left:\s*22px/);
    expect(cssText).toMatch(/\.skill-slot\.is-active[\s\S]{0,240}border-color:\s*#e0b34a/);
    expect(cssText).toMatch(/\.skill-slot\.is-active \.action-art/);
  });

  it("centers the row when the buttons fit and falls back to a scrolling strip", async () => {
    const row = cssText.slice(
      cssText.indexOf("\n.skill-row {"),
      cssText.indexOf("}", cssText.indexOf("\n.skill-row {")),
    );
    expect(row).toContain("justify-content: center");
    // Узкие экраны: та же лента, но `safe center` — при переполнении
    // первый ряд не уходит за левый край.
    expect(cssText.match(/justify-content:\s*safe center/g)?.length ?? 0).toBe(2);
  });

  it("opens the info window on a long press: name, bigger art, muted flavor, numbers", async () => {
    await mountQuickMatch();
    const sword = slot("Меч");
    expect(sword.disabled, "удар доступен в начале матча").toBe(false);
    expect(document.querySelector(".action-info"), "окно закрыто").toBeNull();

    await act(async () => {
      sword.dispatchEvent(pointerEvent("pointerdown"));
    });
    // Короткое нажатие окно не открывает: действие выбирается кликом.
    await act(async () => {
      await tick(120);
    });
    expect(document.querySelector(".action-info"), "короткое нажатие — не окно").toBeNull();
    await act(async () => {
      await tick(420);
    });

    const backdrop = document.querySelector(".action-info-backdrop");
    expect(backdrop, "затемнение поверх боя").not.toBeNull();
    const dialog = document.querySelector(".action-info");
    expect(dialog, "окно информации").not.toBeNull();
    expect(dialog!.getAttribute("role")).toBe("dialog");
    expect(dialog!.querySelector(".action-info-art"), "образ крупнее").not.toBeNull();
    expect(dialog!.querySelector("h3")?.textContent).toContain("Меч");
    expect(dialog!.querySelector(".action-info-flavor")?.textContent?.length ?? 0).toBeGreaterThan(10);
    const rows = [...dialog!.querySelectorAll(".action-info-row")].map(
      (row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`,
    );
    expect(rows.join(" | ")).toContain("Очки действия: 1");
    expect(rows.join(" | ")).toContain("Завершает ход");
    expect(rows.join(" | ")).toContain("Урон");

    // Клик после долгого нажатия не выбирает действие: жест уже отработан.
    await act(async () => {
      sword.dispatchEvent(pointerEvent("pointerup"));
      sword.dispatchEvent(pointerEvent("click"));
    });
    expect(sword.getAttribute("aria-pressed")).toBe("false");

    // Escape закрывает окно.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".action-info"), "окно закрыто по Escape").toBeNull();
  }, 60000);

  it("keeps the ordinary click: a short press selects the action", async () => {
    await mountQuickMatch();
    const sword = slot("Меч");
    await act(async () => {
      sword.dispatchEvent(pointerEvent("pointerdown"));
    });
    await act(async () => {
      await tick(80);
    });
    await act(async () => {
      sword.dispatchEvent(pointerEvent("pointerup"));
      sword.dispatchEvent(pointerEvent("click"));
    });
    await act(async () => {
      await tick(60);
    });
    expect(document.querySelector(".action-info"), "окно не открылось").toBeNull();
    expect(sword.getAttribute("aria-pressed")).toBe("true");
    expect(sword.classList.contains("is-active")).toBe(true);
  }, 60000);
});
