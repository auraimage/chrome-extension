// The Badge switch: one persisted boolean controlling ambient badges on ALL
// sites (CONTEXT.md "Badge switch"). Default ON. Site mute (mute.ts) wins over
// it. Written by the on-page switcher and the popup; every content script
// reacts via storage.onChanged, so a flip lands in all open tabs at once.
import { browser } from 'wxt/browser';

/** browser.storage.sync key holding the global badges on/off state. */
export const BADGES_ENABLED_KEY = 'badgesEnabled';

export async function getBadgesEnabled(): Promise<boolean> {
  const stored = await browser.storage.sync.get(BADGES_ENABLED_KEY);
  const value = stored[BADGES_ENABLED_KEY];
  return typeof value === 'boolean' ? value : true;
}

export async function setBadgesEnabled(enabled: boolean): Promise<void> {
  await browser.storage.sync.set({ [BADGES_ENABLED_KEY]: enabled });
}
