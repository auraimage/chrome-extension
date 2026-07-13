import { formatBytes, formatPercent } from '../shared/format';
import { describe, expect, it } from 'vitest';

describe('formatBytes — decimal (1000-based) units, one decimal max', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [999, '999 B'],
    [1000, '1 KB'],
    [1500, '1.5 KB'],
    [1250, '1.3 KB'], // rounds to one decimal
    [999_999, '1000 KB'],
    [1_000_000, '1 MB'],
    [2_500_000, '2.5 MB'],
    [1_234_567, '1.2 MB']
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatPercent — fraction to percent, one decimal max', () => {
  it.each([
    [0, '0%'],
    [0.55, '55%'],
    [0.123, '12.3%'],
    [1, '100%'],
    [0.9999, '100%']
  ])('formats fraction %d as %s', (fraction, expected) => {
    expect(formatPercent(fraction)).toBe(expected);
  });
});
