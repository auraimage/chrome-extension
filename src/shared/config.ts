// Edge configuration for the extension. The production CDN is the default; a
// developer can point the extension at a local or staging edge by writing the
// override into chrome.storage.sync.

export const DEFAULT_EDGE_BASE = 'https://cdn.auraimage.ai';

/** chrome.storage.sync key that overrides {@link DEFAULT_EDGE_BASE}. */
export const EDGE_BASE_STORAGE_KEY = 'edgeBase';

/** Resolve the edge base URL, honoring the sync-storage override when present. */
export async function getEdgeBase(): Promise<string> {
  const stored = await chrome.storage.sync.get(EDGE_BASE_STORAGE_KEY);
  const override = stored[EDGE_BASE_STORAGE_KEY];
  return typeof override === 'string' && override.length > 0 ? override : DEFAULT_EDGE_BASE;
}
