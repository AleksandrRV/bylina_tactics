import { createWebRtcChannel, type Envelope, type Transport } from "@bylina/net";

/**
 * Клиент ретранслятора установления соединения (roadmap 0.17.0).
 *
 * Ретранслятор знакомит участников комнаты и передаёт описания сессии WebRTC;
 * игровые конверты (COMMAND/EVENT_BATCH/SYNC...) идут по каналу WebRTC
 * напрямую между обозревателями. При обрыве канала клиент сообщает об этом
 * (onClose) — сессия повторно подключается к комнате.
 */

export type PeerRole = "host" | "guest" | "spectator";

export interface SignalingPeer {
  id: string;
  role: PeerRole;
  name: string;
}

export interface SignalingSession {
  /** Транспорт для игровых конвертов: до установки WebRTC буферизует, затем идёт по каналу. */
  transport: Transport;
  /** Полный канал данных готов (WebRTC установлен). */
  onOpen: (listener: () => void) => void;
  onClose: (listener: () => void) => void;
  onError: (listener: (message: string) => void) => void;
  close(): void;
}

export interface RoomSummary {
  id: string;
  createdAt: number;
  host: string | null;
  peers: { id: string; role: PeerRole; name: string }[];
}

/** Канал данных (WebRTC в браузере; фейковый канал в автоматических проверках). */
export interface DataChannel extends Transport {
  receiveSignal(data: unknown): void;
  close?(): void;
}

export function createSignalingSession(options: {
  url: string;
  roomId: string;
  role: PeerRole;
  name: string;
  /** Фабрика канала данных; по умолчанию — WebRTC (createWebRtcChannel). */
  channelFactory?: (initiator: boolean) => DataChannel;
}): SignalingSession {
  const socket = openSocket(options.url);
  const openListeners = new Set<() => void>();
  const closeListeners = new Set<() => void>();
  const errorListeners = new Set<(message: string) => void>();
  let dataTransport: DataChannel | null = null;
  const buffered: Envelope[] = [];
  let closed = false;

  let upgradeToData: (initiator: boolean) => void;

  const deliverSignal = (signal: unknown): void => {
    if (dataTransport) {
      dataTransport.receiveSignal(signal);
      return;
    }
    // Сигнал пришёл раньше, чем создан канал (оффер ведомому): создаём канал.
    upgradeToData(options.role !== "host");
    (dataTransport as DataChannel | null)?.receiveSignal(signal);
  };

  upgradeToData = (initiator: boolean): void => {
    if (dataTransport) return;
    const factory = options.channelFactory ?? ((isInitiator: boolean) => createWebRtcChannel({
      initiator: isInitiator,
      onSignal: (signal) => {
        socket.send(JSON.stringify({ type: "SIGNAL", roomId: options.roomId, signal }));
      },
      receiveSignal: () => undefined,
      onConnect: () => {
        for (const listener of openListeners) listener();
      },
      onClose: () => {
        for (const listener of closeListeners) listener();
      },
      onError: (error) => {
        for (const listener of errorListeners) listener(error.message);
      },
    }));
    const channel = factory(initiator);
    dataTransport = channel;
    // Мост: конверты из канала данных доставляются подписчикам транспорта.
    channel.subscribe((message) => {
      for (const listener of listeners) listener(message);
    });
    for (const message of buffered) channel.send(message);
    buffered.length = 0;
  };

  const listeners = new Set<(message: Envelope) => void>();
  const transport: Transport = {
    send: (message) => {
      if (dataTransport) dataTransport.send(message);
      else buffered.push(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "JOIN", roomId: options.roomId, role: options.role, name: options.name }));
  });
  socket.on("message", (raw) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "JOINED") {
      // Обе стороны создают канал сразу: ведущий — инициатор, ведомый —
      // отвечающий. Оффер/ответ приходят сигналами ретранслятора.
      upgradeToData(message.role === "host");
    } else if (message.type === "SIGNAL" && message.signal !== undefined) {
      deliverSignal(message.signal);
    } else if (message.type === "PEER_JOINED") {
      // Появился соперник: если мы ведущий и канала ещё нет — создаём оффер.
      if (options.role === "host") upgradeToData(true);
    } else if (message.type === "ERROR" && typeof message.message === "string") {
      for (const listener of errorListeners) listener(message.message);
    }
  });
  socket.on("close", () => {
    for (const listener of closeListeners) listener();
  });
  socket.on("error", (error) => {
    for (const listener of errorListeners) listener(error instanceof Error ? error.message : String(error));
  });

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
    close: () => {
      if (closed) return;
      closed = true;
      try {
        socket.send(JSON.stringify({ type: "LEAVE" }));
      } catch {
        /* сокет уже закрыт */
      }
      socket.close();
      dataTransport?.close?.();
    },
  };
}

/** Перечень комнат ретранслятора (GET /rooms). */
export async function listRooms(url: string): Promise<RoomSummary[]> {
  const base = url.replace(/\/$/, "");
  const response = await fetch(`${base}/rooms`);
  if (!response.ok) throw new Error(`Relay /rooms failed: ${response.status}`);
  const data = (await response.json()) as { rooms: RoomSummary[] };
  return data.rooms ?? [];
}

type SocketLike = {
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error" | "message", listener: (data?: unknown) => void): void;
};

function openSocket(url: string): SocketLike {
  // Node-среда (автоматические проверки канала): используется ws-клиент,
  // у нативного WebSocket Node нет метода on.
  if (typeof process !== "undefined" && typeof process.versions?.node === "string") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WebSocket: NodeWebSocket } = require("ws") as typeof import("ws");
    return new NodeWebSocket(url) as unknown as SocketLike;
  }
  const socket = new WebSocket(url);
  return {
    send: (data: string) => socket.send(data),
    close: () => socket.close(),
    on: (event, listener: (data?: unknown) => void) => {
      socket.addEventListener(event, (eventData) => listener(eventData as unknown));
    },
  } as SocketLike;
}
