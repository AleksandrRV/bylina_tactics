/// <reference lib="webworker" />
import { serializeSaveDraft, type SaveDraft } from "./index.js";

type WorkerRequest = { id: number; data: SaveDraft };
type WorkerResponse = { id: number; serialized?: string; error?: string };

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const response: WorkerResponse = { id: data.id, serialized: serializeSaveDraft(data.data) };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = { id: data.id, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};
