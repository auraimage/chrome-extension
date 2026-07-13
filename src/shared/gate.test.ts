import { FREE_EXPORT_ALLOWANCE, isGated, nextUsed, remainingExports } from './gate';
import { describe, expect, it } from 'vitest';

describe('gate state machine', () => {
  it('allows exactly three free exports before gating', () => {
    // Model the record-after-allow order: check gate, perform, then increment.
    let used = 0;
    const performed: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      if (isGated(used)) continue;
      performed.push(attempt);
      used = nextUsed(used);
    }
    expect(performed).toEqual([0, 1, 2]);
    expect(used).toBe(FREE_EXPORT_ALLOWANCE);
  });

  it('is not gated below the allowance and gated at or above it', () => {
    expect(isGated(0)).toBe(false);
    expect(isGated(2)).toBe(false);
    expect(isGated(3)).toBe(true);
    expect(isGated(4)).toBe(true);
  });

  it('reports remaining exports, clamped at zero', () => {
    expect(remainingExports(0)).toBe(3);
    expect(remainingExports(3)).toBe(0);
    expect(remainingExports(5)).toBe(0);
  });

  it('increments the used count by one', () => {
    expect(nextUsed(0)).toBe(1);
    expect(nextUsed(3)).toBe(4);
  });
});
