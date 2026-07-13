import { buildAgentPrompt, buildPictureSnippet } from '../shared/snippet';
import { describe, expect, it } from 'vitest';

describe('buildPictureSnippet — golden output', () => {
  it('mirrors generate-responsive-tag with the {your-project} placeholder and init comment', () => {
    const snippet = buildPictureSnippet({
      name: 'photos/hero',
      widths: [400, 800, 1200],
      alt: 'Tom & "Jerry" <3'
    });
    const expected = `<!-- npx aura init, then upload this image to make these URLs real -->
<picture>
  <source
    type="image/avif"
    srcSet="https://cdn.auraimage.ai/{your-project}/w=400/photos/hero.avif 400w,
      https://cdn.auraimage.ai/{your-project}/w=800/photos/hero.avif 800w,
      https://cdn.auraimage.ai/{your-project}/w=1200/photos/hero.avif 1200w"
  />
  <source
    type="image/webp"
    srcSet="https://cdn.auraimage.ai/{your-project}/w=400/photos/hero.webp 400w,
      https://cdn.auraimage.ai/{your-project}/w=800/photos/hero.webp 800w,
      https://cdn.auraimage.ai/{your-project}/w=1200/photos/hero.webp 1200w"
  />
  <img
    src="https://cdn.auraimage.ai/{your-project}/w=1200/photos/hero"
    alt="Tom &amp; &quot;Jerry&quot; &lt;3"
    width={1200}
    loading="lazy"
  />
</picture>`;
    expect(snippet).toBe(expected);
  });

  it('starts with the init comment on its own first line', () => {
    const [firstLine] = buildPictureSnippet({ name: 'hero' }).split('\n');
    expect(firstLine).toBe('<!-- npx aura init, then upload this image to make these URLs real -->');
  });

  it('defaults widths to [400, 800, 1200]', () => {
    const snippet = buildPictureSnippet({ name: 'hero' });
    expect(snippet).toContain('w=400/hero.avif 400w');
    expect(snippet).toContain('w=800/hero.avif 800w');
    expect(snippet).toContain('w=1200/hero.avif 1200w');
    expect(snippet).toContain('width={1200}');
  });

  it('honors a custom widths list and picks the largest for the fallback img', () => {
    const snippet = buildPictureSnippet({ name: 'hero', widths: [320, 640] });
    expect(snippet).toContain('src="https://cdn.auraimage.ai/{your-project}/w=640/hero"');
    expect(snippet).toContain('width={640}');
    expect(snippet).not.toContain('1200');
  });

  it('defaults alt to an empty string', () => {
    expect(buildPictureSnippet({ name: 'hero' })).toContain('alt=""');
  });

  it('url-encodes each path segment of the name', () => {
    const snippet = buildPictureSnippet({ name: 'my folder/hero image' });
    expect(snippet).toContain('/my%20folder/hero%20image.avif');
  });

  it('contains no em dash', () => {
    expect(buildPictureSnippet({ name: 'hero' })).not.toContain('—');
  });

  it('uses a real project segment and drops the init comment when project is given', () => {
    const snippet = buildPictureSnippet({ name: 'photos/hero', project: 'acme', widths: [400] });
    expect(snippet).not.toContain('{your-project}');
    expect(snippet).not.toContain('npx aura init');
    expect(snippet.startsWith('<picture>')).toBe(true);
    expect(snippet).toContain('https://cdn.auraimage.ai/acme/w=400/photos/hero.avif 400w');
    expect(snippet).toContain('src="https://cdn.auraimage.ai/acme/w=400/photos/hero"');
  });

  it('url-encodes a project slug', () => {
    const snippet = buildPictureSnippet({ name: 'hero', project: 'my team' });
    expect(snippet).toContain('/my%20team/');
  });
});

describe('buildAgentPrompt', () => {
  it('opens with the /install-auraimage command and the migrate sentence', () => {
    const prompt = buildAgentPrompt('https://example.com/gallery', ['https://x.test/a.jpg']);
    const lines = prompt.split('\n');
    expect(lines[0]).toBe('/install-auraimage');
    expect(lines[1]).toBe(
      'Migrate these images from https://example.com/gallery to my AuraImage project and rewrite the tags:'
    );
    expect(lines[2]).toBe('- https://x.test/a.jpg');
  });

  it('caps the URL list at 50 and notes the remainder', () => {
    const urls = Array.from({ length: 60 }, (_, i) => `https://x.test/${i}.jpg`);
    const prompt = buildAgentPrompt('https://example.com', urls);
    const bulletLines = prompt.split('\n').filter((l) => l.startsWith('- '));
    expect(bulletLines).toHaveLength(50);
    expect(bulletLines[49]).toBe('- https://x.test/49.jpg');
    expect(prompt).toContain('+10 more');
  });

  it('does not add a remainder note at exactly 50 URLs', () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://x.test/${i}.jpg`);
    const prompt = buildAgentPrompt('https://example.com', urls);
    expect(prompt.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(50);
    expect(prompt).not.toContain('more');
  });

  it('contains no em dash', () => {
    const prompt = buildAgentPrompt('https://example.com', ['https://x.test/a.jpg']);
    expect(prompt).not.toContain('—');
  });
});
