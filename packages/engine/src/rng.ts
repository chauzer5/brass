/**
 * Seeded, serializable PRNG (mulberry32).
 *
 * All randomness in a match flows through one of these so that a match is
 * fully determined by (config, seed, action log). Its entire state is a single
 * uint32, which is stored on the match between actions.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Returns a new array; does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
  /** Current internal state, to persist and resume from. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`int() needs a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  return { next, int, shuffle, state: () => s };
}

/** A fresh random seed for starting a new match (not used inside rules code). */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
