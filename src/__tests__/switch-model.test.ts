import { buildSwitchModel } from '../content/switch-model';
import type { SwitchState } from '../content/switch-model';
import { describe, expect, it } from 'vitest';

/** Badges on, host not muted, twelve badged images: the common resting state. */
function baseState(overrides: Partial<SwitchState> = {}): SwitchState {
  return {
    badgeCount: 12,
    badgesEnabled: true,
    muted: false,
    hostname: 'example.com',
    ...overrides
  };
}

describe('buildSwitchModel visibility', () => {
  it('is visible when the page has badges and the host is not muted', () => {
    expect(buildSwitchModel(baseState()).visible).toBe(true);
  });

  it('is hidden on a page with no badged images', () => {
    expect(buildSwitchModel(baseState({ badgeCount: 0 })).visible).toBe(false);
  });

  it('is hidden on a muted host, even with badges and the switch on', () => {
    expect(buildSwitchModel(baseState({ muted: true })).visible).toBe(false);
  });

  it('stays visible when badges are hidden globally, so the hide is undoable', () => {
    expect(buildSwitchModel(baseState({ badgesEnabled: false })).visible).toBe(true);
  });
});

describe('buildSwitchModel label', () => {
  it('shows the badge count while badges are on', () => {
    expect(buildSwitchModel(baseState()).label).toBe('x-ray · 12');
  });

  it('drops the count when badges are hidden, since it no longer describes the page', () => {
    const model = buildSwitchModel(baseState({ badgesEnabled: false }));
    expect(model.label).toBe('x-ray');
    expect(model.collapsed).toBe(true);
  });

  it('is not collapsed while badges are on', () => {
    expect(buildSwitchModel(baseState()).collapsed).toBe(false);
  });
});

describe('buildSwitchModel ariaLabel', () => {
  it('names the extension, the state, and the affordance', () => {
    expect(buildSwitchModel(baseState()).ariaLabel).toBe('aura x-ray, 12 images. open menu');
  });

  it('singularizes a lone image', () => {
    expect(buildSwitchModel(baseState({ badgeCount: 1 })).ariaLabel).toBe('aura x-ray, 1 image. open menu');
  });

  it('reports the hidden state instead of a count when badges are off', () => {
    expect(buildSwitchModel(baseState({ badgesEnabled: false })).ariaLabel).toBe(
      'aura x-ray, badges hidden. open menu'
    );
  });

  it('never contains an em dash', () => {
    expect(buildSwitchModel(baseState()).ariaLabel).not.toContain('—');
  });
});

describe('buildSwitchModel menu items', () => {
  it('offers per-host then global hiding while badges are on', () => {
    expect(buildSwitchModel(baseState()).items).toEqual([
      { id: 'hide-host', label: 'hide on example.com' },
      { id: 'hide-all', label: 'hide on every site' }
    ]);
  });

  it('leads with the global undo when badges are hidden, keeping per-host available', () => {
    expect(buildSwitchModel(baseState({ badgesEnabled: false })).items).toEqual([
      { id: 'show-all', label: 'show on every site' },
      { id: 'hide-host', label: 'hide on example.com' }
    ]);
  });

  it('interpolates the real hostname', () => {
    const items = buildSwitchModel(baseState({ hostname: 'news.ycombinator.com' })).items;
    expect(items[0]?.label).toBe('hide on news.ycombinator.com');
  });

  it('never offers a per-host show action, because a muted host has no switcher', () => {
    for (const badgesEnabled of [true, false]) {
      const model = buildSwitchModel(baseState({ badgesEnabled }));
      expect(model.items.map((item) => item.id)).not.toContain('show-host');
    }
  });
});
