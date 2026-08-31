// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  byText,
  createRendererStub,
  installDomTestEnv,
  mountApp,
  pointerEvent,
  press,
  renderMock,
  tick,
  waitFor,
} from "./harness.js";

/**
 * Панель действий (0.20.46): кнопка-миниатюра с образом и мелким названием
 * под ним, активность — подсветкой самой кнопки (прежде перед названием
 * стоял кружок-радиомаркер), долгое нажатие открывает окно информации
 * поверх боя. Поле боя подменено заглушкой @bylina/render: PixiJS в
 * jsdom не работает.
 */

const rendererStub = createRendererStub();

vi.mock("@bylina/render", () => renderMock(rendererStub));

beforeEach(() => {
  installDomTestEnv();
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

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

const cssText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/battle.css"), "utf8");

async function mountQuickMatch(): Promise<void> {
  await mountApp();
  await act(async () => {
    await tick(1400);
  });
  await press(byText("Быстрый матч"));
  // Быстрый матч начинается с выбора трудности.
  await press(byText("Обычный"));
  await waitFor(() => document.querySelector(".battle-screen") !== null);
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
