// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * Смена сражения в смонтированном экране боя (0.20.38).
 *
 * Экран сражения держит ядро партии, счётчик хода, подсказку и карточку
 * миссии в собственном состоянии. Переходы «итог миссии → следующая
 * миссия» и «итог миссии → повтор той же миссии» не покидают экран боя,
 * поэтому оболочка обязана перемонтировать его: иначе бой продолжается
 * на поле предыдущей миссии.
 *
 * Регрессия: после победы в М1 поочерёдно показывались итоговые тексты
 * М2, М3 и М4, сами миссии пропускались, и игра сразу переходила
 * в свободную былину.
 */

/** Журнал обращений к средству отображения: порядок и аргументы. */
const calls: { name: string; args: unknown[] }[] = [];

const record = (name: string) => (...args: unknown[]): void => {
  calls.push({ name, args });
};

let activate: ((x: number, y: number) => void) | null = null;

const rendererStub: FieldRenderer = {
  mount: vi.fn(async () => undefined),
  update: vi.fn(),
  play: vi.fn(async () => {
    calls.push({ name: "play", args: [] });
  }),
  pan: vi.fn(),
  destroy: vi.fn(),
  setOnActivate: vi.fn((handler: (x: number, y: number) => void) => {
    activate = handler;
  }),
  setOnHover: vi.fn(),
  setReducedMotion: vi.fn(),
  setSpeed: vi.fn(),
  playCinematic: vi.fn(async (plan) => {
    calls.push({ name: "playCinematic", args: [plan] });
    return false;
  }),
  skipCinematic: vi.fn(),
  isCinematicPlaying: vi.fn(() => false),
  fadeScreen: vi.fn(async () => undefined),
  setInputLocked: vi.fn(),
  setHiddenEntities: vi.fn(record("setHiddenEntities")),
};

/** Порядок имён в журнале. */
const order = (): string[] => calls.map((entry) => entry.name);

vi.mock("@bylina/render", () => ({
  createFieldRenderer: (): FieldRenderer => rendererStub,
  applyPaletteCssVariables: () => undefined,
}));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia ?? ((query: string) => ({
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
  activate = null;
  calls.length = 0;
});

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Дождаться условия (ленивая загрузка экрана, анимации хода). */
async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await act(async () => {
      await tick(40);
    });
  }
  throw new Error("condition was not met in time");
}

/** Текст сюжетной карточки (вступление либо итог миссии). */
const cardText = (): string => document.querySelector(".training-over-card")?.textContent ?? "";

const cardButton = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(".training-over-card button");

