import type { Envelope, Transport } from "./envelope.js";

/** Однопроцессный транспорт: сообщение доставляется всем подписчикам на следующем микротаске. */
export function createLocalTransport(): Transport {
  const listeners = new Set<(message: Envelope) => void>();
  return {
    send: (message) => {
      queueMicrotask(() => {
        for (const listener of listeners) listener(message);
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Двухточечный канал в памяти: имитация соединения двух экземпляров
 * приложения (roadmap 0.15.0: «автоматические проверки канала на двух
 * экземплярах»). Сообщение, отправленное стороной A, получает только B.
 */
export function createChannelPair(): { a: Transport; b: Transport } {
  const listenersA = new Set<(message: Envelope) => void>();
  const listenersB = new Set<(message: Envelope) => void>();
  return {
    a: {
      send: (message) => {
        queueMicrotask(() => {
          for (const listener of listenersB) listener(message);
        });
      },
      subscribe: (listener) => {
        listenersA.add(listener);
        return () => {
          listenersA.delete(listener);
        };
      },
    },
    b: {
      send: (message) => {
        queueMicrotask(() => {
          for (const listener of listenersA) listener(message);
        });
      },
      subscribe: (listener) => {
        listenersB.add(listener);
        return () => {
          listenersB.delete(listener);
        };
      },
    },
  };
}
