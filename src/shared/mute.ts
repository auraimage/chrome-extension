// Per-site badge muting, persisted in browser.storage.sync under `mutedHosts`.
// Shared by the content script (reads it to decide initial overlay visibility,
// and writes it from the switcher menu's "hide on <host>" row) and the popup
// (its "hide on <host>" toggle writes it). Badges default ON, so a host is
// visible unless it appears in this list.
import { browser } from 'wxt/browser';

/** browser.storage.sync key holding the muted hostnames. */
export const MUTED_HOSTS_KEY = 'mutedHosts';

export async function getMutedHosts(): Promise<string[]> {
  const stored = await browser.storage.sync.get(MUTED_HOSTS_KEY);
  const value = stored[MUTED_HOSTS_KEY];
  return Array.isArray(value) ? value.filter((host): host is string => typeof host === 'string') : [];
}

export async function isHostMuted(host: string): Promise<boolean> {
  return (await getMutedHosts()).includes(host);
}

/** Add or remove `host` from the muted list. */
export async function setHostMuted(host: string, muted: boolean): Promise<void> {
  const hosts = new Set(await getMutedHosts());
  if (muted) hosts.add(host);
  else hosts.delete(host);
  await browser.storage.sync.set({ [MUTED_HOSTS_KEY]: [...hosts] });
}
