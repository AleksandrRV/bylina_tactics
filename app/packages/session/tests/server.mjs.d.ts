declare module "*/server.mjs" {
  export function createRelayServer(options?: { port?: number; host?: string }): Promise<{
    server: import("node:http").Server;
    wss: import("ws").WebSocketServer;
    port: number;
    rooms: Map<string, unknown>;
  }>;
}
