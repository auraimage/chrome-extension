import { DEFAULT_EDGE_BASE } from './config';
import { describe, expect, it } from 'vitest';

describe('config', () => {
  it('defaults the edge base to the production CDN', () => {
    expect(DEFAULT_EDGE_BASE).toBe('https://cdn.auraimage.ai');
  });
});
