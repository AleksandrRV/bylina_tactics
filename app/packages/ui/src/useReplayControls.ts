import { useState } from "react";

/** Replay cursor state isolated from the rest of the battle presentation. */
export function useReplayControls() {
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayDone, setReplayDone] = useState(false);
  return { replayIndex, setReplayIndex, replayDone, setReplayDone };
}
