// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { FieldRenderer } from "@bylina/render";
import { makeRig, refreshDeps } from "./training-sim.js";
import { resolveTrainingDirective } from "../src/training-scenario.js";

/**
 * Монтаж боя обучения (0.20.13): строгий сценарий виден в реальном
 * интерфейсе — плашка наставника, «свет прожектора», заблокированные
 * посторонние кнопки, пояснение отклонённого клика и исполнение
 * предписанной клетки. Рендер поля подменён заглушкой @bylina/render
 * (PixiJS не работает в jsdom), клики по полю подаются через
 * перехваченный обработчик setOnActivate.
 */

const updates: unknown[] = [];
let activate: ((x: number, y: number) => void) | null = null;
let hover: ((x: number, y: number) => void) | null = null;

const rendererStub: FieldRenderer = {
  mount: vi.fn(async () => undefined),
  update: vi.fn((view: unknown) => {
    updates.push(view);
  }),
  play: vi.fn(async () => undefined),
  pan: vi.fn(),
  destroy: vi.fn(),
  setOnActivate: vi.fn((handler: (x: number, y: number) => void) => {
    activate = handler;
  }),
  setOnHover: vi.fn((handler: (x: number, y: number) => void) => {
    hover = handler;
  }),
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
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("training battle DOM (0.20.13)", () => {
  it(
    "walks the movement mission: focus dimming, locked buttons, denied wrong cell, prescribed move",
    async () => {
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent): void => {
        errors.push(event.error ?? event.message);
      };
      window.addEventListener("error", onError);
      window.localStorage.clear();
      updates.length = 0;

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

      // Меню → экран обучения.
      const byText = (part: string): HTMLElement => {
        const found = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(part));
        if (!found) throw new Error(`button not found: ${part}`);
        return found as HTMLElement;
      };
      await act(async () => {
        byText("Обучение").click();
      });
      await act(async () => {
        await tick(60);
      });
      // Первая карточка — «Первые шаги».
      await act(async () => {
        byText("Первые шаги").click();
      });
      await act(async () => {
        await tick(120);
      });

      const screen = document.querySelector(".battle-screen");
      expect(screen, "battle screen mounted").not.toBeNull();
      expect(screen!.classList.contains("is-training-focus")).toBe(true);
      const coach = document.querySelector(".training-coach");
      expect(coach, "mentor card").not.toBeNull();

      // Шаг 1 — ознакомительный: кнопка «Далее» продвигает сценарий.
      const next = document.querySelector<HTMLButtonElement>(".training-continue");
      expect(next, "continue button on noop step").not.toBeNull();
      await act(async () => {
        next!.click();
      });
      await act(async () => {
        await tick(60);
      });

      // Шаг 2 — переход: указание разрешает ровно одну клетку (та же, что
      // вычисляет чистый модуль на том же семени).
      const rig = makeRig("movement");
      const hint = rig.hints.find((h) => h.until === "move")!;
      const view = resolveTrainingDirective(hint, refreshDeps(rig))!;
      if (view.directive.kind !== "move") throw new Error("expected move directive");
      const target = view.directive.cell;

      const last = updates[updates.length - 1] as {
        trainingFocus: boolean;
        trainingHighlight: { kind: string; x: number; y: number } | null;
      };
      expect(last.trainingFocus).toBe(true);
      expect(last.trainingHighlight).toEqual({ kind: "cell", x: target.x, y: target.y });

      // Посторонние действия заблокированы: оружие, стойка, дозор и конец хода.
      const sword = [...document.querySelectorAll<HTMLButtonElement>(".skill-slot")].find((b) =>
        b.textContent?.includes("Меч"),
      );
      const defend = [...document.querySelectorAll<HTMLButtonElement>(".skill-slot")].find((b) =>
        b.textContent?.includes("Защитная стойка"),
      );
      const endTurn = document.querySelector<HTMLButtonElement>(".hud-btn-primary");
      expect(sword?.disabled).toBe(true);
      expect(defend?.disabled).toBe(true);
      expect(endTurn?.disabled).toBe(true);

      // Клик в другую достижимую клетку отклоняется с пояснением.
      const reach = rig.kernel.getReachable(view.directive.actorId);
      const other = reach.find((c) => !(c.x === target.x && c.y === target.y))!;
      await act(async () => {
        activate!(other.x, other.y);
      });
      await act(async () => {
        await tick(40);
      });
      const log = document.querySelector(".battle-log");
      expect(log?.textContent).toContain("другую клетку");

      // Клик в предписанную клетку исполняется — сценарий идёт к шагу 3.
      await act(async () => {
        activate!(target.x, target.y);
      });
      await act(async () => {
        await tick(120);
      });
      const coachLine = document.querySelector(".training-coach-line");
      expect(coachLine?.textContent).toContain("Завершите ход");
      // Кнопка завершения хода разблокирована и подсвечена.
      const endTurn2 = document.querySelector<HTMLButtonElement>(".hud-btn-primary");
      expect(endTurn2?.disabled).toBe(false);
      expect(endTurn2?.classList.contains("hint-pulse")).toBe(true);

      await act(async () => {
        root.unmount();
      });
      window.removeEventListener("error", onError);
      expect(errors, `unhandled errors: ${String(errors[0])}`).toEqual([]);
    },
    { timeout: 20000 },
  );
});
