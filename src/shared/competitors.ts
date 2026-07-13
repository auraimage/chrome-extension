// Detect the image CDN / optimizer serving a URL, purely from its shape. No
// network calls: callers pass a plain URL string. Used by the overlay to frame
// the "you already use an image CDN, here is what AuraImage does differently"
// message and to recognize images already on our own edge.

export type CdnVendorId = 'cloudinary' | 'imgix' | 'cloudflare' | 'imagekit' | 'bunny' | 'vercel' | 'auraimage';

export interface CdnVendor {
  id: CdnVendorId;
  /** Human-readable name for the overlay. */
  name: string;
}

interface Matcher {
  vendor: CdnVendor;
  /** True when the URL's host or path identifies this vendor. */
  test: (host: string, path: string) => boolean;
}

// First matching entry wins. Host checks use exact/suffix matches (never bare
// `includes`) so look-alike hosts such as `notimgix.net.evil.com` do not match.
const MATCHERS: Matcher[] = [
  {
    vendor: { id: 'cloudinary', name: 'Cloudinary' },
    test: (host, path) => host === 'res.cloudinary.com' || path.includes('/image/upload/')
  },
  {
    vendor: { id: 'imgix', name: 'imgix' },
    test: (host) => host.endsWith('.imgix.net')
  },
  {
    vendor: { id: 'cloudflare', name: 'Cloudflare Images' },
    test: (host, path) => host === 'imagedelivery.net' || path.includes('/cdn-cgi/image/')
  },
  {
    vendor: { id: 'imagekit', name: 'ImageKit' },
    test: (host) => host === 'ik.imagekit.io'
  },
  {
    vendor: { id: 'bunny', name: 'Bunny' },
    test: (host) => host.endsWith('.b-cdn.net')
  },
  {
    vendor: { id: 'vercel', name: 'Next/Vercel' },
    test: (_host, path) => path.includes('/_next/image')
  },
  {
    vendor: { id: 'auraimage', name: 'AuraImage' },
    test: (host) => host === 'cdn.auraimage.ai'
  }
];

/** Split a URL into a lowercased host and a path for matching. Relative URLs
 *  (no host) fall back to matching the raw string as the path. */
function parse(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), path: u.pathname };
  } catch {
    return { host: '', path: url };
  }
}

/** Identify the CDN serving `url`, or null if none is recognized. */
export function detectCdn(url: string): CdnVendor | null {
  const { host, path } = parse(url);
  for (const { vendor, test } of MATCHERS) {
    if (test(host, path)) return vendor;
  }
  return null;
}
