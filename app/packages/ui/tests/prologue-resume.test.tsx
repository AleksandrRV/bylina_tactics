// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRendererStub, installDomTestEnv, mountApp, renderMock, waitFor, type Mounted } from "./harness.js";

// Рендер поля подменён заглушкой: PixiJS в jsdom не работает.
const rendererStub = createRendererStub();

vi.mock("@bylina/render", () => renderMock(rendererStub));

/**
 * Выход из сюжетной миссии пролога (0.20.51).
 *
 * Былина начинается с пролога: игрок выходит из боя в меню, и былина
 * должна ждать его там же — кнопкой «Продолжить», а не только «Новая
 * былина», которая началась бы с первого сюжетного боя заново. Проверка
 * идёт по живому приложению: сохранение пишется в локальное хранилище,
 * поэтому второй прогон — это ещё и перезапуск обозревателя.
 */

beforeEach(() => {
  installDomTestEnv();
});

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** Интерактивное приложение: корень живёт, тест щёлкает по кнопкам. */
async function mountInteractiveApp(): Promise<{ mounted: Mounted; errors: unknown[] }> {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error ?? event.message);
  };
  window.addEventListener("error", onError);
  const mounted = await mountApp();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  return { mounted, errors };
}

const buttonByText = (part: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes(part));
  if (!found) throw new Error(`button not found: ${part}`);
  return found as HTMLButtonElement;
};

const hasButton = (part: string): boolean =>
  [...document.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes(part));

/** Акцентная кнопка «Продолжить» именно в главном меню. */
const menuContinue = (): boolean => document.querySelector(".btn-continue") !== null;

/** Начать былину: меню → пролог, экран боя со вступлением закрыт. */
async function startBylina(): Promise<void> {
  await act(async () => {
    buttonByText("Новая былина").click();
  });
  await waitFor(() => document.querySelector(".battle-screen") !== null);
  const dismiss = document.querySelector<HTMLButtonElement>(".training-over-card button");
  if (dismiss) {
    await act(async () => {
      dismiss.click();
    });
    await waitFor(() => document.querySelector(".training-over-card") === null);
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

/** Выйти из боя в меню через паузу. */
async function exitToMenu(): Promise<void> {
  await act(async () => {
    buttonByText("Пауза").click();
  });
  await waitFor(() => hasButton("Выйти в меню"));
  await act(async () => {
    buttonByText("Выйти в меню").click();
  });
  await waitFor(() => document.querySelector(".menu-screen") !== null);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

describe("выход из сюжетной миссии пролога (0.20.51)", () => {
  it("меню предлагает продолжить былину, а не только начать заново", async () => {
    const app = await mountInteractiveApp();
    try {
      await startBylina();
      expect(document.querySelector(".battle-screen"), "бой пролога начат").not.toBeNull();
      await exitToMenu();
      // Былина начата: «Продолжить» обязана вернуть в недойденный бой.
      expect(menuContinue(), "кнопка «Продолжить» в главном меню").toBe(true);
      await act(async () => {
        document.querySelector<HTMLButtonElement>(".btn-continue")!.click();
      });
      await waitFor(() => document.querySelector(".battle-screen") !== null);
      expect(document.querySelector(".battle-screen"), "возврат в бой пролога").not.toBeNull();
      expect(app.errors, `необработанные ошибки: ${String(app.errors[0])}`).toEqual([]);
    } finally {
      await act(async () => {
        await app.mounted.unmount();
      });
    }
  }, 120000);

  it("бой сюжетной миссии не теряется, если обозреватель закрыли в бою", async () => {
    const first = await mountInteractiveApp();
    try {
      await startBylina();
      // Закрытие вкладки: выхода в меню не было, бой продолжался.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    } finally {
      await act(async () => {
        await first.mounted.unmount();
      });
    }
    document.body.innerHTML = "";
    const second = await mountInteractiveApp();
    try {
      expect(menuContinue(), "«Продолжить» после закрытия в бою").toBe(true);
      await act(async () => {
        document.querySelector<HTMLButtonElement>(".btn-continue")!.click();
      });
      await waitFor(() => document.querySelector(".battle-screen") !== null);
      expect(document.querySelector(".battle-screen"), "бой пролога восстановлен").not.toBeNull();
      expect(second.errors, `необработанные ошибки: ${String(second.errors[0])}`).toEqual([]);
    } finally {
      await act(async () => {
        await second.mounted.unmount();
      });
    }
  }, 120000);

  it("после перезапуска былина продолжается тем же боем", async () => {
    const first = await mountInteractiveApp();
    try {
      await startBylina();
      await exitToMenu();
    } finally {
      await act(async () => {
        await first.mounted.unmount();
      });
    }
    // Тот же носитель сохранения: приложение открывается заново.
    document.body.innerHTML = "";
    const second = await mountInteractiveApp();
    try {
      expect(menuContinue(), "«Продолжить» после перезапуска").toBe(true);
      await act(async () => {
        document.querySelector<HTMLButtonElement>(".btn-continue")!.click();
      });
      await waitFor(() => document.querySelector(".battle-screen") !== null);
      expect(document.querySelector(".battle-screen"), "бой пролога восстановлен").not.toBeNull();
      expect(second.errors, `необработанные ошибки: ${String(second.errors[0])}`).toEqual([]);
    } finally {
      await act(async () => {
        await second.mounted.unmount();
      });
    }
  }, 120000);
});
