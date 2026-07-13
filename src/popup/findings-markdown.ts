// Pure markdown builder for the popup's "copy markdown" action. Renders the
// same view-model the card and PNG use. No em dashes (DESIGN.md copy rule); the
// footer link is always included.
import type { FindingsCardModel } from './findings-model';

const FOOTER_TAGLINE = 'measured, not scored';
const FOOTER_LINK = 'https://auraimage.com';

export function buildFindingsMarkdown(model: FindingsCardModel): string {
  const lines: string[] = [`## AuraImage X-Ray: ${model.hostname}`, ''];

  lines.push(`- images: ${model.imageCount}`);
  lines.push(`- total bytes: ${model.totalBytesText}`);
  lines.push(`- wasteful bytes (est): ${model.wastefulBytesText}`);
  if (model.estLcpSavingText) lines.push(`- est. LCP saving: ${model.estLcpSavingText}`);
  if (model.lcpImageName) lines.push(`- LCP image: ${model.lcpImageName}`);

  lines.push('', 'Flags');
  for (const flag of model.flags) lines.push(`- ${flag.label}: ${flag.count}`);

  if (model.cdnName) {
    lines.push('', `Served via ${model.cdnName}. AuraImage would ship it smaller, try it below.`);
  }

  lines.push('', `${FOOTER_TAGLINE}. ${FOOTER_LINK}`);
  return lines.join('\n');
}
