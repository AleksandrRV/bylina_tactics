import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveSerializer, serializeSaveDraft, type SaveDraft } from "../src/index.js";

/**
 * Автосохранение не должно замолкать навсегда (P0-3, Major-1): после ошибки
 * либо молчания рабочего потока следующая сериализация обязана разрешиться —
 * синхронным откатом на главный поток, а не повисшим промисом.
 */

/** Минимальный валидный черновик сохранения. */
function sampleDraft(): SaveDraft {
  return {
    formatVersion: 2,
    version: "0.21.3",
    savedAt: 1,
    campaign: {
      chapter: "open",
      darkness: 0,
      darknessMax: 20,
      phase: "active",
      resources: { gold: 1, herbs: 0, artifacts: 0 },
      inventory: [],
      shipPosition: { x: 1, y: 1 },
      missions: [],
      fighters: [],
      deadGenerals: [],
      activeMissionId: null,
      lastResult: null,
    },
    session: {
      screen: "menu",
      battleKind: null,
      activeMissionId: null,
      deployment: [],
      matchSeed: 1,
      outcome: null,
      difficulty: null,
    },
  } as unknown as SaveDraft;
}

/** Минимальный двойник веб-воркера, который сразу сообщает об ошибке. */
class DeadWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  postMessage(): void {
    // Сообщаем об ошибке асинхронно (после установки обработчика).
    queueMicrotask(() => this.onerror?.({}));
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** Двойник воркера, который принимает сообщения и никогда не отвечает. */
class SilentWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe("createSaveSerializer resilience (0.21.3, P0-3)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    // Восстанавливаем исходное отсутствие Worker (среда Node).
    if (originalWorker === undefined) {
      delete (globalThis as Partial<typeof globalThis>).Worker;
    } else {
      (globalThis as { Worker: unknown }).Worker = originalWorker;
    }
  });

  it("falls back to the main thread after a dead worker instead of hanging", async () => {
    (globalThis as { Worker: unknown }).Worker = DeadWorker as unknown as typeof Worker;
    const serializer = createSaveSerializer();
    const draft = sampleDraft();

    // Первый вызов застаёт ошибку воркера и отклоняется.
    await expect(serializer.serialize(draft)).rejects.toThrow("Save worker failed");
    // КЛЮЧЕВОЕ: следующий вызов НЕ виснет — он разрешается синхронным откатом.
    const serialized = await serializer.serialize(draft);
    expect(serialized).toBe(serializeSaveDraft(draft));
    // Об отключенном откате сообщается явно, а не молча.
    expect(warn).toHaveBeenCalled();

    serializer.dispose();
  });

  it("resolves via the main thread when the worker never answers", async () => {
    (globalThis as { Worker: unknown }).Worker = SilentWorker as unknown as typeof Worker;
    // Таймаут задан коротким: в реальности это 4000 мс.
    const serializer = createSaveSerializer({ timeoutMs: 25 });
    const draft = sampleDraft();

    const serialized = await serializer.serialize(draft);
    expect(serialized).toBe(serializeSaveDraft(draft));

    // После таймаута поток считается мёртвым: следующий вызов сразу идёт на
    // главный поток, не дожидаясь нового таймаута.
    const second = await serializer.serialize(draft);
    expect(second).toBe(serializeSaveDraft(draft));

    serializer.dispose();
  });

  it("rejects pending requests and clears timers on dispose", async () => {
    const silent = new SilentWorker();
    class HeldWorker {
      constructor() {
        // Тот же экземпляр, чтобы проверить terminate.
        return silent;
      }
    }
    (globalThis as { Worker: unknown }).Worker = HeldWorker as unknown as typeof Worker;
    const serializer = createSaveSerializer({ timeoutMs: 5000 });
    const pending = serializer.serialize(sampleDraft());
    serializer.dispose();
    await expect(pending).rejects.toThrow("Save worker disposed");
    expect(silent.terminated).toBe(true);
  });
});
