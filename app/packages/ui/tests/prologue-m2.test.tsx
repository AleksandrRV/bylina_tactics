// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseContent } from "@bylina/content";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";
import { createSession } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import type { CinematicPlan, FieldRenderer } from "@bylina/render";
import { ServicesProvider, Shell } from "../src/index.js";
import type { AppServices } from "../src/context.js";
import { dataTree } from "./training-sim.js";

/**
 * Поведение миссии М2 «Крик в чаще» (0.20.45).
 *
 * Проверяется не картинка, а порядок вещей, который видит игрок:
 *   1. увязший Федот не боец и в дружину не входит, пока не освобождён;
 *   2. первое потраченное ОД обрывает ход героя — рывок останавливается
 *      на полпути, одно ОД остаётся на стойку, всё прочее закрыто;
 *   3. зона эвакуации загорается не при освобождении, а после того, как
 *      стая выбежала на поле и отыграла сцену.
 */

/** Журнал обращений к средству отображения. */
const calls: { name: string; args: unknown[] }[] = [];
const record =
  (name: string) =>
  (...args: unknown[]): void => {
    calls.push({ name, args });
  };

let activate: ((x: number, y: number) => void) | null = null;

const rendererStub: FieldRenderer = {
  mount: vi.fn(async () => undefined),
  update: vi.fn(),
  play: vi.fn(async () => undefined),
  pan: vi.fn(),
  destroy: vi.fn(),
  setOnActivate: vi.fn((handler: (x: number, y: number) => void) => {
    activate = handler;
  }),
  setOnHover: vi.fn(),
  setReducedMotion: vi.fn(),
  setSpeed: vi.fn(),
  playCinematic: vi.fn(async (plan: CinematicPlan) => {
    // План целиком (0.20.52): тесту нужны не только имя сцены, но и
    // сущности, которых она выводит на поле.
    calls.push({ name: "playCinematic", args: [plan] });
    return false;
  }),
  skipCinematic: vi.fn(),
  isCinematicPlaying: vi.fn(() => false),
  getCameraScale: vi.fn(() => 1.25),
  fadeScreen: vi.fn(async () => undefined),
  setInputLocked: vi.fn(),
  setHiddenEntities: vi.fn(record("setHiddenEntities")),
  focusEntity: vi.fn(),
};

vi.mock("@bylina/render", () => ({
  createFieldRenderer: (): FieldRenderer => rendererStub,
  applyPaletteCssVariables: () => undefined,
}));

