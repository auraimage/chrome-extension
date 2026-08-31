import { analyzeImage } from '../shared/analyze';
import {
  FLAG_KEYS,
  buildHighlightBarModel,
  highlightLabel,
  highlightTone,
  isHighlightKey,
  matchesHighlight,
  stepIndex
} from '../shared/highlight';
import type { AmbientImageFacts, HighlightKey } from '../shared/types';
import { describe, expect, it } from 'vitest';

/** A clean, correctly sized, lazy, modern-format image with alt text. */
function facts(overrides: Partial<AmbientImageFacts> = {}): AmbientImageFacts {
  return {
    currentSrc: 'https://cdn.example.com/hero.avif',
    naturalW: 800,
    naturalH: 600,
    displayW: 800,
    displayH: 600,
    dpr: 1,
    alt: 'A descriptive alt',
    loading: 'lazy',
    hasSrcset: true,
    transferBytes: 100_000,
    format: 'avif',
    isLcp: false,
    ...overrides
  };
}

describe('highlight keys and labels', () => {
  it('lists the four card flags in card order', () => {
    expect(FLAG_KEYS).toEqual(['oversized', 'altAbsent', 'missingLazy', 'legacyFormat']);
  });

  it('labels every key with lowercase mono voice, never an em dash', () => {
    const keys: HighlightKey[] = [...FLAG_KEYS, 'lcp'];
    for (const key of keys) {
      const label = highlightLabel(key);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain('—');
    }
    expect(highlightLabel('altAbsent')).toBe('missing alt');
    expect(highlightLabel('lcp')).toBe('LCP image');
  });

  it('tones fired flags as loss and the LCP designation as accent', () => {
    for (const key of FLAG_KEYS) expect(highlightTone(key)).toBe('loss');
    expect(highlightTone('lcp')).toBe('accent');
  });

  it('narrows untrusted message fields to known keys only', () => {
    expect(isHighlightKey('oversized')).toBe(true);
    expect(isHighlightKey('lcp')).toBe(true);
    expect(isHighlightKey('constructor')).toBe(false);
    expect(isHighlightKey('__proto__')).toBe(false);
    expect(isHighlightKey(null)).toBe(false);
    expect(isHighlightKey(42)).toBe(false);
  });
});

describe('matchesHighlight', () => {
  it('matches nothing on a clean image', () => {
    const clean = analyzeImage(facts());
    for (const key of [...FLAG_KEYS, 'lcp'] as const) expect(matchesHighlight(key, clean)).toBe(false);
  });

  it('maps each key to exactly its own flag', () => {
    expect(matchesHighlight('oversized', analyzeImage(facts({ naturalW: 4000, naturalH: 3000 })))).toBe(true);
    expect(matchesHighlight('altAbsent', analyzeImage(facts({ alt: null })))).toBe(true);
    expect(matchesHighlight('missingLazy', analyzeImage(facts({ loading: 'eager' })))).toBe(true);
    expect(matchesHighlight('legacyFormat', analyzeImage(facts({ format: 'jpeg' })))).toBe(true);
    expect(matchesHighlight('lcp', analyzeImage(facts({ isLcp: true })))).toBe(true);
  });

  it('treats an empty alt as present, matching the card\'s "missing alt" count', () => {
    expect(matchesHighlight('altAbsent', analyzeImage(facts({ alt: '' })))).toBe(false);
  });
});

describe('stepIndex', () => {
  it('wraps forward past the end and backward past the start', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
    expect(stepIndex(2, 1, 5)).toBe(3);
  });

  it('is zero with no matches, so a stale index never indexes an empty list', () => {
    expect(stepIndex(3, 1, 0)).toBe(0);
  });
});

describe('buildHighlightBarModel', () => {
  it('renders the label, a one-based counter, and stepping when there is somewhere to go', () => {
    const model = buildHighlightBarModel('oversized', 0, 5);
    expect(model.label).toBe('oversized');
    expect(model.counter).toBe('1 of 5');
    expect(model.tone).toBe('loss');
    expect(model.canStep).toBe(true);
  });

  it('disables stepping with a single match', () => {
    const model = buildHighlightBarModel('lcp', 0, 1);
    expect(model.counter).toBe('1 of 1');
    expect(model.canStep).toBe(false);
    expect(model.tone).toBe('accent');
  });

  it('says so when a re-collect removed every match instead of showing 1 of 0', () => {
    const model = buildHighlightBarModel('missingLazy', 2, 0);
    expect(model.counter).toBe('none on page');
    expect(model.canStep).toBe(false);
  });

  it('clamps a stale index into range after matches shrink', () => {
    expect(buildHighlightBarModel('oversized', 7, 3).counter).toBe('3 of 3');
  });

  it('keeps the visible label verbatim in the accessible name (WCAG 2.5.3)', () => {
    const model = buildHighlightBarModel('legacyFormat', 1, 12);
    expect(model.ariaLabel).toContain(model.label);
    expect(model.ariaLabel).toContain(model.counter);
    expect(model.ariaLabel).not.toContain('—');
  });
});
