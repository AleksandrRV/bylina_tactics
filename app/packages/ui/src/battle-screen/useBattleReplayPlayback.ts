import { useEffect, useRef } from "react";
import { useReplayControls } from "../useReplayControls.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { TacticsKernel } from "@bylina/core";

export function useBattleReplayPlayback(base: BattleScreenBase, kinds: BattleKinds, kernel: TacticsKernel | null) {
  const { isReplay, replayJournal } = kinds;
  // Воспроизведение повтора (0.17.0): команды журнала применяются по таймеру.
  // 0.21.13 (P1-3): курсор повтора живёт в ref, поэтому интервал создаётся один
  // раз на журнал — темп ровный, deps полны, подавление exhaustive-deps не
  // нужно (раньше интервал пересоздавался после каждой команды из-за
  // replayIndex в зависимостях, что давало дрейф темпа и глушило линт).
  const { replayIndex, setReplayIndex, replayDone, setReplayDone } = useReplayControls();

  const replayIndexRef = useRef(0);
  useEffect(() => {
    replayIndexRef.current = replayIndex;
  }, [replayIndex]);

  useEffect(() => {
    if (!isReplay || !replayJournal || !kernel || replayDone) return;
    const commands = replayJournal.commands;
    const timer = window.setInterval(() => {
      const index = replayIndexRef.current;
      if (index >= commands.length) {
        window.clearInterval(timer);
        setReplayDone(true);
        return;
      }
      const command = commands[index];
      if (command) kernel.apply(command);
      replayIndexRef.current = index + 1;
      setReplayIndex(index + 1);
    }, 480);
    return () => window.clearInterval(timer);
  }, [isReplay, replayJournal, kernel, replayDone, setReplayIndex, setReplayDone]);

  return {
    replayIndex,
    setReplayIndex,
    replayDone,
    setReplayDone,
  };
}

export type BattleReplayPlaybackModel = ReturnType<typeof useBattleReplayPlayback>;
