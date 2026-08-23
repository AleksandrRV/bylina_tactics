// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * Регрессия запуска с сохранением игрока (0.20.2). Восстановление на экранах
 * кампании (карта корабля, итог миссии) падало «Campaign automaton is not
 * bound»: кампания привязывалась к сессии в эффекте, позже первого рендера
 * экранов, — приложение открывалось пустым экраном. На мобильных это
 * воспроизводилось при каждом обновлении PWA, перезагружающем страницу.
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

async function mountApp(): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
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
  const html = document.body.innerHTML;
  await act(async () => {
    root.unmount();
  });
  window.removeEventListener("error", onError);
  return { html, errors };
}

/** Сохранение игрока: свежая кампания и указанный экран сессии. */
async function makeSave(screen: string): Promise<void> {
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
  const save = {
    version: "0.20.2",
    savedAt: Date.now(),
    campaign: campaign.getState(),
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

describe("app boot with a player save (0.20.2)", () => {
  it("boots to the campaign map when the saved screen is campaign", async () => {
    await makeSave("campaign");
    const { html, errors } = await mountApp();
    expect(errors, `unhandled errors: ${String(errors[0])}`).toEqual([]);
    expect(html.length).toBeGreaterThan(0);
    expect(html.includes("campaign")).toBe(true);
  });

  it("boots to the mission result when the saved screen is missionResult", async () => {
    await makeSave("missionResult");
    const { html, errors } = await mountApp();
    expect(errors, `unhandled errors: ${String(errors[0])}`).toEqual([]);
    expect(html.length).toBeGreaterThan(0);
    expect(html.includes("mission-result-screen")).toBe(true);
  });

  it("boots an installed PWA (standalone display mode)", async () => {
    standalone = true;
    const { html, errors } = await mountApp();
    expect(errors, `unhandled errors: ${String(errors[0])}`).toEqual([]);
    expect(html.includes("menu-screen")).toBe(true);
  });
});
