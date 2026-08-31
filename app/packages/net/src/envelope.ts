/** Типы конвертов канала (network-protocol.md, разделы 2–5). */
export type EnvelopeType =
  "COMMAND" | "EVENT_BATCH" | "SYNC_REQUEST" | "SYNC_PAYLOAD" | "QUERY" | "QUERY_RESULT" | "REJECT" | "PING";

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
