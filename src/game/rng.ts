/**
 * Deterministic seeded PRNG (mulberry32). Same seed -> same sequence,
 * required for reproducible seeded matches.
 */
export interface Rng {
  next(): number; // float in [0, 1)
  nextInt(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(maxExclusive: number): number {
    return Math.floor(next() * maxExclusive);
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("pick: boş diziden eleman seçilemez");
    }
    return arr[nextInt(arr.length)];
  }

  return { next, nextInt, pick };
}
