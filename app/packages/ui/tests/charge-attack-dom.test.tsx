// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  createRendererStub,
  installDomTestEnv,
  mountView,
  renderMock,
  tick,
  waitFor,
  type Mounted,
} from "./harness.js";
import { parseContent } from "@bylina/content";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";
import { createSession } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import type { CinematicPlan, FieldRenderer } from "@bylina/render";
import { ServicesProvider, Shell } from "../src/index.js";
import type { AppServices } from "../src/context.js";
import { meleeStrikeOf, planCharge } from "../src/charge-attack.js";
import { dataTree } from "./training-sim.js";

/**
 * Рывок к цели ближнего боя в живом экране (0.20.50): нажатие по
 * далёкому врагу показывает подход, повторное нажание — подходит и бьёт.
 * Поле боя подменено заглушкой @bylina/render (PixiJS в jsdom не
 * работает), клики по полю подаются через перехваченный
 * `setOnActivate`. Раскладка быстрого матча случайна, поэтому пара
 * «боец — цель» ищется по данным сессии, а не задаётся числами.
 */

let activate: ((x: number, y: number) => void) | null = null;

const rendererStub = createRendererStub({
  setOnActivate: vi.fn((handler: (x: number, y: number) => void) => {
    activate = handler;
  }),
  playCinematic: vi.fn(async (_plan: CinematicPlan) => false),
});

vi.mock("@bylina/render", () => renderMock(rendererStub));

beforeEach(() => {
  installDomTestEnv();
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  activate = null;
});

/** Тот же опрос, но без исключения: вызывающий решает, что делать дальше. */
async function waitUntil(condition: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return true;
    await act(async () => {
      await tick(40);
    });
  }
  return condition();
}

async function mountShell(): Promise<{ mounted: Mounted; services: AppServices }> {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error(`content parse failed: ${JSON.stringify(parsed.issues)}`);
  const i18n = createI18n({ manifest, catalogs: loadBundledCatalogs(), initialLanguage: "ru" });
  const settings = createSettings({ storage: null, allowedLanguages: manifest.languages.map((item) => item.code) });
  const session = createSession("menu");
  const services: AppServices = {
    i18n,
    settings,
    session,
    content: parsed.data,
    version: "test",
    install: { canInstall: false, installed: false, prompt: async () => undefined },
    debug: false,
  };
  const mounted = await mountView(
    <ServicesProvider value={services}>
      <Shell />
    </ServicesProvider>,
  );
  await act(async () => {
    await tick(20);
  });
  return { mounted, services };
}

const logText = (): string => document.querySelector(".battle-log")?.textContent ?? "";

function buttonByText(part: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    (button.textContent ?? "").includes(part),
  );
}

