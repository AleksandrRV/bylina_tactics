// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * Дымовой тест запуска приложения (0.20.2): монтирование <App/> не должно
 * падать — воспроизводит «белый экран» на устройстве, когда не появляются
 * ни экран загрузки, ни меню. Проверяется и повторный запуск с уже
 * существующим сохранением (реальный сценарий: игрок открывает игру снова).
 */

// Полифилы, которые браузер даёт из коробки, а jsdom — нет.
beforeEach(() => {
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
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountApp(): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error ?? event.message);
  };
  window.addEventListener("error", onError);

  vi.resetModules();
  const { App } = await import("../../../apps/game-pwa/src/App.js");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(<App />);
  });
  // Таймер загрузочного экрана переводит на меню; автосохранение пишет
  // состояние в localStorage.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1400));
  });

  const html = document.body.innerHTML;
  await act(async () => {
    root.unmount();
  });
  window.removeEventListener("error", onError);
  return { html, errors };
}

describe("app boot", () => {
  it("first launch renders boot screen and then the menu", async () => {
    window.localStorage.clear();
    const { html, errors } = await mountApp();
    expect(errors, `unhandled errors during boot: ${String(errors[0])}`).toEqual([]);
    expect(html.length).toBeGreaterThan(0);
    expect(html.includes("menu-screen") || html.includes("boot-screen")).toBe(true);
    // После первого запуска появилось автосохранение.
    expect(window.localStorage.getItem("bylina.save.v1")).not.toBeNull();
  });

  it("relaunch with an existing save still renders the menu", async () => {
    // Сохранение создаётся первым запуском. Если тест исполняется изолированно
    // (хранилище не заполнено предыдущим тестом), первичный запуск выполняется
    // здесь же — тест не зависит от порядка и параллельности исполнения.
    if (window.localStorage.getItem("bylina.save.v1") === null) {
      await mountApp();
    }
    expect(window.localStorage.getItem("bylina.save.v1")).not.toBeNull();
    const { html, errors } = await mountApp();
    expect(errors, `unhandled errors during relaunch: ${String(errors[0])}`).toEqual([]);
    expect(html.length).toBeGreaterThan(0);
    expect(html.includes("menu-screen")).toBe(true);
  });
});
