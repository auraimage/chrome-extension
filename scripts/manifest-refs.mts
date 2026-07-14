// Collect every file path a Chrome MV3 manifest references, so packaging can
// confirm each one landed in dist/. Walk the manifest rather than hardcoding the
// list: the referenced set changes as the extension grows, and the manifest is
// the single source of truth for what ships.

/** The subset of an MV3 manifest that references bundled files. */
export interface ManifestRefsSource {
  background?: { service_worker?: string };
  content_scripts?: { js?: string[] }[];
  action?: { default_popup?: string };
  options_page?: string;
  icons?: Record<string, string>;
}

export function collectManifestRefs(manifest: ManifestRefsSource): string[] {
  const refs: string[] = [];

  const serviceWorker = manifest.background?.service_worker;
  if (serviceWorker) refs.push(serviceWorker);

  for (const script of manifest.content_scripts ?? []) {
    for (const js of script.js ?? []) refs.push(js);
  }

  if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
  if (manifest.options_page) refs.push(manifest.options_page);

  for (const icon of Object.values(manifest.icons ?? {})) refs.push(icon);

  return refs;
}
