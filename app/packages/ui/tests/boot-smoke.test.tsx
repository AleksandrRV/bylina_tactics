// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { installDomTestEnv, mountApp } from "./harness.js";

/**
 * Дымовой тест запуска приложения (0.20.2): монтирование <App/> не должно
 * падать — воспроизводит «белый экран» на устройстве, когда не появляются
 * ни экран загрузки, ни меню. Проверяется и повторный запуск с уже
 * существующим сохранением (реальный сценарий: игрок открывает игру снова).
 */

// Полифилы, которые браузер даёт из коробки, а jsdom — нет.
beforeEach(() => {
  installDomTestEnv();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountBootApp(): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error ?? event.message);
  };
  window.addEventListener("error", onError);

  const mounted = await mountApp();
  // Таймер загрузочного экрана переводит на меню; автосохранение пишет
  // состояние в localStorage.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1400));
  });

  const html = document.body.innerHTML;
  await mounted.unmount();
  window.removeEventListener("error", onError);
  return { html, errors };
}

describe("app boot", () => {
  it("first launch renders boot screen and then the menu", async () => {
    window.localStorage.clear();
    const { html, errors } = await mountBootApp();
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
      await mountBootApp();
    }
    expect(window.localStorage.getItem("bylina.save.v1")).not.toBeNull();
    const { html, errors } = await mountBootApp();
    expect(errors, `unhandled errors during relaunch: ${String(errors[0])}`).toEqual([]);
    expect(html.length).toBeGreaterThan(0);
    expect(html.includes("menu-screen")).toBe(true);
  });
});
