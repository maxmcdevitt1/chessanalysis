export interface RNG {
  seed?: number | string;
  next(): number;
}

export type SeedInput = number | string | undefined;

const UINT32_MAX = 0xffffffff;

export function createMulberry32(seedInput: SeedInput = Date.now()): RNG {
  let seed = typeof seedInput === 'number'
    ? seedInput >>> 0
    : hashString(String(seedInput));
  if (!seed) seed = 0x9e3779b9;
  return {
    seed,
    next() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const out = ((t ^ (t >>> 14)) >>> 0) / UINT32_MAX;
      return out <= 0 ? 1 / UINT32_MAX : out >= 1 ? (UINT32_MAX - 1) / UINT32_MAX : out;
    },
  };
}

export function createMathRandomRng(): RNG {
  return { next: () => Math.random() };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
  }
  return hash >>> 0;
}