describe("рывок к цели в экране боя (0.20.50)", () => {
  it("показывает подход первым нажатием и бьёт вторым", async () => {
    const { mounted, services } = await mountShell();
    const { session, content } = services;
    await act(async () => {
      session.selectDifficulty("normal");
    });
    await waitFor(() => document.querySelector(".battle-screen") !== null);
    await act(async () => {
      await tick(60);
    });

    const weapons = Object.fromEntries(content.weapons.map((record) => [record.id, record]));
    const skills = Object.fromEntries(content.skills.map((record) => [record.id, record]));

    /** Пара «наш боец — враг», до которой есть рывок. */
    const findOpportunity = (): { actorId: number; targetId: number; stepX: number; stepY: number } | null => {
      const snapshot = session.getBattleSnapshot(1);
      for (const actor of snapshot.entities) {
        if (actor.dead || actor.owner !== 1 || actor.coverType !== 0 || actor.maxAp <= 0) continue;
        const strike = meleeStrikeOf(
          { type: "weapon", id: actor.weaponId ?? actor.weaponIds?.[0] ?? "" },
          weapons as never,
          skills as never,
        );
        if (!strike) continue;
        for (const target of snapshot.entities) {
          if (target.dead || target.owner === 1 || target.coverType !== 0) continue;
          const plan = planCharge({
            snapshot,
            actor,
            target,
            strike,
            reachable: session.getBattleReachable(actor.id),
            pathOf: (cell) => session.getBattlePath(actor.id, cell),
          });
          if (plan) return { actorId: actor.id, targetId: target.id, stepX: plan.step.x, stepY: plan.step.y };
        }
      }
      return null;
    };

    // Раскладка случайна: сближаемся, пока рывок не станет возможен.
    // Противник идёт к дружине сам, поэтому пара находится за 2–3 хода.
    const endTurnButton = (): HTMLButtonElement | undefined => {
      const found = document.querySelector<HTMLButtonElement>(".end-turn");
      return found && !found.disabled ? found : undefined;
    };
    /** Свежая раскладка: прежний бой мог закончиться. */
    const newLayout = async (): Promise<void> => {
      await act(async () => {
        session.selectDifficulty("normal");
      });
      await waitUntil(() => document.querySelector(".battle-screen") !== null);
      await act(async () => {
        await tick(80);
      });
    };
    let found = findOpportunity();
    for (let attempt = 0; attempt < 12 && !found; attempt += 1) {
      const endTurn = endTurnButton();
      if (!endTurn) {
        await newLayout();
        found = findOpportunity();
        continue;
      }
      const turn = session.getBattleSnapshot(1).turnNumber;
      await act(async () => {
        endTurn.click();
      });
      const advanced = await waitUntil(() => {
        const current = session.getBattleSnapshot(1);
        return current.turnNumber > turn && current.activeOwner === 1;
      });
      await act(async () => {
        await tick(120);
      });
      found = findOpportunity();
      // Ход не перешёл и поля нет — бой завершился: берём новую раскладку.
      if (!advanced && document.querySelector(".battle-screen") === null) {
        await newLayout();
        found = findOpportunity();
      }
    }
    expect(found, "в раскладке быстрого матча нашлась цель для рывка").not.toBeNull();
    const { actorId, targetId, stepX, stepY } = found!;

    const before = session.getBattleSnapshot(1);
    const actor = before.entities.find((entity) => entity.id === actorId)!;
    const target = before.entities.find((entity) => entity.id === targetId)!;
    expect(Math.abs(actor.x - target.x) + Math.abs(actor.y - target.y), "цель не рядом").toBeGreaterThan(1);

    // Выбираем бойца и вооружаем его ближним оружием.
    await act(async () => {
      activate?.(actor.x, actor.y);
    });
    await act(async () => {
      await tick(60);
    });
    const sword = [...document.querySelectorAll<HTMLButtonElement>(".hud-btn.skill-slot")].find(
      (button) => !button.disabled,
    );
    expect(sword, "кнопка оружия доступна").toBeDefined();
    await act(async () => {
      sword!.click();
    });
    await act(async () => {
      await tick(60);
    });

    // Первое нажатие по цели: экран показывает подход.
    await act(async () => {
      activate?.(target.x, target.y);
    });
    await act(async () => {
      await tick(80);
    });
    expect(logText(), "предложение подхода").toContain("Подойти и ударить");

    // Второе нажатие: подход и удар.
    await act(async () => {
      activate?.(target.x, target.y);
    });
    await waitFor(() => {
      const after = session.getBattleSnapshot(1);
      const moved = after.entities.find((entity) => entity.id === actorId);
      return Boolean(moved && (moved.x !== actor.x || moved.y !== actor.y));
    });
    const after = session.getBattleSnapshot(1);
    const moved = after.entities.find((entity) => entity.id === actorId)!;
    expect({ x: moved.x, y: moved.y }, "боец подошёл к названной клетке").toEqual({ x: stepX, y: stepY });
    const struck = after.entities.find((entity) => entity.id === targetId);
    const damaged = !struck || struck.hp < target.hp;
    expect(damaged || /Попадание|Промах|Крит|пал|Погиб/.test(logText()), "удар состоялся").toBe(true);
    await act(async () => {
      await mounted.unmount();
    });
  }, 90000);
});
