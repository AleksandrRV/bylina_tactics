import type { Envelope, Transport } from "./envelope.js";

export interface WebRtcChannelOptions {
  /** Истина для инициатора (ведущий), ложь для ведомого. */
  initiator: boolean;
  /** Описание сессии готово к передаче по QR/строке (network-protocol.md §6). */
  onSignal?: (signal: unknown) => void;
  /** Принять описание сессии от партнёра (по QR/строке). */
  receiveSignal(signal: unknown): void;
  onConnect?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Канал локальной сети на WebRTC (tech-stack.md: канал WebRTC между
 * обозревателями; исполнение правил — у ведущего). Обёртка над simple-peer:
 * обмен описаниями сессии выполняется офлайн — изображением быстрого
 * считывания либо короткой строкой (roadmap 0.15.0).
 */
export function createWebRtcChannel(options: WebRtcChannelOptions): Transport & { receiveSignal(data: unknown): void } {
  // simple-peer импортируется динамически: в средах без WebRTC (Node-тесты)
  // канал недоступен, а пакет продолжает собираться.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Peer = require("simple-peer") as new (opts: Record<string, unknown>) => {
    on(event: string, listener: (data?: unknown) => void): void;
    send(data: string | Uint8Array): void;
    signal(data: unknown): void;
    destroy(): void;
  };

  const peer = new Peer({ initiator: options.initiator, trickle: false });
  const listeners = new Set<(message: Envelope) => void>();

  peer.on("signal", (data) => {
    options.onSignal?.(data);
  });
  peer.on("connect", () => {
    options.onConnect?.();
  });
  peer.on("close", () => {
    options.onClose?.();
  });
  peer.on("error", (error) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  });
  peer.on("data", (data) => {
    try {
      const message = JSON.parse(String(data)) as Envelope;
      for (const listener of listeners) listener(message);
    } catch {
      /* повреждённый конверт игнорируется */
    }
  });

  const receiveSignal = (signal: unknown): void => {
    peer.signal(signal);
  };
  options.receiveSignal = receiveSignal;

  return {
    send: (message) => {
      peer.send(JSON.stringify(message));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receiveSignal,
  };
}
