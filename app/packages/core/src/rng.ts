/** Mulberry32. Документ математики, §1. */
export interface Rng {
  nextInt(min: number, max: number): number;
}

export function createMulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const nextFloat = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nextInt: (min, max) => {
      if (max < min) return min;
      return min + Math.floor(nextFloat() * (max - min + 1));
    },
  };
}

export function clampChance(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}
