/**
 * Ретранслятор установления соединения (roadmap 0.17.0, tech-stack §5).
 * НЕ исполняет игровые правила: только знакомство участников комнаты
 * и передача описаний сессии WebRTC (SIGNAL без адресата — всем остальным).
 *
 * Протокол (JSON по WebSocket):
 *   → { type: "JOIN", roomId, role, name }
 *   → { type: "SIGNAL", roomId, signal }        (широковещательно остальным)
 *   → { type: "LEAVE" }
 *   ← { type: "JOINED", roomId, role, peers }
 *   ← { type: "PEER_JOINED", peer }
 *   ← { type: "SIGNAL", from, signal }
 *   ← { type: "PEER_LEFT", peerId }
 *   ← { type: "ERROR", message }
 *
 * HTTP: GET /rooms — перечень комнат; GET /health — доступность.
 */
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const MAX_PEERS = 4;

export function createRelayServer(options = {}) {
  /** @type {Map<string, Room>} */
  const rooms = new Map();

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (url === "/rooms" || url.startsWith("/rooms?")) {
      res.writeHead(200);
      res.end(JSON.stringify({ rooms: [...rooms.values()].map(roomInfo) }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    const peer = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role: "guest", name: "player", socket };
    let joinedRoomId = null;

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        send(socket, { type: "ERROR", message: "BAD_JSON" });
        return;
      }
      if (message.type === "JOIN" && message.roomId) {
        peer.name = String(message.name ?? peer.name);
        if (message.role === "guest" || message.role === "spectator") peer.role = message.role;
        joinedRoomId = String(message.roomId);
        joinRoom(rooms, joinedRoomId, peer, MAX_PEERS);
      } else if (message.type === "SIGNAL" && message.roomId) {
        // Сигналы допустимы только в комнату, в которую участник вступил:
        // иначе любой сокет мог бы рассылать сигналы в чужую комнату.
        if (!joinedRoomId || joinedRoomId !== String(message.roomId)) {
          send(socket, { type: "ERROR", message: "NOT_IN_ROOM" });
          return;
        }
        const room = rooms.get(String(message.roomId));
        for (const other of room?.peers ?? []) {
          if (other.id !== peer.id) send(other.socket, { type: "SIGNAL", from: peer.id, signal: message.signal });
        }
      } else if (message.type === "LEAVE") {
        if (joinedRoomId) leaveRoom(rooms, peer.id);
        joinedRoomId = null;
        socket.close();
      } else {
        send(socket, { type: "ERROR", message: "BAD_MESSAGE" });
      }
    });

    socket.on("close", () => {
      if (joinedRoomId) leaveRoom(rooms, peer.id);
    });
    socket.on("error", () => undefined);
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, options.host ?? "0.0.0.0", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, wss, port, rooms });
    });
  });
}

/**
 * @typedef {{ id, role: "host" | "guest" | "spectator", name, socket: import("ws").WebSocket }} Peer
 * @typedef {{ id, peers, createdAt: number }} Room
 */

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
    host: room.peers.find((peer) => peer.role === "host")?.name ?? null,
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
    role: peer.role,
    peers: room.peers.filter((candidate) => candidate.id !== peer.id).map(peerInfo),
  });
  for (const other of room.peers) {
    if (other.id !== peer.id) send(other.socket, { type: "PEER_JOINED", peer: peerInfo(peer) });
  }
}

function leaveRoom(rooms, peerId) {
  for (const room of rooms.values()) {
    const index = room.peers.findIndex((peer) => peer.id === peerId);
    if (index === -1) continue;
    const [left] = room.peers.splice(index, 1);
    for (const other of room.peers) send(other.socket, { type: "PEER_LEFT", peerId: left?.id });
    if (room.peers.length === 0) rooms.delete(room.id);
    else if (left?.role === "host" && room.peers[0]) {
      room.peers[0].role = "host";
      send(room.peers[0].socket, { type: "ROLE_CHANGED", role: "host" });
    }
    return;
  }
}