async function mountShell(): Promise<{ root: Root; services: AppServices }> {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error(`content parse failed: ${JSON.stringify(parsed.issues)}`);
  const content = parsed.data;
  const i18n = createI18n({ manifest, catalogs: loadBundledCatalogs(), initialLanguage: "ru" });
  const settings = createSettings({ storage: null, allowedLanguages: manifest.languages.map((item) => item.code) });
  const session = createSession("menu");
  const services: AppServices = {
    i18n,
    settings,
    session,
    content,
    version: "test",
    install: { canInstall: false, installed: false, prompt: async () => undefined },
    debug: false,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
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
  return { root, services };
}

describe("battle screen remount between prologue missions (0.20.38)", () => {
  it(
    "starts mission M2 after the outro of M1 instead of skipping it",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;

      // М1: вступление.
      await act(async () => {
        session.startPrologue("prologue_brushwood", true);
      });
      await waitFor(() => document.querySelector(".battle-screen") !== null);
      expect(session.get().prologueMissionId).toBe("prologue_brushwood");
      expect(cardText(), "M1 intro card").toContain("Староста просил хворосту");
      const dismiss = cardButton();
      expect(dismiss).not.toBeNull();
      await act(async () => {
        dismiss!.click();
      });
      await act(async () => {
        await tick(80);
      });
      expect(document.querySelector(".training-over-card"), "card is dismissed").toBeNull();

      const clickCell = async (x: number, y: number): Promise<void> => {
        await act(async () => {
          activate?.(x, y);
        });
        await act(async () => {
          await tick(30);
        });
      };
      const endTurn = async (): Promise<void> => {
        const button = document.querySelector<HTMLButtonElement>(".end-turn");
        if (!button || button.disabled) return;
        await act(async () => {
          button.click();
        });
        await act(async () => {
          await tick(700);
        });
      };

      // М1: Микула идёт к палке — подбор вооружает его и выводит крысу.
      for (let guard = 0; guard < 60; guard += 1) {
        const snap = session.getBattleSnapshot(1);
        const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant" && !entity.dead);
        const stick = snap.entities.find((entity) => entity.configId === "stick");
        if (!mikula || !stick) break;
        // Клетка с предметом занята, поэтому маршрут до палки ядро не строит:
        // идём по достижимым клеткам, каждый раз выбирая ближайшую к цели.
        const distance = (x: number, y: number): number => Math.abs(x - stick.x) + Math.abs(y - stick.y);
        const here = distance(mikula.x, mikula.y);
        const reach = mikula.ap > 0 ? session.getBattleReachable(mikula.id) : [];
        let best: { x: number; y: number; d: number } | null = null;
        for (const cell of reach) {
          const d = distance(cell.x, cell.y);
          if (d >= here) continue;
          if (!best || d < best.d) best = { x: cell.x, y: cell.y, d };
        }
        if (!best) {
          await endTurn();
          continue;
        }
        await clickCell(best.x, best.y);
      }
      await act(async () => {
        await tick(150);
      });

      // Палка подобрана, крыса вышла (сцена появления доигрывается заглушкой).
      const afterPickup = session.getBattleSnapshot(1);
      expect(afterPickup.entities.some((entity) => entity.configId === "stick"), "stick is taken").toBe(false);
      expect(
        afterPickup.entities.some((entity) => entity.configId === "forest_rat" && !entity.dead),
        "rat has entered",
      ).toBe(true);

      // Крыса — полноценный враг: Микула бьёт её дубиной (сценарий М1 требует
      // подобрать палку и очистить поле). Клик по врагу включает основное
      // оружие, повторный клик по той же цели — удар.
      const liveRat = (): { x: number; y: number } | null => {
        const entity = session
          .getBattleSnapshot(1)
          .entities.find((candidate) => candidate.configId === "forest_rat" && !candidate.dead);
        return entity ? { x: entity.x, y: entity.y } : null;
      };
      const ownAp = (): number =>
        session
          .getBattleSnapshot(1)
          .entities.filter((entity) => !entity.dead && entity.owner === 1 && entity.maxAp > 0)
          .reduce((sum, entity) => sum + entity.ap, 0);
      for (let guard = 0; guard < 12 && liveRat(); guard += 1) {
        await waitFor(() => session.getBattleSnapshot(1).activeOwner === 1 || liveRat() === null, 8000);
        const rat = liveRat();
        if (!rat) break;
        if (ownAp() === 0) {
          await endTurn();
          continue;
        }
        await clickCell(rat.x, rat.y);
        await clickCell(rat.x, rat.y);
      }
      await act(async () => {
        await tick(220);
      });
      expect(liveRat(), "rat is destroyed by the hero").toBeNull();
      // Итог не перекрывает поле мгновенно (0.20.39): сначала доигрывают
      // последние числа урона и гибель, затем выдерживается пауза.
      expect(cardText(), "outcome waits for the animations").toBe("");
      await waitFor(() => cardText().length > 0, 8000);

      // Итог М1.
      expect(cardText(), "M1 outro card").toContain("Из леса доносится крик");
      const next = cardButton();
      expect(next).not.toBeNull();

      // Переход к М2: миссия обязана НАЧАТЬСЯ — вступлением и своей картой.
      await act(async () => {
        next!.click();
      });
      await act(async () => {
        await tick(120);
      });

      expect(session.get().prologueMissionId).toBe("prologue_cry");
      const started = session.getBattleSnapshot(1);
      // Карта М2 — 12×9, карта М1 — 20×6: совпадение означало бы прежнее ядро.
      expect(started.grid.width, "battle is rebuilt for M2").toBe(12);
      expect(started.grid.height, "battle is rebuilt for M2").toBe(9);
      expect(
        started.entities.some((entity) => entity.configId === "fedot_stranded"),
        "M2 roster is on the field",
      ).toBe(true);
      expect(cardText(), "M2 intro, not M2 outro").toContain("Кто-то кричал в чаще");
      expect(cardText(), "no M2 spoiler").not.toContain("Федот спасён");

      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 60000 },
  );

  it(
    "zooms the camera for the scene and hides the rat until it runs in",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;

      await act(async () => {
        session.startPrologue("prologue_brushwood", true);
      });
      await waitFor(() => document.querySelector(".battle-screen") !== null);
      const dismiss = cardButton();
      await act(async () => {
        dismiss!.click();
      });
      // Вступление: сцена уходит в средство отображения с приближением —
      // при подгонке «поле целиком» камера не смогла бы ехать.
      await waitFor(() => calls.some((entry) => entry.name === "playCinematic"));
      const plan = calls.find((entry) => entry.name === "playCinematic")?.args[0] as { id: string; zoom?: number };
      expect(plan.id).toBe("m1_intro");
      expect(plan.zoom ?? 0, "camera zooms in for the scene").toBeGreaterThan(1);

      // Поход к палке: крыса выходит по триггеру подбора.
      const clickCell = async (x: number, y: number): Promise<void> => {
        await act(async () => {
          activate?.(x, y);
        });
        await act(async () => {
          await tick(30);
        });
      };
      const endTurn = async (): Promise<void> => {
        const button = document.querySelector<HTMLButtonElement>(".end-turn");
        if (!button || button.disabled) return;
        await act(async () => {
          button.click();
        });
        await act(async () => {
          await tick(700);
        });
      };
      calls.length = 0;
      for (let guard = 0; guard < 60; guard += 1) {
        const snap = session.getBattleSnapshot(1);
        const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant" && !entity.dead);
        const stick = snap.entities.find((entity) => entity.configId === "stick");
        if (!mikula || !stick) break;
        const distance = (x: number, y: number): number => Math.abs(x - stick.x) + Math.abs(y - stick.y);
        const here = distance(mikula.x, mikula.y);
        const reach = mikula.ap > 0 ? session.getBattleReachable(mikula.id) : [];
        let best: { x: number; y: number; d: number } | null = null;
        for (const cell of reach) {
          const d = distance(cell.x, cell.y);
          if (d >= here) continue;
          if (!best || d < best.d) best = { x: cell.x, y: cell.y, d };
        }
        if (!best) {
          await endTurn();
          continue;
        }
        await clickCell(best.x, best.y);
      }
      await waitFor(() => calls.some((entry) => entry.name === "setHiddenEntities"), 8000);

      // Крыса рождается ядром сразу, но на поле её не показывают: скрытие
      // приходит ДО проигрывания событий хода, иначе она мелькнула бы
      // в клетке появления, а потом выбегала заново.
      const rat = session
        .getBattleSnapshot(1)
        .entities.find((entity) => entity.configId === "forest_rat" && !entity.dead);
      expect(rat, "rat has spawned in the kernel").toBeDefined();
      const at = calls.findIndex((entry) => entry.name === "setHiddenEntities");
      expect(at, "the rat is hidden").toBeGreaterThanOrEqual(0);
      expect(calls[at]?.args[0], "exactly the rat is hidden").toEqual([rat!.id]);
      // Скрытие приходит ДО проигрывания событий того же хода: иначе крыса
      // мелькнула бы в клетке появления, а потом выбегала заново.
      expect(order()[at + 1], "events play after the hide").toBe("play");

      // После вбегания сцена возвращает видимость.
      await waitFor(() => calls.some((entry) => entry.name === "playCinematic"), 8000);
      await waitFor(
        () =>
          calls.some(
            (entry) => entry.name === "setHiddenEntities" && Array.isArray(entry.args[0]) && entry.args[0].length === 0,
          ),
        8000,
      );

      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 60000 },
  );

  it(
    "restarts the same mission from scratch without leaving the battle screen",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;

      await act(async () => {
        session.startPrologue("prologue_brushwood", true);
      });
      await waitFor(() => document.querySelector(".battle-screen") !== null);
      const dismiss = cardButton();
      await act(async () => {
        dismiss!.click();
      });
      await act(async () => {
        await tick(80);
      });

      // Шаг с места: состояние партии изменилось.
      const snap = session.getBattleSnapshot(1);
      const mikula = snap.entities.find((entity) => entity.configId === "mikula_peasant" && !entity.dead);
      expect(mikula).toBeDefined();
      const start = { x: mikula!.x, y: mikula!.y };
      const reach = session.getBattleReachable(mikula!.id);
      const step = reach.find((cell) => cell.x !== start.x || cell.y !== start.y)!;
      await act(async () => {
        activate?.(step.x, step.y);
      });
      await act(async () => {
        await tick(60);
      });
      const moved = session.getBattleSnapshot(1).entities.find((entity) => entity.id === mikula!.id)!;
      expect(`${moved.x},${moved.y}`, "hero made a step").not.toBe(`${start.x},${start.y}`);

      // Повтор миссии («ещё раз» после поражения): та же миссия и тот же
      // посев — бой всё равно обязан собраться заново.
      await act(async () => {
        session.startPrologue("prologue_brushwood", true);
      });
      await act(async () => {
        await tick(120);
      });

      expect(cardText(), "M1 intro is shown again").toContain("Староста просил хворосту");
      const restarted = session.getBattleSnapshot(1);
      const again = restarted.entities.find((entity) => entity.configId === "mikula_peasant" && !entity.dead);
      expect(again, "hero is alive on the fresh field").toBeDefined();
      expect(`${again!.x},${again!.y}`, "hero is back at the start").toBe(`${start.x},${start.y}`);
      expect(again!.ap, "action points are restored").toBe(mikula!.ap);
      expect(
        restarted.entities.some((entity) => entity.configId === "stick"),
        "the stick is on the field again",
      ).toBe(true);

      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 30000 },
  );
});
