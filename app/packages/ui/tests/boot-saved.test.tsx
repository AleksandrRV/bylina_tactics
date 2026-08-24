// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Продолжение былины через главное меню (0.20.15). Прежнее поведение:
 * при сохранённой кампании приложение сразу открывало её экраны. Теперь
 * всегда открывается главное меню; «Продолжить» (акцентная кнопка)
 * загружает состояние былины, а «Новая былина» предупреждает о потере
 * прогресса и требует подтверждения. Регресс 0.20.2 (синхронная привязка
 * кампании до первого рендера экранов) также проверяется этим прогоном.
 */

let standalone = false;

beforeEach(() => {
  window.matchMedia = window.matchMedia ?? ((query: string) => ({
    matches: standalone && query.includes("standalone"),
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
  window.localStorage.clear();
  standalone = false;
});

async function vi_resetModules(): Promise<void> {
  const { vi } = await import("vitest");
  vi.resetModules();
}

/** Интерактивное приложение: корень живёт, тест щёлкает по кнопкам. */
async function mountInteractiveApp(): Promise<{ root: Root; host: HTMLElement; errors: unknown[] }> {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error ?? event.message);
  };
  window.addEventListener("error", onError);
  await vi_resetModules();
  const { App } = await import("../../../apps/game-pwa/src/App.js");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  return { root, host, errors };
}

const buttonByText = (part: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(part),
  );
  if (!found) throw new Error(`button not found: ${part}`);
  return found as HTMLButtonElement;
};

const hasButton = (part: string): boolean =>
  [...document.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes(part));

/** Сохранение игрока: былина с прогрессом (Тьма = darkness) и указанный экран сессии. */
async function makeSave(screen: string, darkness = 5): Promise<void> {
  const { createCampaign } = await import("../../campaign/src/index.js");
  const { loadAppContent } = await import("../../../apps/game-pwa/src/content-files.js");
  const content = loadAppContent();
  if (!content.ok) throw new Error("content broken");
  const unitStats: Record<string, { maxHealth: number }> = {};
  for (const unit of content.data.units) unitStats[unit.id] = { maxHealth: unit.maxHealth };
  const campaign = createCampaign(content.data.campaign, {
    unitStats,
    items: content.data.items,
    classUnitIds: content.data.units
      .filter((unit) => unit.side === "druzhina" && unit.id !== content.data.campaign.recruitUnitId)
      .map((unit) => unit.id),
  });
  const state = campaign.getState();
  state.darkness = darkness;
  const save = {
    formatVersion: 2,
    version: "0.20.15",
    savedAt: Date.now(),
    campaign: state,
    session: {
      screen,
      battleKind: null,
      activeMissionId: null,
      deployment: [],
      matchSeed: 0,
      outcome: null,
      difficulty: null,
      trainingDone: ["movement"],
      campaignHintsDone: [],
    },
  };
  window.localStorage.setItem("bylina.save.v1", JSON.stringify(save));
}

describe("app boot with a player save (0.20.15)", () => {
  it("always opens the menu first: accented Continue instead of the campaign", async () => {
    await makeSave("campaign");
    const app = await mountInteractiveApp();
    try {
      expect(document.querySelector(".menu-screen")).not.toBeNull();
      // Акцентная кнопка «Продолжить» присутствует, карта кампании — нет.
      expect(hasButton("Продолжить")).toBe(true);
      expect(document.querySelector(".btn-continue")).not.toBeNull();
      expect(document.querySelector(".campaign-screen")).toBeNull();
      expect(app.errors, `unhandled errors: ${String(app.errors[0])}`).toEqual([]);
    } finally {
      await act(async () => {
        app.root.unmount();
      });
    }
  });

  it("Continue loads the saved campaign state onto the ship map", async () => {
    await makeSave("campaign", 5);
    const app = await mountInteractiveApp();
    try {
      await act(async () => {
        buttonByText("Продолжить").click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(document.querySelector(".campaign-screen")).not.toBeNull();
      // Состояние именно сохранённое: счётчик Тьмы равен сохранённому.
      const darkness = document.querySelector(".campaign-darkness-value");
      expect(darkness?.textContent).toContain("5");
      expect(app.errors).toEqual([]);
    } finally {
      await act(async () => {
        app.root.unmount();
      });
    }
  });

  it("New bylina warns about losing progress: cancel keeps the menu, confirm starts fresh", async () => {
    await makeSave("campaign", 5);
    const app = await mountInteractiveApp();
    try {
      // Предупреждение с вариантами выбора.
      await act(async () => {
        buttonByText("Новая былина").click();
      });
      expect(document.querySelector(".modal")).not.toBeNull();
      expect(document.body.textContent).toContain("Прогресс текущей былины будет потерян");
      // Отмена — меню, былина не тронута.
      await act(async () => {
        buttonByText("Отмена").click();
      });
      expect(document.querySelector(".modal")).toBeNull();
      expect(document.querySelector(".menu-screen")).not.toBeNull();
      expect(hasButton("Продолжить")).toBe(true);
      // Подтверждение — свежая былина: Тьма обнулена, «Продолжить» исчез.
      await act(async () => {
        buttonByText("Новая былина").click();
      });
      await act(async () => {
        buttonByText("Начать новую").click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(document.querySelector(".campaign-screen")).not.toBeNull();
      const darkness = document.querySelector(".campaign-darkness-value");
      expect(darkness?.textContent).toContain("0");
      expect(app.errors).toEqual([]);
    } finally {
      await act(async () => {
        app.root.unmount();
      });
    }
  });

  it("without a saved campaign: no Continue button and no warning", async () => {
    const app = await mountInteractiveApp();
    try {
      expect(document.querySelector(".menu-screen")).not.toBeNull();
      expect(hasButton("Продолжить")).toBe(false);
      await act(async () => {
        buttonByText("Новая былина").click();
      });
      expect(document.querySelector(".modal")).toBeNull();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(document.querySelector(".campaign-screen")).not.toBeNull();
      expect(app.errors).toEqual([]);
    } finally {
      await act(async () => {
        app.root.unmount();
      });
    }
  });

  it("a save without progress (fresh install autosave) offers no Continue", async () => {
    await makeSave("menu", 0);
    const app = await mountInteractiveApp();
    try {
      expect(document.querySelector(".menu-screen")).not.toBeNull();
      expect(hasButton("Продолжить")).toBe(false);
      // Прогресса нет — «Новая былина» открывается без предупреждения.
      await act(async () => {
        buttonByText("Новая былина").click();
      });
      expect(document.querySelector(".modal")).toBeNull();
      expect(app.errors).toEqual([]);
    } finally {
      await act(async () => {
        app.root.unmount();
      });
    }
  });

  it("menu autosave does not overwrite the pending campaign save", async () => {
    await makeSave("campaign", 5);
    const app = await mountInteractiveApp();
    try {
      // Пока решение не принято, автосохранение в меню обязано писать
      // исходное состояние былины, а не свежий автомат (0.20.15).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
      const raw = window.localStorage.getItem("bylina.save.v1");
      expect(raw).not.toBeNull();
      const save = JSON.parse(raw!) as { campaign: { darkness: number; missions: { status: string }[] } };
      expect(save.campaign.darkness).toBe(5);
      expect(app.errors).toEqual([]);
    } finally {
      await act(async () => {
        app.root.unmount();
      });
    }
  });

  it("boots an installed PWA (standalone display mode)", async () => {
    standalone = true;
    const app = await mountInteractiveApp();
    expect(document.querySelector(".menu-screen")).not.toBeNull();
    expect(app.errors).toEqual([]);
    await act(async () => {
      app.root.unmount();
    });
  });
});
