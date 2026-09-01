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
  /** Предел ожидания сбора кандидатов в миллисекундах (по умолчанию 2000). */
  gatheringTimeoutMs?: number;
}

/** Описание сессии, передаваемое изображением быстрого считывания либо короткой строкой. */
interface WebRtcSignal {
  type: "offer" | "answer";
  sdp: string;
}

/**
 * Кандидатный STUN-сервер: в одной локальной сети соединение обычно
 * устанавливается прямыми адресами, но внешний сервер повышает шанс
 * соединения в неочевидных сетевых конфигурациях.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Предел ожидания сбора кандидатов (0.21.18).
 *
 * Описание готовится целиком — «капающих» кандидатов при офлайн-обмене нет,
 * — но ждать событие завершения сбора без предела нельзя: в локальной сети
 * без выхода в интернет внешний сервер недостижим, сбор тянется десятки
 * секунд, и ведущий, нажавший «Создать партию», не получает кода вовсе.
 * По истечении предела описание уходит с адресами, собранными к этому
 * моменту: прямые адреса локальной сети появляются в первые миллисекунды,
 * а внешний сервер нужен лишь конфигурациям, где прямые адреса закрыты.
 */
const GATHERING_TIMEOUT_MS = 2_000;

function isWebRtcSignal(value: unknown): value is WebRtcSignal {
  const candidate = value as Partial<WebRtcSignal> | null;
  return (
    !!candidate &&
    typeof candidate === "object" &&
    (candidate.type === "offer" || candidate.type === "answer") &&
    typeof candidate.sdp === "string"
  );
}

/**
 * Канал локальной сети на WebRTC (technology.md: канал WebRTC между
 * обозревателями; исполнение правил — у ведущего). Реализован на нативном
 * RTCPeerConnection без сторонних библиотек: пакет собирается в браузере
 * как ESM и не требует полифилов `process`/`buffer`. Обмен описаниями
 * сессии выполняется офлайн — изображением быстрого считывания либо
 * короткой строкой (roadmap 0.15.0), поэтому описание отдаётся наружу
 * целиком (аналог `trickle: false`): после завершения сбора кандидатов
 * либо — если сбор не завершился — по истечении предела ожидания
 * (`gatheringTimeoutMs`, 0.21.18).
 */
export function createWebRtcChannel(
  options: WebRtcChannelOptions,
): Transport & { receiveSignal(data: unknown): void; close(): void } {
  if (typeof RTCPeerConnection === "undefined") {
    // Среды без WebRTC (например, тесты в Node): канал недоступен,
    // но пакет продолжает собираться и использоваться в фейковых каналах.
    throw new Error("WebRTC is not available in this environment");
  }

  const gatheringTimeoutMs = options.gatheringTimeoutMs ?? GATHERING_TIMEOUT_MS;
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const listeners = new Set<(message: Envelope) => void>();
  // Конверты, отправленные до открытия канала данных, ждут в очереди.
  const pending: string[] = [];
  let dataChannel: RTCDataChannel | null = null;
  let signalSent = false;
  let closed = false;
  let gatheringTimer: ReturnType<typeof setTimeout> | null = null;

  const reportError = (error: unknown): void => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  const stopGatheringWait = (): void => {
    if (gatheringTimer === null) return;
    clearTimeout(gatheringTimer);
    gatheringTimer = null;
  };

  // Описание отдаётся один раз: по завершении сбора кандидатов либо по
  // истечении предела ожидания — дополнительного сигнального канала для
  // «капающих» кандидатов нет, поэтому второе описание не отдаётся.
  const emitLocalSignal = (): void => {
    if (signalSent || closed || !peer.localDescription) return;
    if (peer.iceGatheringState !== "complete") return;
    stopGatheringWait();
    signalSent = true;
    options.onSignal?.({ type: peer.localDescription.type, sdp: peer.localDescription.sdp });
  };

  /**
   * Страховка от сбора, который не завершается: внешний сервер недостижим,
   * и событие пришло бы слишком поздно либо не пришло бы вовсе (0.21.18).
   */
  const armGatheringWait = (): void => {
    if (signalSent || closed || gatheringTimer !== null) return;
    gatheringTimer = setTimeout(() => {
      gatheringTimer = null;
      if (signalSent || closed || !peer.localDescription) return;
      signalSent = true;
      options.onSignal?.({ type: peer.localDescription.type, sdp: peer.localDescription.sdp });
    }, gatheringTimeoutMs);
  };

  /** Описание положено — ждём завершения сбора, но не дольше предела. */
  const localDescriptionReady = (): void => {
    emitLocalSignal();
    armGatheringWait();
  };
  peer.addEventListener("icegatheringstatechange", emitLocalSignal);

  const bindDataChannel = (channel: RTCDataChannel): void => {
    dataChannel = channel;
    channel.addEventListener("open", () => {
      options.onConnect?.();
      while (pending.length > 0 && dataChannel?.readyState === "open") {
        const message = pending.shift();
        if (message !== undefined) dataChannel.send(message);
      }
    });
    channel.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Envelope;
        for (const listener of listeners) listener(message);
      } catch {
        /* повреждённый конверт игнорируется */
      }
    });
    channel.addEventListener("close", () => {
      if (!closed) options.onClose?.();
    });
    channel.addEventListener("error", () => {
      reportError(new Error("WebRTC data channel error"));
    });
  };

  if (options.initiator) {
    // Ведущий сам создаёт канал данных и предложение; ведомый получает
    // канал данных событием и отвечает после приёма предложения.
    bindDataChannel(peer.createDataChannel("game"));
    void (async () => {
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        localDescriptionReady();
      } catch (error) {
        reportError(error);
      }
    })();
  } else {
    peer.addEventListener("datachannel", (event) => {
      bindDataChannel(event.channel);
    });
  }

  peer.addEventListener("connectionstatechange", () => {
    if (closed) return;
    if (peer.connectionState === "failed") {
      reportError(new Error("WebRTC connection failed"));
      options.onClose?.();
    } else if (peer.connectionState === "closed") {
      options.onClose?.();
    }
  });

  const receiveSignal = (signal: unknown): void => {
    if (!isWebRtcSignal(signal)) throw new Error("Invalid WebRTC session description");
    void (async () => {
      try {
        await peer.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
        if (signal.type === "offer" && !peer.localDescription) {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          // Сбор кандидатов мог завершиться сразу (например, без сети),
          // а мог и не завершиться вовсе — тогда описание уйдёт по пределу.
          localDescriptionReady();
        }
      } catch (error) {
        reportError(error);
      }
    })();
  };
  options.receiveSignal = receiveSignal;

  const close = (): void => {
    if (closed) return;
    closed = true;
    stopGatheringWait();
    peer.close();
  };

  return {
    send: (message) => {
      const text = JSON.stringify(message);
      if (dataChannel?.readyState === "open") dataChannel.send(text);
      else pending.push(text);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receiveSignal,
    close,
  };
}
