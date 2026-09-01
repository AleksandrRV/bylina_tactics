// @vitest-environment jsdom
/**
 * Комната сбора, вкладка «По локальной сети» (0.21.18).
 *
 * Дефект: «Создать партию» не отвечала на нажатие. Описание сессии уходило
 * наружу только по событию завершения сбора кандидатов, а в локальной сети
 * без выхода в интернет внешний сервер недостижим, сбор не завершается и
 * код не появлялся вовсе — кнопка словно не нажималась. Здесь проверяется
 * то, что видит игрок: нажатие сразу показывает подготовку кода, а сам код
 * появляется и тогда, когда сбор кандидатов не завершился.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { byText, installDomTestEnv, mountBattleShell, press, waitFor } from "./harness.js";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";

type Listener = (event?: unknown) => void;

/** Подмена `RTCPeerConnection`: сбором кандидатов управляет тест. */
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  iceGatheringState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  connectionState = "new";
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  createDataChannel(): unknown {
    const listeners = new Map<string, Set<Listener>>();
    return {
      readyState: "connecting",
      addEventListener: (type: string, listener: Listener) => {
        const set = listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(type, set);
      },
      send: () => undefined,
    };
  }

  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 192.168.0.10\r\n" });
  }

  createAnswer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 192.168.0.11\r\n" });
  }

  setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    this.localDescription = description;
    this.setGathering("gathering");
    return Promise.resolve();
  }

  setRemoteDescription(): Promise<void> {
    // Принятое описание подмена не разбирает: соединение не устанавливается.
    return Promise.resolve();
  }

  /** Завершить сбор кандидатов: событие, которого ждало прежнее поведение. */
  completeGathering(): void {
    this.setGathering("complete");
  }

  close(): void {
    this.connectionState = "closed";
  }

  private setGathering(state: string): void {
    if (this.iceGatheringState === state) return;
    this.iceGatheringState = state;
    for (const listener of this.listeners.get("icegatheringstatechange") ?? []) listener();
  }
}

/** Подписи экрана читаются из словаря: тест не зависит от литералов. */
const i18n = createI18n({ manifest, catalogs: loadBundledCatalogs(), initialLanguage: "ru" });
const label = (key: string): string => i18n.t(key);

/** Кнопка «Создать партию»: первичная кнопка панели ведущего. */
function hostButton(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".net-panel .btn-primary");
  if (!found) throw new Error("кнопка ведущего не найдена");
  return found;
}

beforeEach(() => {
  installDomTestEnv();
  FakePeerConnection.instances = [];
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePeerConnection;
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
});

/** Открыть комнату сбора на вкладке «По локальной сети». */
async function openNetworkTab() {
  const shell = await mountBattleShell();
  act(() => {
    shell.services.session.openMode("pvp");
  });
  await press(byText(label("pvp.tabNetwork")));
  return shell;
}

describe("комната сбора: создание партии по локальной сети (0.21.18)", () => {
  it("кнопка отвечает на нажатие сразу, не дожидаясь кода", async () => {
    const { mounted } = await openNetworkTab();
    expect(hostButton().textContent).toContain(label("net.create"));

    await press(hostButton());

    // Кода ещё нет — сбор кандидатов не завершён, как в сети без интернета.
    expect(document.querySelector(".net-code")).toBeNull();
    expect(hostButton().textContent).toContain(label("net.creating"));
    expect(hostButton().hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain(label("net.creatingHint"));

    await mounted.unmount();
  });

  it("код появляется, даже если сбор кандидатов не завершился", async () => {
    const { mounted } = await openNetworkTab();
    await press(hostButton());

    // Прежде здесь код не появлялся вовсе: описание ждало события сбора.
    await waitFor(() => document.querySelector(".net-code") !== null, 6_000);
    expect(document.body.textContent).toContain(label("net.hostWait"));
    // Кнопка уступила место коду: подготовка завершена.
    expect(document.querySelector(".net-panel .btn-primary")).toBeNull();
    expect(document.body.textContent).not.toContain(label("net.creatingHint"));

    await mounted.unmount();
  });

  it("код появляется сразу по завершении сбора кандидатов", async () => {
    const { mounted } = await openNetworkTab();
    await press(hostButton());

    const peer = FakePeerConnection.instances[0];
    expect(peer, "соединение создано нажатием").toBeDefined();
    act(() => {
      peer?.completeGathering();
    });

    expect(document.querySelector(".net-code")).not.toBeNull();
    await mounted.unmount();
  });
});
