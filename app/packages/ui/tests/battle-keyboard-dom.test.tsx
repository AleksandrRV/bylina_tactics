// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRendererStub, installDomTestEnv, mountBattleShell, renderMock, tick, waitFor } from "./harness.js";
import type { FieldRenderer } from "@bylina/render";

/**
 * Клавиатура боевого экрана в живом интерфейсе (0.20.59).
 *
 * Решения по клавишам вынесены в `battle-keyboard` и проверяются без React —
 * здесь проверяется проводка: что эффект вообще подписан, что Tab передаёт
 * выбор, а Escape — паузу. Поле боя подменено заглушкой (PixiJS в jsdom
 * не работает); экран монтируется обвязкой на быстром матче.
 */

const rendererStub = createRendererStub({});

vi.mock("@bylina/render", () => renderMock(rendererStub));

beforeEach(() => {
  installDomTestEnv();
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** Нажатие клавиши: экран слушает `window`, событие идёт вверх по-настоящему. */
async function pressKey(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await tick(60);
  });
}

const selectedCard = (): string => document.querySelector(".roster-card.is-on")?.textContent ?? "";
const pauseCard = (): Element | null => document.querySelector('.pause-card[aria-labelledby="pause-title"]');

describe("клавиатура боевого экрана (0.20.59)", () => {
  it("передаёт выбор бойца по Tab, а Escape ставит и снимает паузу", async () => {
    const { mounted, services } = await mountBattleShell();
    await act(async () => {
      services.session.selectDifficulty("normal");
    });
    await waitFor(() => document.querySelector(".battle-screen") !== null);
    await act(async () => {
      await tick(60);
    });

    // В быстром матче дружина больше одного бойца — иначе перебору нечего делать.
    const roster = [...document.querySelectorAll(".roster-card")];
    expect(roster.length, "в дружине несколько бойцов").toBeGreaterThan(1);

    const first = selectedCard();
    expect(first, "выбранный боец отмечен").not.toBe("");
    await pressKey("Tab");
    const second = selectedCard();
    expect(second, "Tab передаёт выбор следующему бойцу").not.toBe(first);
    expect(second).not.toBe("");

    // Пока паузы нет, её карточки в разметке быть не должно.
    expect(pauseCard(), "пауза закрыта").toBeNull();
    await pressKey("Escape");
    expect(pauseCard(), "Escape ставит паузу").not.toBeNull();
    // На паузе ввод закрыт: Tab не перебирает бойцов.
    expect(selectedCard(), "выбор стоит на месте").toBe(second);
    await pressKey("Escape");
    expect(pauseCard(), "повторный Escape снимает паузу").toBeNull();
    await pressKey("Tab");
    expect(selectedCard(), "после паузы перебор снова работает").not.toBe(second);

    await act(async () => {
      await mounted.unmount();
    });
  }, 20000);
});
