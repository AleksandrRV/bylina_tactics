/**
 * WebSocket relay for WebRTC setup. It never receives game commands.
 * SIGNAL is addressed: a signal may only be delivered to its named peer.
 */
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const MAX_PEERS = 4;
const MAX_ROOM_ID = 64;
const MAX_NAME = 48;
const MAX_SIGNAL_BYTES = 64 * 1024;
const HEARTBEAT_MS = 30_000;
const ROOM_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_ROOM_ID}}$`);
/**
 * Значение `Access-Control-Allow-Origin` для HTTP-эндпоинтов (`/rooms`,
 * `/health`): клиент комнаты лежит на другом источнике (порт/домен),
 * без заголовка «Обновить комнаты» падает с ошибкой CORS. По умолчанию
 * источник не ограничивается; развёртывание может сузить его опцией
 * `corsOrigin` либо переменной окружения `RELAY_ALLOW_ORIGIN`.
 */
const DEFAULT_CORS_ORIGIN = "*";

export function createRelayServer(options = {}) {
  const rooms = new Map();
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const corsOrigin = options.corsOrigin ?? process.env.RELAY_ALLOW_ORIGIN ?? DEFAULT_CORS_ORIGIN;
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return void res.end();
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (url === "/health") return void res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    if (url === "/rooms" || url.startsWith("/rooms?"))
      return void res.end(JSON.stringify({ rooms: [...rooms.values()].map(roomInfo) }));
    res.writeHead(404);
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const wss = new WebSocketServer({ server });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, heartbeatMs);

  wss.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    const peer = { id: peerId(), role: "guest", name: "player", socket };
    let joinedRoomId = null;
    socket.on("message", (raw) => {
      if (raw.length > MAX_SIGNAL_BYTES + 1024) return send(socket, { type: "ERROR", message: "MESSAGE_TOO_LARGE" });
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return send(socket, { type: "ERROR", message: "BAD_JSON" });
      }
      if (!message || typeof message !== "object" || Array.isArray(message))
        return send(socket, { type: "ERROR", message: "BAD_MESSAGE" });
      if (message.type === "JOIN") {
        if (!validRoomId(message.roomId) || !validName(message.name) || !validRole(message.role))
          return send(socket, { type: "ERROR", message: "BAD_JOIN" });
        if (joinedRoomId) return send(socket, { type: "ERROR", message: "ALREADY_JOINED" });
        peer.name = message.name.trim();
        peer.role = message.role;
        joinedRoomId = message.roomId;
        joinRoom(rooms, joinedRoomId, peer, MAX_PEERS);
      } else if (message.type === "SIGNAL") {
        if (!validRoomId(message.roomId) || !joinedRoomId || message.roomId !== joinedRoomId)
          return send(socket, { type: "ERROR", message: "NOT_IN_ROOM" });
        if (
          typeof message.to !== "string" ||
          message.to.length === 0 ||
          message.to.length > 80 ||
          !validSignal(message.signal)
        )
          return send(socket, { type: "ERROR", message: "BAD_SIGNAL" });
        const target = rooms.get(joinedRoomId)?.peers.find((candidate) => candidate.id === message.to);
        if (!target) return send(socket, { type: "ERROR", message: "PEER_NOT_FOUND" });
        send(target.socket, { type: "SIGNAL", from: peer.id, signal: message.signal });
      } else if (message.type === "LEAVE") {
        if (joinedRoomId) leaveRoom(rooms, peer.id);
        joinedRoomId = null;
        socket.close();
      } else send(socket, { type: "ERROR", message: "BAD_MESSAGE" });
    });
    socket.on("close", () => {
      if (joinedRoomId) leaveRoom(rooms, peer.id);
      joinedRoomId = null;
    });
    socket.on("error", () => undefined);
  });
  server.on("close", () => clearInterval(heartbeat));
  return new Promise((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "0.0.0.0", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, wss, port, rooms });
    }),
  );
}

function peerId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function validRoomId(value) {
  return typeof value === "string" && ROOM_ID.test(value);
}
function validName(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME;
}
function validRole(value) {
  return value === "host" || value === "guest" || value === "spectator";
}
function validSignal(value) {
  if (!(typeof value === "string" || (typeof value === "object" && value !== null))) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= MAX_SIGNAL_BYTES;
  } catch {
    return false;
  }
}
function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function peerInfo(peer) {
  return { id: peer.id, role: peer.role, name: peer.name };
}
function roomInfo(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    host: room.peers.find((p) => p.role === "host")?.name ?? null,
    peers: room.peers.map(peerInfo),
  };
}
function joinRoom(rooms, roomId, peer, maxPeers) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, peers: [], createdAt: Date.now() };
    rooms.set(roomId, room);
  }
  if (room.peers.length >= maxPeers) {
    send(peer.socket, { type: "ERROR", message: "ROOM_FULL" });
    peer.socket.close();
    return;
  }
  if (room.peers.length === 0) peer.role = "host";
  room.peers.push(peer);
  send(peer.socket, {
    type: "JOINED",
    roomId,
    peerId: peer.id,
    role: peer.role,
    peers: room.peers.filter((p) => p.id !== peer.id).map(peerInfo),
  });
  for (const other of room.peers)
    if (other.id !== peer.id) send(other.socket, { type: "PEER_JOINED", peer: peerInfo(peer) });
}
function leaveRoom(rooms, peerId) {
  for (const room of rooms.values()) {
    const index = room.peers.findIndex((peer) => peer.id === peerId);
    if (index < 0) continue;
    const [left] = room.peers.splice(index, 1);
    for (const other of room.peers) send(other.socket, { type: "PEER_LEFT", peerId: left?.id });
    if (!room.peers.length) rooms.delete(room.id);
    else if (left?.role === "host") {
      room.peers[0].role = "host";
      send(room.peers[0].socket, { type: "ROLE_CHANGED", role: "host" });
    }
    return;
  }
}
