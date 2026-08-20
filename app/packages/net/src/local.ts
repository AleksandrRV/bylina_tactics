export type EnvelopeType = "COMMAND" | "EVENT_BATCH" | "QUERY" | "QUERY_RESULT" | "REJECT";

export interface Envelope {
  type: EnvelopeType;
  senderId: string;
  timestamp: number;
  payload: unknown;
}

export interface Transport {
  send(message: Envelope): void;
  subscribe(listener: (message: Envelope) => void): () => void;
}

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
