// Export gate (Q4: seeing is free, exporting is gated). The first three exports
// (download avif/webp, copy <picture> snippet) are free; from the fourth on the
// preview still renders but the export control is replaced by a link to create a
// free project. The pure state machine below is unit-tested; the storage wrapper
// around chrome.storage.sync is a thin shell over it.

/** Free exports allowed before the gate engages. */
export const FREE_EXPORT_ALLOWANCE = 3;

/** chrome.storage.sync key holding the lifetime export count. */
export const EXPORTS_USED_KEY = 'exportsUsed';

/** Where the "create a free project" CTAs point, tagged so we can see the source. */
export const GATE_CTA_URL = 'https://auraimage.ai?utm_source=extension&utm_medium=gate';
export const WALL_CTA_URL = 'https://auraimage.ai?utm_source=extension&utm_medium=wall';

/** True when the next export is gated (the allowance is already spent). */
export function isGated(used: number): boolean {
  return used >= FREE_EXPORT_ALLOWANCE;
}

/** Free exports still available, never negative. */
export function remainingExports(used: number): number {
  return Math.max(0, FREE_EXPORT_ALLOWANCE - used);
}

/** The used count after recording one more export. */
export function nextUsed(used: number): number {
  return used + 1;
}

/** Read the lifetime export count, treating anything malformed as zero. */
export async function getExportsUsed(): Promise<number> {
  const stored = await chrome.storage.sync.get(EXPORTS_USED_KEY);
  const value = stored[EXPORTS_USED_KEY];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Whether the next export should be gated, per current storage. */
export async function isExportGated(): Promise<boolean> {
  return isGated(await getExportsUsed());
}

/**
 * Record a successful export and return the new used count. The read-modify-write
 * is deliberately non-atomic: two exports racing across surfaces can read the same
 * count and undercount by one. That only ever favors the user (one extra free
 * export), and this is a soft marketing gate, not a security boundary, so the
 * simplicity is worth more than a storage-level lock.
 */
export async function recordExport(): Promise<number> {
  const used = nextUsed(await getExportsUsed());
  await chrome.storage.sync.set({ [EXPORTS_USED_KEY]: used });
  return used;
}