beforeEach(() => {
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

/** Сыгранные сцены в порядке вызова. */
const playedScenes = (): string[] =>
  calls
    .filter((entry) => entry.name === "playCinematic")
    .map((entry) => String((entry.args[0] as CinematicPlan | undefined)?.id));

/** План сыгранной сцены по её имени. */
const scenePlan = (id: string): CinematicPlan | undefined =>
  calls.find((entry) => entry.name === "playCinematic" && (entry.args[0] as CinematicPlan | undefined)?.id === id)
    ?.args[0] as CinematicPlan | undefined;

/** Начать М2: экран боя, вступительная карточка закрыта. */
async function startM2(root: Root, session: AppServices["session"]): Promise<void> {
  await act(async () => {
    session.startPrologue("prologue_cry", true);
  });
  await waitFor(() => document.querySelector(".battle-screen") !== null);
  const dismiss = document.querySelector<HTMLButtonElement>(".training-over-card button");
  expect(dismiss, "вступление М2").not.toBeNull();
  await act(async () => {
    dismiss!.click();
  });
  await waitFor(() => document.querySelector(".training-over-card") === null);
  await act(async () => {
    await tick(80);
  });
}

describe("prologue M2 beat (0.20.45)", () => {
  it(
    "keeps the stranded Fedot out of the roster until he is freed",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;
      await startM2(root, session);

      // В дружине один боец: Федот увяз и управлению не подлежит.
      expect(document.querySelectorAll(".roster-card")).toHaveLength(1);
      const fedot = session.getBattleSnapshot(1).entities.find((entity) => entity.configId === "fedot_stranded")!;
      expect(fedot.maxAp).toBe(0);
      expect(fedot.immobileTurns).toBeGreaterThan(0);

      // Клик по нему не делает его выбранным бойцом.
      await act(async () => {
        activate?.(fedot.x, fedot.y);
      });
      await act(async () => {
        await tick(60);
      });
      expect(
        session.getBattleSnapshot(1).entities.filter((entity) => entity.configId === "fedot_stranded")?.[0]?.maxAp,
      ).toBe(0);

      // Зона эвакуации тёмная: она появится только после стаи.
      expect(session.getBattleSnapshot(1).grid.tiles.filter((tile) => tile.extract)).toHaveLength(0);

      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 60000 },
  );

  it(
    "stops the hero after the first AP: the dash breaks off and the stance owns the turn",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;
      await startM2(root, session);

      const hero = () => session.getBattleSnapshot(1).entities.find((entity) => entity.configId === "mikula_peasant")!;
      const endTurn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(".end-turn");
      const stanceButton = (): HTMLButtonElement | null =>
        [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
          (button.textContent ?? "").includes("Защитная стойка"),
        ) ?? null;
      const clickCell = async (x: number, y: number): Promise<void> => {
        await act(async () => {
          activate?.(x, y);
        });
        await act(async () => {
          await tick(60);
        });
      };

      // Вступление: герой → Федот → герой.
      expect(playedScenes(), "сцена вступления М2").toContain("m2_intro");

      // Заказываем рывок: клетка за два ОД.
      const start = hero();
      const dash = session
        .getBattleReachable(start.id)
        .filter((cell) => cell.apCost === 2)
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
      await clickCell(dash.x, dash.y);

      // Герой прошёл, но не весь путь: второе ОД принадлежит стойке.
      const moved = hero();
      expect(moved.ap, "одно ОД осталось на стойку").toBe(1);
      expect(`${moved.x},${moved.y}`, "рывок оборван, а не отменён").not.toBe(`${start.x},${start.y}`);
      expect(`${moved.x},${moved.y}`, "рывок не дошёл до цели").not.toBe(`${dash.x},${dash.y}`);

      // Подсказка называет причину, кнопка стойки пульсирует.
      expect(document.querySelector(".training-note")?.textContent ?? "").toContain("шум в кустах");
      expect(stanceButton()?.className, "кнопка стойки пульсирует").toContain("hint-pulse");
      expect(stanceButton()?.disabled, "стойка доступна").toBe(false);
      // Всё прочее закрыто, включая «Конец хода».
      expect(endTurn()?.disabled, "конец хода закрыт").toBe(true);
      expect(
        [...document.querySelectorAll<HTMLButtonElement>(".hud-btn.skill-slot")].filter((button) => !button.disabled),
        "кроме стойки доступна только она",
      ).toHaveLength(1);

      // «Конец хода» не проходит даже нажатием: ход остаётся у игрока.
      const turnBefore = session.getBattleSnapshot(1).turnNumber;
      await act(async () => {
        endTurn()?.click();
      });
      await act(async () => {
        await tick(200);
      });
      expect(session.getBattleSnapshot(1).turnNumber).toBe(turnBefore);
      expect(session.getBattleSnapshot(1).activeOwner).toBe(1);

      // Стойка: после неё выходят две крысы и играется сцена засады.
      await act(async () => {
        stanceButton()?.click();
      });
      await waitFor(
        () =>
          session.getBattleSnapshot(1).entities.filter((entity) => entity.configId === "forest_rat" && !entity.dead)
            .length >= 2,
      );
      expect(playedScenes(), "сцена засады").toContain("m2_ambush");
      // Крысы появляются скрытыми: на поле их выводит сцена.
      expect(calls.some((entry) => entry.name === "setHiddenEntities")).toBe(true);

      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 90000 },
  );

  it(
    "выводит обеих крыс засады той же сценой, а не после неё (0.20.52)",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;
      await startM2(root, session);

      const hero = () => session.getBattleSnapshot(1).entities.find((entity) => entity.configId === "mikula_peasant")!;
      const rats = () =>
        session.getBattleSnapshot(1).entities.filter((entity) => entity.configId === "forest_rat" && !entity.dead);
      const clickCell = async (x: number, y: number): Promise<void> => {
        await act(async () => {
          activate?.(x, y);
        });
        await act(async () => {
          await tick(60);
        });
      };
      const clickButton = async (label: string): Promise<void> => {
        const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
          (candidate.textContent ?? "").includes(label),
        );
        await act(async () => {
          button?.click();
        });
        await act(async () => {
          await tick(120);
        });
      };

      // Рывок и стойка: засада выходит на поле.
      const start = hero();
      const dash = session
        .getBattleReachable(start.id)
        .filter((cell) => cell.apCost === 2)
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
      await clickCell(dash.x, dash.y);
      await clickButton("Защитная стойка");
      await waitFor(() => rats().length >= 2);

      // Сцена засады выводит обеих: вторая крыса больше не ждёт за кадром.
      const ambush = scenePlan("m2_ambush");
      expect(ambush, "сцена засады сыграна").not.toBeUndefined();
      expect(ambush!.revealIds?.length, "обе крысы вбегают по сцене").toBe(2);
      const spawned = new Set(rats().map((entity) => entity.id));
      for (const id of ambush!.revealIds ?? []) {
        expect(spawned.has(id), `крыса ${id} вышла на поле`).toBe(true);
      }
      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 90000 },
  );

  it(
    "сообщение засады показывается окном, а не строкой над кнопками (0.20.52)",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;
      await startM2(root, session);

      const hero = () => session.getBattleSnapshot(1).entities.find((entity) => entity.configId === "mikula_peasant")!;
      const clickCell = async (x: number, y: number): Promise<void> => {
        await act(async () => {
          activate?.(x, y);
        });
        await act(async () => {
          await tick(60);
        });
      };

      // Рывок: второе ОД заперто — ход не отдаётся, пока не принята стойка.
      const start = hero();
      const dash = session
        .getBattleReachable(start.id)
        .filter((cell) => cell.apCost === 2)
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
      await clickCell(dash.x, dash.y);

      // Гейт миссии: пока стойка не принята, любой шаг отклоняется — и
      // реплика приходит окном, а не строкой над кнопками действий.
      const onward = hero();
      const step = session.getBattleReachable(onward.id).filter((cell) => cell.apCost === 1)[0]!;
      await clickCell(step.x, step.y);

      const card = document.querySelector<HTMLElement>(".story-note-card");
      expect(card, "окно сообщения").not.toBeNull();
      expect(card?.textContent ?? "", "текст реплики").toContain("шум в кустах");
      // Журнал боя остаётся за короткими репликами боя, а не за сюжетом.
      expect(document.querySelector(".battle-log")?.textContent ?? "", "журнал не дублирует реплику").not.toContain(
        "шум в кустах",
      );

      // Окно закрывается кнопкой.
      await act(async () => {
        card?.querySelector<HTMLButtonElement>("button")?.click();
      });
      await act(async () => {
        await tick(60);
      });
      expect(document.querySelector(".story-note-card"), "окно закрыто").toBeNull();
      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 90000 },
  );

  it(
    "lights the exit only after the swarm has run out",
    async () => {
      const { root, services } = await mountShell();
      const { session } = services;
      await startM2(root, session);

      const hero = () => session.getBattleSnapshot(1).entities.find((entity) => entity.configId === "mikula_peasant")!;
      const rats = () =>
        session.getBattleSnapshot(1).entities.filter((entity) => entity.configId === "forest_rat" && !entity.dead);
      const clickCell = async (x: number, y: number): Promise<void> => {
        await act(async () => {
          activate?.(x, y);
        });
        await act(async () => {
          await tick(60);
        });
      };
      const clickButton = async (label: string): Promise<boolean> => {
        const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
          (candidate.textContent ?? "").includes(label),
        );
        if (!button || button.disabled) return false;
        await act(async () => {
          button.click();
        });
        await act(async () => {
          await tick(120);
        });
        return true;
      };
      /** Дождаться своего хода: пока идёт проигрывание, ввод закрыт. */
      const waitPlayerTurn = async (): Promise<void> => {
        await waitFor(() => {
          const end = document.querySelector<HTMLButtonElement>(".end-turn");
          return session.getBattleSnapshot(1).activeOwner === 1 && end !== null && !end.disabled;
        }, 15000);
      };

      // Первый шаг и стойка: засада позади.
      const start = hero();
      const step = session.getBattleReachable(start.id).filter((cell) => cell.apCost === 1)[0]!;
      await clickCell(step.x, step.y);
      await clickButton("Защитная стойка");
      await waitFor(() => rats().length >= 2);
      await waitPlayerTurn();

      // Дальше — дорога к Федоту: бьём крыс, если они под рукой, иначе идём.
      let freed = false;
      for (let guard = 0; guard < 60 && !freed; guard += 1) {
        await waitPlayerTurn();
        const me = hero();
        const fedot = session
          .getBattleSnapshot(1)
          .entities.find((entity) => entity.configId === "fedot_stranded" && !entity.dead);
        if (!me || !fedot) break;
        const adjacent = rats().find((rat) => Math.abs(rat.x - me.x) + Math.abs(rat.y - me.y) <= 1);
        if (adjacent && me.ap > 0) {
          // Клик по врагу включает оружие, повторный — удар.
          await clickCell(adjacent.x, adjacent.y);
          await clickCell(adjacent.x, adjacent.y);
          continue;
        }
        if (Math.abs(me.x - fedot.x) + Math.abs(me.y - fedot.y) <= 1) {
          freed = true;
          break;
        }
        if (me.ap === 0) {
          await clickButton("Завершить ход");
          continue;
        }
        const reachable = session.getBattleReachable(me.id);
        const distance = (x: number, y: number): number => Math.abs(x - fedot.x) + Math.abs(y - fedot.y);
        let best: { x: number; y: number; d: number } | null = null;
        for (const cell of reachable) {
          const d = distance(cell.x, cell.y);
          if (!best || d < best.d) best = { x: cell.x, y: cell.y, d };
        }
        if (!best) {
          await clickButton("Завершить ход");
          continue;
        }
        await clickCell(best.x, best.y);
        freed = session
          .getBattleSnapshot(1)
          .entities.some((entity) => entity.configId === "fedot_stranded" && entity.maxAp > 0);
      }

      // Федот освобождён: он боец и входит в дружину.
      expect(freed, "Федот освобождён").toBe(true);
      await waitPlayerTurn();
      expect(document.querySelectorAll(".roster-card")).toHaveLength(2);
      // Стая вышла — шесть крыс из чащи, а не ноль.
      expect(rats().length, "стая на поле").toBeGreaterThanOrEqual(6);
      expect(playedScenes(), "сцена стаи").toContain("m2_swarm");
      // Сцена стаи уже сыграна, зона открыта ею, а не самим освобождением.
      await waitFor(() => session.getBattleSnapshot(1).grid.tiles.some((tile) => tile.extract), 15000);
      expect(playedScenes(), "пан к зоне эвакуации").toContain("m2_extract");
      expect(session.getBattleSnapshot(1).grid.tiles.filter((tile) => tile.extract)).toHaveLength(6);
      // Умение эвакуации приходит вместе с зоной.
      expect(hero().skillIds ?? []).toContain("evacuate");

      await act(async () => {
        root.unmount();
      });
    },
    { timeout: 180000 },
  );
});
