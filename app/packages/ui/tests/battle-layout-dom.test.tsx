// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { parseContent } from "@bylina/content";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";
import { createSession } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import { ServicesProvider, Shell } from "../src/index.js";
import type { AppServices } from "../src/context.js";
import { dataTree } from "./training-sim.js";
import {
  createRendererStub,
  installDomTestEnv,
  mountView,
  renderMock,
  tick,
  waitFor,
  type Mounted,
} from "./harness.js";

/**
 * Раскладка боевого экрана: список дружины живёт в верхней панели
 * (`.battle-top`), а не отдельным блоком колонки HUD. Иначе флекс-колонка
 * `.battle-hud` растягивает `.roster` на всю высоту поля: карточки уезжают
 * влево и полоса перехватывает нажатия по клеткам.
 */

const rendererStub = createRendererStub();

vi.mock("@bylina/render", () => renderMock(rendererStub));

let mounted: Mounted;

beforeAll(async () => {
  installDomTestEnv();
  window.localStorage.clear();

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
  mounted = await mountView(
    <ServicesProvider value={services}>
      <Shell />
    </ServicesProvider>,
  );
  await act(async () => {
    await tick(20);
  });
  await act(async () => {
    session.startTrainingMission("combat");
  });
  await waitFor(() => document.querySelector(".battle-screen") !== null);
  await waitFor(() => document.querySelector(".roster .roster-card") !== null);
}, 60000);

afterAll(async () => {
  await mounted.unmount();
});

describe("battle HUD layout", () => {
  it("keeps the roster inside the top bar", () => {
    const roster = document.querySelector(".roster");
    expect(roster, "список дружины отрисован").not.toBeNull();
    expect(roster?.closest(".battle-top"), "дружина внутри верхней панели").not.toBeNull();
  });

  it("does not place the roster as a direct child of the HUD column", () => {
    const hud = document.querySelector(".battle-hud");
    expect(hud, "HUD отрисован").not.toBeNull();
    const stray = Array.from(hud?.children ?? []).filter((child) => child.classList.contains("roster"));
    expect(stray, "полоса дружины не растягивается по высоте поля").toHaveLength(0);
  });
});
