// @vitest-environment jsdom
/**
 * Опыт и повышение в прологе (0.21.30): экран победы после М1 показывает
 * полосу опыта Микулы, после М2 — уровень и стандартное окно выбора класса
 * с единственным вариантом «Богатырь»; «Дальше» закрыта, пока класс не
 * назначен. На карте кампании боец выше порога класса получает окно выбора
 * одного из двух талантов.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
// Пакет интерфейса не зависит от модуля кампании: автомат для теста берётся
// по относительному пути, как приложение — по своему манифесту.
import { createCampaign } from "../../campaign/src/index.js";
import type { AppServices } from "../src/context.js";
import {
  createRendererStub,
  installDomTestEnv,
  mountBattleShell,
  renderMock,
  tick,
  waitFor,
  type Mounted,
} from "./harness.js";

vi.mock("@bylina/render", () => renderMock(createRendererStub()));

beforeEach(() => {
  installDomTestEnv();
  document.body.innerHTML = "";
});

/** Автомат кампании, как его строит App: свежая былина главой «open». */
function bindFreshCampaign(services: AppServices): ReturnType<typeof createCampaign> {
  const unitStats: Record<string, { maxHealth: number }> = {};
  for (const unit of [...services.content.units, ...services.content.prologueBestiary.units]) {
    unitStats[unit.id] = { maxHealth: unit.maxHealth };
  }
  const classUnitIds = services.content.units
    .filter((unit) => unit.side === "druzhina" && unit.id !== services.content.campaign.recruitUnitId)
    .map((unit) => unit.id);
  const automaton = createCampaign(services.content.campaign, {
    unitStats,
    items: services.content.items,
    classUnitIds,
    prologueFinalMissionId: services.content.prologue.prologueFinalMissionId,
  });
  services.session.bindCampaign(automaton);
  return automaton;
}

const xpNames = (): string[] => [...document.querySelectorAll(".xp-row .xp-name")].map((el) => el.textContent ?? "");

async function finishPrologue(mounted: Mounted, services: AppServices, next: string): Promise<void> {
  await act(async () => {
    services.session.finishPrologueMission("victory", next);
  });
  await waitFor(() => document.querySelector(".menu-screen .display-title") !== null);
  await act(async () => {
    await tick(30);
  });
  void mounted;
}

describe("prologue XP and level-up on the victory screen (0.21.30)", () => {
  it("shows Mikula's XP after M1, the class window after M2 and unlocks Continue once Bogatyr is chosen", async () => {
    const { mounted, services } = await mountBattleShell();
    const { session } = services;
    const automaton = bindFreshCampaign(services);
    await act(async () => {
      session.startPrologue("prologue_brushwood", true);
    });
    await waitFor(() => document.querySelector(".battle-screen") !== null);
    expect(automaton.getState().fighters.map((fighter) => fighter.unitId)).toEqual([
      "mikula_peasant",
      "fedot_stranded",
    ]);

    // М1: полоса опыта Микулы, окна класса нет, «Дальше» доступна.
    await finishPrologue(mounted, services, "prologue_cry");
    expect(session.get().screen).toBe("result");
    expect(xpNames()).toEqual(["Микула"]);
    expect(document.querySelector(".xp-row .xp-gain")?.textContent).toBe("+50");
    expect(document.querySelector(".train-card")).toBeNull();
    const onward = document.querySelector<HTMLButtonElement>(".menu-screen .btn-primary");
    expect(onward?.disabled).toBe(false);
    await act(async () => {
      onward!.click();
    });
    await waitFor(() => session.get().prologueMissionId === "prologue_cry");

    // М2: уровень 2 → стандартное окно класса с единственным «Богатырём».
    await finishPrologue(mounted, services, "prologue_glade");
    expect(xpNames()).toEqual(["Микула"]);
    expect(document.querySelector(".xp-row.is-leveled")).not.toBeNull();
    const cards = [...document.querySelectorAll<HTMLButtonElement>(".train-card .class-card")];
    expect(cards.map((card) => card.textContent)).toEqual(["Богатырь"]);
    expect(document.querySelector("#train-title")?.textContent).toContain("Микула");
    const locked = document.querySelector<HTMLButtonElement>(".menu-screen .btn-primary");
    expect(locked?.disabled, "Continue waits for the class").toBe(true);

    await act(async () => {
      cards[0]!.click();
    });
    await act(async () => {
      await tick(30);
    });
    const mikula = automaton.getState().fighters.find((fighter) => fighter.name === "Микула")!;
    expect(mikula.unitId).toBe("bogatyr");
    expect(mikula.level).toBe(2);
    expect(document.querySelector(".train-card")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".menu-screen .btn-primary")?.disabled).toBe(false);

    await mounted.unmount();
  }, 30000);
});

describe("talent choice on the campaign map (0.21.30)", () => {
  it("offers one of two talents for a fighter above the class threshold and records the pick", async () => {
    const { mounted, services } = await mountBattleShell();
    const { session } = services;
    const automaton = bindFreshCampaign(services);
    // Победа в песочнице: каждый участник получает уровень (2 → 3).
    automaton.startMission("clearing_1");
    const fighters = automaton.getState().fighters;
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: fighter.maxHp })),
    );
    const choice = automaton.getPendingTalentChoice();
    expect(choice).not.toBeNull();
    await act(async () => {
      session.openCampaign();
    });
    await waitFor(() => document.querySelector(".talent-card") !== null);
    const options = [...document.querySelectorAll<HTMLButtonElement>(".talent-card .talent-option")];
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.dataset.talentId)).toEqual(choice!.options.map((talent) => talent.id));
    expect(document.querySelector("#talent-title")?.textContent).toContain(String(choice!.level));

    await act(async () => {
      options[1]!.click();
    });
    await act(async () => {
      await tick(30);
    });
    const chosen = automaton.getState().fighters.find((fighter) => fighter.id === choice!.fighterId)!;
    expect(chosen.talents).toEqual([choice!.options[1]!.id]);
    // Следующее окно — для следующего бойца; очередь разбирается по одному.
    const nextChoice = automaton.getPendingTalentChoice();
    if (nextChoice) {
      expect(nextChoice.fighterId).not.toBe(choice!.fighterId);
      expect(document.querySelector(".talent-card")).not.toBeNull();
    }
    await mounted.unmount();
  }, 30000);
});
