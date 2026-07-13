// Layout constants and line math for the 1200x630 "download PNG" share card.
// Pure: returns rgb() color strings, css font shorthands, and positioned text
// rows. The popup does the actual 2D drawing from these rows. Colors are rgb
// equivalents of the DESIGN.md hue-260 dark neutrals (never #000/#fff), because
// canvas fillStyle cannot be trusted to parse oklch() on every target.
import type { FindingsCardModel } from './findings-model';

export type CardRole = 'eyebrow' | 'title' | 'stat' | 'statMuted' | 'flags' | 'cdn' | 'footer';

export interface CardRow {
  text: string;
  x: number;
  y: number;
  role: CardRole;
  align: 'left' | 'right';
}

// Dark monochrome share card. rgb() approximations of hue-260 neutrals:
// bg oklch(0.14), card oklch(0.17), fg oklch(0.95), muted oklch(0.65),
// border oklch(0.28). None is pure black or white.
export const CARD_CANVAS = {
  width: 1200,
  height: 630,
  padX: 80,
  padY: 76,
  eyebrowGap: 22,
  titleGap: 78,
  sectionGap: 92,
  lineGap: 58,
  // Footer pinned at y=590 (offset 40 within the 630 canvas). Lower than the old
  // y=570 so the maximal card (4 stat lines + CDN row, last baseline ~558) keeps
  // clear separation from the footer instead of colliding with it.
  footerOffset: 40,
  radius: 24,
  color: {
    bg: 'rgb(21, 21, 26)',
    card: 'rgb(28, 28, 34)',
    fg: 'rgb(238, 238, 242)',
    muted: 'rgb(150, 150, 161)',
    border: 'rgb(58, 58, 66)'
  },
  font: {
    eyebrow: "500 22px ui-monospace, 'SFMono-Regular', Menlo, monospace",
    title: "600 54px system-ui, 'Onest', 'Inter', sans-serif",
    stat: "500 34px system-ui, 'Onest', 'Inter', sans-serif",
    statMuted: "400 26px ui-monospace, 'SFMono-Regular', Menlo, monospace",
    flags: "400 26px ui-monospace, 'SFMono-Regular', Menlo, monospace",
    footer: "500 22px ui-monospace, 'SFMono-Regular', Menlo, monospace"
  }
} as const;

/** Font shorthand for a given text role. */
export function fontFor(role: CardRole): string {
  const f = CARD_CANVAS.font;
  switch (role) {
    case 'eyebrow':
      return f.eyebrow;
    case 'title':
      return f.title;
    case 'stat':
      return f.stat;
    case 'statMuted':
      return f.statMuted;
    case 'flags':
      return f.flags;
    case 'cdn':
      return f.statMuted;
    case 'footer':
      return f.footer;
  }
}

/** Fill color for a given text role. */
export function colorFor(role: CardRole): string {
  const c = CARD_CANVAS.color;
  if (role === 'eyebrow' || role === 'statMuted' || role === 'cdn' || role === 'footer') return c.muted;
  return c.fg;
}

/** Nth baseline in a stack of evenly spaced lines starting at `startY`. */
export function stackY(startY: number, gap: number, index: number): number {
  return startY + gap * index;
}

/** Compact one-line flag summary joined with middots (never em dashes). */
export function flagsSummary(model: FindingsCardModel): string {
  return model.flags.map((flag) => `${flag.label} ${flag.count}`).join('  ·  ');
}

/**
 * Compute the positioned text rows for the share card. Rows stack vertically
 * within the canvas bounds; the footer is pinned to the bottom edge.
 */
export function layoutCard(model: FindingsCardModel): CardRow[] {
  const { padX, padY, eyebrowGap, titleGap, sectionGap, lineGap, height, width, footerOffset } = CARD_CANVAS;
  const rows: CardRow[] = [];

  const eyebrowY = padY + eyebrowGap;
  rows.push({ text: 'aura x-ray', x: padX, y: eyebrowY, role: 'eyebrow', align: 'left' });

  const titleY = eyebrowY + titleGap;
  rows.push({ text: model.hostname, x: padX, y: titleY, role: 'title', align: 'left' });

  // Primary stats and estimates stack below the title.
  const statLines: Array<{ text: string; role: CardRole }> = [
    { text: `${model.imageCount} images,  ${model.totalBytesText} total`, role: 'stat' },
    { text: `${model.wastefulBytesText} wasteful (est)`, role: 'stat' }
  ];
  if (model.estLcpSavingText) {
    statLines.push({ text: `est. LCP saving ${model.estLcpSavingText}`, role: 'statMuted' });
  }
  if (model.lcpImageName) {
    statLines.push({ text: `LCP image: ${model.lcpImageName}`, role: 'statMuted' });
  }

  const statsStartY = titleY + sectionGap;
  statLines.forEach((line, i) => {
    rows.push({ text: line.text, x: padX, y: stackY(statsStartY, lineGap, i), role: line.role, align: 'left' });
  });

  // Flags summary sits one line below the stats block.
  const flagsY = stackY(statsStartY, lineGap, statLines.length);
  rows.push({ text: flagsSummary(model), x: padX, y: flagsY, role: 'flags', align: 'left' });

  if (model.cdnName) {
    rows.push({
      text: `served via ${model.cdnName}. AuraImage would ship it smaller.`,
      x: padX,
      y: flagsY + lineGap,
      role: 'cdn',
      align: 'left'
    });
  }

  const footerY = height - footerOffset;
  rows.push({ text: 'measured, not scored', x: padX, y: footerY, role: 'footer', align: 'left' });
  rows.push({ text: 'auraimage.ai', x: width - padX, y: footerY, role: 'footer', align: 'right' });

  return rows;
}
