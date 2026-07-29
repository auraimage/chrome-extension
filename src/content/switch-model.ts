// Pure presentation model for the on-page switcher (CONTEXT.md "On-page
// switcher"). No DOM and no browser.* calls: it takes the persisted visibility
// state plus the page's badge count and returns everything the overlay renders,
// so all four states unit-test in a plain node environment.

/**
 * The actions the switcher menu can offer. There is deliberately no
 * "show on this host": muting a host removes the switcher there entirely
 * (CONTEXT.md "Site mute"), so the page can never offer the inverse.
 */
export type SwitchActionId = 'hide-host' | 'hide-all' | 'show-all';

export interface SwitchMenuItem {
  id: SwitchActionId;
  label: string;
}

export interface SwitchState {
  /**
   * Images with a badge attached, shown or not. Must not be gated on
   * `badgesEnabled`: a zero here makes `visible` false, which removes the
   * collapsed dot, the only way back from `hide on every site`.
   */
  badgeCount: number;
  /** The global Badge switch. */
  badgesEnabled: boolean;
  /** This host is muted (Site mute), which wins over the Badge switch. */
  muted: boolean;
  /** Hostname for the per-site row, e.g. `example.com`. */
  hostname: string;
}

export interface SwitchModel {
  /** Render the switcher at all. */
  visible: boolean;
  /** Collapsed dot form, used while badges are hidden globally. */
  collapsed: boolean;
  /**
   * Pill text. Still rendered while `collapsed` is true: the dot expands to it
   * on hover, so this is not redundant with `collapsed` and must not be
   * "simplified" away.
   */
  label: string;
  /**
   * Accessible name. Never depends on hover or `title`, both of which fail on
   * touch. Must contain `label` verbatim (WCAG 2.5.3): voice control users say
   * the words they can see, so the visible text has to be a substring of this.
   */
  ariaLabel: string;
  /** Menu rows in display order. */
  items: SwitchMenuItem[];
}

export function buildSwitchModel(state: SwitchState): SwitchModel {
  const { badgeCount, badgesEnabled, muted, hostname } = state;
  const hideHost: SwitchMenuItem = { id: 'hide-host', label: `hide on ${hostname}` };

  return {
    visible: !muted && badgeCount > 0,
    collapsed: !badgesEnabled,
    label: badgesEnabled ? `x-ray · ${badgeCount}` : 'x-ray',
    ariaLabel: badgesEnabled ? `x-ray · ${badgeCount}, open menu` : 'x-ray, badges hidden. open menu',
    items: badgesEnabled
      ? [hideHost, { id: 'hide-all', label: 'hide on every site' }]
      : [{ id: 'show-all', label: 'show on every site' }, hideHost]
  };
}
