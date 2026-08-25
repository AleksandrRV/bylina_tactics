import type { Server } from "node:http";
import type { WebSocketServer } from "ws";

/** Дескриптор запущенного ретранслятора (server.mjs). */
export interface RelayServerHandle {
  server: Server;
  wss: WebSocketServer;
  port: number;
  rooms: Map<string, unknown>;
}

/** Создать ретранслятор установления соединения. */
export function createRelayServer(options?: {
  port?: number;
  host?: string;
  heartbeatMs?: number;
  /** Значение `Access-Control-Allow-Origin` HTTP-эндпоинтов (по умолчанию `*`). */
  corsOrigin?: string;
}): Promise<RelayServerHandle>;
