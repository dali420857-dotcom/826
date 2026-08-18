function fnv32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Deterministic local identifier hash; this is not used for secrets or authentication. */
export function hashValue(value: string): string {
  return [
    2_166_136_261,
    3_735_928_559,
    1_597_463_001,
    2_801_191_535,
  ]
    .map((seed) => fnv32(value, seed).toString(16).padStart(8, '0'))
    .join('');
}
