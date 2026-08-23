import { useRef } from "react";

/** Keeps renderer callbacks stable while BattleScreenView updates its handlers. */
export function useBattleInput() {
  return useRef<{ onCell: (x: number, y: number) => void; onHover: (x: number, y: number) => void }>({
    onCell: () => undefined,
    onHover: () => undefined,
  });
}
