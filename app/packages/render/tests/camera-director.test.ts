import { describe, expect, it } from "vitest";
import { beginCameraCue, createCameraDirector, enqueueCameraCue, skipCameraCue } from "../src/camera.js";

describe("camera director", () => {
  it("queues pan and skip unlocks input", () => {
    let state = createCameraDirector({ x: 0, y: 0 });
    state = enqueueCameraCue(state, { kind: "panTo", point: { x: 10, y: 4 } });
    state = beginCameraCue(state);
    expect(state.current?.kind).toBe("panTo");
    expect(state.inputLocked).toBe(true);
    state = skipCameraCue(state);
    expect(state.current).toBeNull();
    expect(state.inputLocked).toBe(false);
  });
});
