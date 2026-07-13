// Copy-paste snippets offered by the overlay. Pure string builders: no DOM,
// no network. `buildPictureSnippet` mirrors the output of the MCP tool
// packages/mcp-server/src/tools/generate-responsive-tag.ts exactly (same
// <picture> grammar, srcSet formatting, and escaping) so the two stay in sync
// — the only differences are the literal {your-project} placeholder segment
// (the user has not run `aura init` yet) and the leading init comment.
import { DEFAULT_EDGE_BASE } from './config';

/** Literal project segment: the user has not created a project yet. */
const PROJECT_PLACEHOLDER = '{your-project}';
const INIT_COMMENT = '<!-- npx aura init, then upload this image to make these URLs real -->';

/** Max image URLs listed inline in the agent prompt before summarizing. */
const AGENT_URL_CAP = 50;

interface PictureSnippetOptions {
  /** Extension-less image name (ADR 0022). */
  name: string;
  widths?: number[];
  alt?: string;
  /**
   * Real project slug for an image already on our edge. When given, the URLs are
   * live so the {your-project} placeholder and the `aura init` comment are
   * dropped; when omitted, the placeholder + comment are emitted as before.
   */
  project?: string;
}

// Mirrors generate-responsive-tag.ts:escHtml verbatim.
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildPictureSnippet({
  name,
  widths = [400, 800, 1200],
  alt = '',
  project
}: PictureSnippetOptions): string {
  const lastWidth = widths[widths.length - 1];
  if (lastWidth === undefined) throw new Error('buildPictureSnippet: widths must not be empty');

  const projectSegment = project ? encodeURIComponent(project) : PROJECT_PLACEHOLDER;
  const encodedName = name.split('/').map(encodeURIComponent).join('/');
  const variant = (w: number, ext: string) => `${DEFAULT_EDGE_BASE}/${projectSegment}/w=${w}/${encodedName}${ext}`;
  const srcSet = (ext: string) => widths.map((w) => `${variant(w, ext)} ${w}w`).join(',\n      ');

  const picture = `<picture>
  <source
    type="image/avif"
    srcSet="${srcSet('.avif')}"
  />
  <source
    type="image/webp"
    srcSet="${srcSet('.webp')}"
  />
  <img
    src="${variant(lastWidth, '')}"
    alt="${escHtml(alt)}"
    width={${lastWidth}}
    loading="lazy"
  />
</picture>`;

  return project ? picture : `${INIT_COMMENT}\n${picture}`;
}

/**
 * A copy-paste prompt that tells an AI agent to migrate a page's images to the
 * user's AuraImage project. Lists up to {@link AGENT_URL_CAP} URLs, then notes
 * how many more were omitted.
 */
export function buildAgentPrompt(pageUrl: string, imageUrls: string[]): string {
  const shown = imageUrls.slice(0, AGENT_URL_CAP);
  const remaining = imageUrls.length - shown.length;
  const lines = [
    '/install-auraimage',
    `Migrate these images from ${pageUrl} to my AuraImage project and rewrite the tags:`,
    ...shown.map((u) => `- ${u}`)
  ];
  if (remaining > 0) lines.push(`+${remaining} more`);
  return lines.join('\n');
}
