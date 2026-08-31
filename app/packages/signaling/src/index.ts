import { createWebRtcChannel, type Envelope, type Transport } from "@bylina/net";

export type PeerRole = "host" | "guest" | "spectator";
export type SignalingState = "connecting" | "reconnecting" | "signaling-connected" | "rtc-connected" | "closed";

export interface SignalingPeer {
  id: string;
  role: PeerRole;
  name: string;
}
export interface RoomSummary {
  id: string;
  createdAt: number;
  host: string | null;
  peers: SignalingPeer[];
}
export interface DataChannel extends Transport {
  receiveSignal(data: unknown): void;
  close?(): void;
}

export interface SignalingSession {
  transport: Transport;
  onOpen(listener: () => void): void;
  /** Fired only when explicitly closed, not during an automatic reconnect. */
  onClose(listener: () => void): void;
  onError(listener: (message: string) => void): void;
  onRoleChange(listener: (role: PeerRole) => void): void;
  onStateChange(listener: (state: SignalingState) => void): void;
  getState(): SignalingState;
  getRole(): PeerRole;
  close(): void;
}

export function createSignalingSession(options: {
  url: string;
  roomId: string;
  role: PeerRole;
  name: string;
  channelFactory?: (initiator: boolean) => DataChannel;
  reconnectDelayMs?: number;
}): SignalingSession {
  const openListeners = new Set<() => void>();
  const closeListeners = new Set<() => void>();
  const errorListeners = new Set<(message: string) => void>();
  const roleListeners = new Set<(role: PeerRole) => void>();
  const stateListeners = new Set<(state: SignalingState) => void>();
  const listeners = new Set<(message: Envelope) => void>();
  const channels = new Map<string, DataChannel>();
  const peers = new Map<string, SignalingPeer>();
  const buffered: Envelope[] = [];
  let socket: SocketLike | null = null;
  let closed = false;
  let state: SignalingState = "connecting";
  let role: PeerRole = options.role;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;

  const emitState = (next: SignalingState): void => {
    if (state === next) return;
    state = next;
    for (const listener of stateListeners) listener(next);
  };
  const report = (message: string): void => {
    for (const listener of errorListeners) listener(message);
  };
  const signal = (to: string, data: unknown): void => {
    try {
      socket?.send(JSON.stringify({ type: "SIGNAL", roomId: options.roomId, to, signal: data }));
    } catch {
      beginReconnect();
    }
  };
  const createChannel = (peerId: string, initiator: boolean): DataChannel => {
    const existing = channels.get(peerId);
    if (existing) return existing;
    const factory =
      options.channelFactory ??
      ((isInitiator: boolean) =>
        createWebRtcChannel({
          initiator: isInitiator,
          onSignal: (data) => signal(peerId, data),
          onConnect: () => {
            emitState("rtc-connected");
            for (const listener of openListeners) listener();
            flush();
          },
          onClose: () => beginReconnect(),
          onError: (error) => report(error.message),
          receiveSignal: () => undefined,
        }));
    const channel = factory(initiator);
    channels.set(peerId, channel);
    channel.subscribe((message) => {
      for (const listener of listeners) listener(message);
    });
    // Test/in-process channels have no separate connect event. Real WebRTC
    // flushes from onConnect above, avoiding sends before its data channel opens.
    if (options.channelFactory) flush();
    return channel;
  };
  const flush = (): void => {
    if (!channels.size) return;
    while (buffered.length) {
      const message = buffered.shift();
      if (message) for (const channel of channels.values()) channel.send(message);
    }
  };
  const resetChannels = (): void => {
    for (const channel of channels.values()) channel.close?.();
    channels.clear();
  };
  const join = (): void =>
    socket?.send(JSON.stringify({ type: "JOIN", roomId: options.roomId, role, name: options.name }));
  const beginReconnect = (): void => {
    if (closed || reconnectTimer) return;
    resetChannels();
    emitState("reconnecting");
    const delay = Math.min(10_000, (options.reconnectDelayMs ?? 250) * 2 ** reconnectAttempt++);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  const handleMessage = (raw: unknown): void => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(rawText(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "JOINED" && typeof message.peerId === "string" && validRole(message.role)) {
      role = message.role;
      peers.clear();
      for (const value of Array.isArray(message.peers) ? message.peers : [])
        if (isPeer(value)) peers.set(value.id, value);
      emitState("signaling-connected");
      // The host initiates one addressed channel per peer. A guest creates its
      // answering peer eagerly as well: the WebRTC channel waits for the offer,
      // while deterministic test channels can become connected without an SDP roundtrip.
      if (role === "host") for (const peer of peers.values()) createChannel(peer.id, true);
      else for (const peer of peers.values()) if (peer.role === "host") createChannel(peer.id, false);
    } else if (message.type === "PEER_JOINED" && isPeer(message.peer)) {
      peers.set(message.peer.id, message.peer);
      if (role === "host") createChannel(message.peer.id, true);
    } else if (message.type === "PEER_LEFT" && typeof message.peerId === "string") {
      peers.delete(message.peerId);
      channels.get(message.peerId)?.close?.();
      channels.delete(message.peerId);
    } else if (message.type === "SIGNAL" && typeof message.from === "string" && message.signal !== undefined) {
      const peer = peers.get(message.from);
      // A signal is accepted only from a peer announced by the relay.
      if (!peer) return;
      createChannel(message.from, false).receiveSignal(message.signal);
    } else if (message.type === "ROLE_CHANGED" && validRole(message.role)) {
      role = message.role;
      for (const listener of roleListeners) listener(role);
      if (role === "host") for (const peer of peers.values()) createChannel(peer.id, true);
    } else if (message.type === "ERROR" && typeof message.message === "string") report(message.message);
  };
  const connect = (): void => {
    if (closed) return;
    // Открытие сокета асинхронно: в Node/ESM модуль `ws` подгружается
    // динамически (глобального `require` там нет). Ошибка открытия —
    // та же ветка, что и обрыв соединения: переподключение.
    void openSocket(options.url)
      .then((opened) => {
        if (closed) {
          try {
            opened.close();
          } catch {
            /* уже закрыт */
          }
          return;
        }
        socket = opened;
        opened.on("open", () => join());
        opened.on("message", handleMessage);
        opened.on("close", () => beginReconnect());
        opened.on("error", (error) => report(error instanceof Error ? error.message : String(error)));
      })
      .catch((error: unknown) => {
        if (closed) return;
        report(error instanceof Error ? error.message : String(error));
        beginReconnect();
      });
  };

  const transport: Transport = {
    send: (message) => {
      if (channels.size) for (const channel of channels.values()) channel.send(message);
      else buffered.push(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  connect();
  return {
    transport,
    onOpen: (listener) => {
      openListeners.add(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    onError: (listener) => {
      errorListeners.add(listener);
    },
    onRoleChange: (listener) => {
      roleListeners.add(listener);
    },
    onStateChange: (listener) => {
      stateListeners.add(listener);
    },
    getState: () => state,
    getRole: () => role,
    close: () => {
      if (closed) return;
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        socket?.send(JSON.stringify({ type: "LEAVE" }));
      } catch {
        /* closed already */
      }
      socket?.close();
      resetChannels();
      emitState("closed");
      for (const listener of closeListeners) listener();
    },
  };
}

export async function listRooms(url: string): Promise<RoomSummary[]> {
  const response = await fetch(`${url.replace(/\/$/, "")}/rooms`);
  if (!response.ok) throw new Error(`Relay /rooms failed: ${response.status}`);
  return ((await response.json()) as { rooms?: RoomSummary[] }).rooms ?? [];
}

type SocketLike = {
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error" | "message", listener: (data?: unknown) => void): void;
};
async function openSocket(url: string): Promise<SocketLike> {
  if (typeof process !== "undefined" && typeof process.versions?.node === "string") {
    // Node/ESM: глобального `require` нет — выводим его из URL модуля.
    // Спецификатор передаётся переменной, чтобы обозревательный сборщик не
    // разрешал `node:module` статически (ветка недостижима из обозревателя,
    // но статический импорт сломал бы сборку).
    const nodeModuleSpec = "node:module";
    const { createRequire } = (await import(/* @vite-ignore */ nodeModuleSpec)) as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const { WebSocket: NodeWebSocket } = nodeRequire("ws") as typeof import("ws");
    return new NodeWebSocket(url) as unknown as SocketLike;
  }
  const socket = new WebSocket(url);
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    on: (event, listener) =>
      socket.addEventListener(event, (value) => listener(event === "message" ? (value as MessageEvent).data : value)),
  };
}
function rawText(raw: unknown): string {
  return typeof raw === "string" ? raw : String(raw);
}
function validRole(value: unknown): value is PeerRole {
  return value === "host" || value === "guest" || value === "spectator";
}
function isPeer(value: unknown): value is SignalingPeer {
  const peer = value as Partial<SignalingPeer>;
  return !!peer && typeof peer.id === "string" && typeof peer.name === "string" && validRole(peer.role);
}
