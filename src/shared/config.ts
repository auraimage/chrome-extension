// Edge configuration for the extension. The production CDN is the default; a
// developer can point the extension at a local or staging edge either at build
// time (WXT_EDGE_BASE in .env.development, so `wxt dev` auto-targets the local
// portless CDN) or at runtime by writing an override into browser.storage.sync.
import { browser } from 'wxt/browser';

export const DEFAULT_EDGE_BASE = 'https://cdn.auraimage.ai';

/** browser.storage.sync key that overrides {@link DEFAULT_EDGE_BASE}. */
export const EDGE_BASE_STORAGE_KEY = 'edgeBase';

/**
 * Resolve the edge base URL. Precedence: a runtime sync-storage override wins,
 * then the build-time WXT_EDGE_BASE (present in dev, absent from production
 * bundles), then the production default.
 */
export async function getEdgeBase(): Promise<string> {
  const stored = await browser.storage.sync.get(EDGE_BASE_STORAGE_KEY);
  const override = stored[EDGE_BASE_STORAGE_KEY];
  if (typeof override === 'string' && override.length > 0) return override;

  const envBase = import.meta.env.WXT_EDGE_BASE as string | undefined;
  return envBase && envBase.length > 0 ? envBase : DEFAULT_EDGE_BASE;
}
