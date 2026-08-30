// Deterministic PRNG + seed derivation shared by every game module and by
// the server-side validator. Never use Math.random() in game logic.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turns any string (e.g. "run123") into a 32-bit int usable as a mulberry32 seed.
export function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// Derives a child seed for e.g. level N of a run from the run's root seed,
// so `hash(runSeed, levelIndex)` is stable and reproducible.
export function deriveSeed(rootSeed, index) {
  const base = typeof rootSeed === 'string' ? hashStringToSeed(rootSeed) : rootSeed >>> 0;
  return hashStringToSeed(`${base}:${index}`);
}

// Seed for "everyone plays the same levels today" race modes.
export function dailySeedString(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
