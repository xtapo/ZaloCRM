// Phase 7+ — A/B message variant picker.
//
// Blocks already carry multiple variants (greetingVariants / textVariants).
// Until now the pick was always uniform-random. This adds a per-block
// `variantStrategy`:
//   - 'random'     (default) — uniform random, current behavior
//   - 'even_split' — deterministic round-robin by task UUID hash, so over a
//                    campaign each variant gets ~equal volume (A/B split)
//
// Pure module — no DB — so it's unit-testable in isolation.

export type VariantStrategy = 'random' | 'even_split';

/** Deterministic 32-bit FNV-1a hash → non-negative int. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick a variant index.
 * @param count      number of variants (must be ≥ 1)
 * @param strategy   'random' | 'even_split'
 * @param seed       stable per-execution key for even_split (e.g. taskId)
 */
export function pickVariantIndex(
  count: number,
  strategy: VariantStrategy,
  seed?: string,
): number {
  if (count <= 1) return 0;
  if (strategy === 'even_split' && seed) {
    return hashString(seed) % count;
  }
  return Math.floor(Math.random() * count);
}
