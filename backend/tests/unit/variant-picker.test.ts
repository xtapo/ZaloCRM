// Phase 7+ — variant-picker unit tests.
//
// pickVariantIndex chọn variant A/B: 'random' (Math.random) hoặc 'even_split'
// (FNV-1a hash của seed — deterministic theo taskId nên retry giữ nguyên variant).

import { describe, it, expect } from 'vitest';
import { hashString, pickVariantIndex } from '../../src/modules/automation/engine/variant-picker.js';

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('task-abc')).toBe(hashString('task-abc'));
  });

  it('returns a 32-bit unsigned int in [0, 2^32)', () => {
    for (const s of ['', 'x', 'task-123', 'zalocrm']) {
      const h = hashString(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it('differs across different inputs (sanity)', () => {
    const seen = new Set(['a', 'b', 'c', 'task-1', 'task-2'].map(hashString));
    expect(seen.size).toBe(5);
  });
});

describe('pickVariantIndex', () => {
  it('always returns 0 when count <= 1', () => {
    expect(pickVariantIndex(0, 'random')).toBe(0);
    expect(pickVariantIndex(1, 'even_split', 'seed')).toBe(0);
  });

  it('random returns an index within bounds', () => {
    for (let i = 0; i < 50; i++) {
      const idx = pickVariantIndex(3, 'random');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
      expect(Number.isInteger(idx)).toBe(true);
    }
  });

  it('even_split is deterministic given the same seed', () => {
    const a = pickVariantIndex(4, 'even_split', 'task-xyz');
    const b = pickVariantIndex(4, 'even_split', 'task-xyz');
    expect(a).toBe(b);
    expect(a).toBeLessThan(4);
  });

  it('even_split with different seeds can differ but stays in bounds', () => {
    for (let i = 0; i < 20; i++) {
      const idx = pickVariantIndex(2, 'even_split', `task-${i}`);
      expect(idx === 0 || idx === 1).toBe(true);
    }
  });

  it('random without seed still works (no crash)', () => {
    expect(pickVariantIndex(2, 'even_split')).toBeLessThan(2); // fallback Math.random path
  });
});
