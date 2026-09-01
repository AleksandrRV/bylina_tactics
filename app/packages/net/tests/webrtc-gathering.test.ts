import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebRtcChannel } from "../src/webrtc.js";

/**
 * Сбор кандидатов и предел ожидания описания сессии (0.21.18).
 *
 * Обмен описанием идёт офлайн — строкой либо изображением, — поэтому
 * описание готовится целиком: «капающих» кандидатов нет. Прежде описание
 * уходило наружу только по событию завершения сбора, а в локальной сети
 * без выхода в интернет внешний сервер недостижим и сбор тянется десятки
 * секунд: ведущий жал на «Создать партию» и не получал кода вовсе. Здесь
 * проверяются оба пути — завершённый сбор и сбор, который не завершился.
 */

type Listener = (event?: unknown) => void;

/** Канал данных: заглушка с набором слушателей, открытие не имитируется. */
function createFakeDataChannel(): { addEventListener(type: string, listener: Listener): void } {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener): void {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
  };
}

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

  createDataChannel(): { addEventListener(type: string, listener: Listener): void } {
    return createFakeDataChannel();
  }

  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" });
  }

  createAnswer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n" });
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

  /** Собранный кандидат дописывается в описание: так ведёт себя обозреватель. */
  addCandidate(candidate: string): void {
    if (!this.localDescription || this.iceGatheringState === "complete") return;
    this.localDescription = { ...this.localDescription, sdp: `${this.localDescription.sdp}${candidate}\r\n` };
  }

  /** Завершение сбора: событие, которого ждало прежнее поведение. */
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

function installFakePeerConnection(): void {
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePeerConnection;
}

/** Продвинуть очередь микрозадач: создание описания идёт цепочкой промисов. */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let step = 0; step < times; step += 1) await Promise.resolve();
}

/** Дождаться, пока асинхронное создание описания положит его в соединение. */
async function localDescriptionReady(): Promise<FakePeerConnection> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const peer = FakePeerConnection.instances[0];
    if (peer?.localDescription) return peer;
    await flushMicrotasks();
  }
  throw new Error("локальное описание не приготовлено");
}

describe("сбор кандидатов канала локальной сети (0.21.18)", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakePeerConnection.instances = [];
    delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  });

  it("отдаёт предложение сразу по завершении сбора кандидатов", async () => {
    installFakePeerConnection();
    const signals: unknown[] = [];
    createWebRtcChannel({
      initiator: true,
      onSignal: (signal) => signals.push(signal),
      receiveSignal: () => undefined,
    });

    const peer = await localDescriptionReady();
    expect(signals).toEqual([]);
    peer.addCandidate("a=candidate:1 1 udp 2122 192.168.0.10 5000 typ host");
    peer.completeGathering();

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: "offer" });
    expect(String((signals[0] as { sdp: string }).sdp)).toContain(
      "a=candidate:1 1 udp 2122 192.168.0.10 5000 typ host",
    );
  });

  it("отдаёт описание по пределу ожидания, когда сбор кандидатов не завершился", async () => {
    vi.useFakeTimers();
    installFakePeerConnection();
    const signals: unknown[] = [];
    createWebRtcChannel({
      initiator: true,
      onSignal: (signal) => signals.push(signal),
      receiveSignal: () => undefined,
      gatheringTimeoutMs: 5_000,
    });

    const peer = await localDescriptionReady();
    peer.addCandidate("a=candidate:1 1 udp 2122 192.168.0.10 5000 typ host");
    // Сбор не завершён: внешний сервер недостижим, событие не приходит.
    expect(peer.iceGatheringState).toBe("gathering");
    expect(signals).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_000);
    // Код уходит не позже предела ожидания — с прямыми адресами локальной сети.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: "offer" });
    expect(String((signals[0] as { sdp: string }).sdp)).toContain(
      "a=candidate:1 1 udp 2122 192.168.0.10 5000 typ host",
    );
  });

  it("не отдаёт описание дважды: позднее завершение сбора ни на что не влияет", async () => {
    vi.useFakeTimers();
    installFakePeerConnection();
    const signals: unknown[] = [];
    createWebRtcChannel({
      initiator: true,
      onSignal: (signal) => signals.push(signal),
      receiveSignal: () => undefined,
      gatheringTimeoutMs: 5_000,
    });

    const peer = await localDescriptionReady();
    await vi.advanceTimersByTimeAsync(5_000);
    peer.addCandidate("a=candidate:2 1 udp 1686 203.0.113.5 6000 typ srflx");
    peer.completeGathering();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(signals).toHaveLength(1);
  });

  it("ведомый отдаёт ответ по пределу ожидания, когда сбор кандидатов не завершился", async () => {
    vi.useFakeTimers();
    installFakePeerConnection();
    const signals: unknown[] = [];
    const channel = createWebRtcChannel({
      initiator: false,
      onSignal: (signal) => signals.push(signal),
      receiveSignal: () => undefined,
      gatheringTimeoutMs: 5_000,
    });
    channel.receiveSignal({ type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" });

    const peer = await localDescriptionReady();
    expect(peer.localDescription?.type).toBe("answer");
    expect(signals).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: "answer" });
  });

  it("молчит, пока локального описания нет: предел ожидания не заменяет его", async () => {
    vi.useFakeTimers();
    installFakePeerConnection();
    const signals: unknown[] = [];
    createWebRtcChannel({
      initiator: false,
      onSignal: (signal) => signals.push(signal),
      receiveSignal: () => undefined,
      gatheringTimeoutMs: 0,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(signals).toEqual([]);
  });
});
