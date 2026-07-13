// Parse an AuraImage-hosted serve URL back into its project and image name so the
// popup can offer a real <picture> snippet (not the {your-project} placeholder)
// for images already on our edge.
//
// Serve-URL grammar (ADR 0022): /{project}/{transform?}/{name}[.{ext}]
// The transform segment is a single optional path segment immediately after the
// project; it is the only segment that may contain '=' or ',' (image names never
// can), which is what makes the grammar unambiguous.

const AURA_HOST = 'cdn.auraimage.ai';

// Mirrors apps/cdn/src/lib/serve-path.ts: extensions we recognize and strip so
// the returned name is the canonical extension-less form.
const KNOWN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp']);

export interface AuraImageRef {
  project: string;
  /** Extension-less image name (may contain slashes). */
  name: string;
}

function looksLikeTransform(segment: string): boolean {
  return segment.includes('=') || segment.includes(',');
}

function stripKnownExtension(name: string): string {
  const match = name.match(/\.([A-Za-z0-9]+)$/);
  if (!match) return name;
  const ext = match[1]!.toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? name.slice(0, -(ext.length + 1)) : name;
}

/**
 * Parse an AuraImage serve URL into {project, name}, or null when the URL is not
 * on our edge or does not match the grammar (e.g. a bare `/{project}` with no
 * image name, or a name segment carrying transform syntax).
 */
export function parseAuraImageUrl(rawUrl: string): AuraImageRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== AURA_HOST) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null; // need at least project + name

  const [projectSegment, ...rest] = segments;
  let nameSegments = rest;
  if (rest.length > 0 && looksLikeTransform(rest[0]!)) {
    nameSegments = rest.slice(1);
  }
  if (nameSegments.length === 0) return null;
  // A transform-shaped segment anywhere in the name is invalid per the grammar.
  if (nameSegments.some(looksLikeTransform)) return null;

  const decodedName = nameSegments.map((s) => decodeURIComponent(s)).join('/');
  const name = stripKnownExtension(decodedName);
  if (!name) return null;

  return { project: decodeURIComponent(projectSegment!), name };
}
