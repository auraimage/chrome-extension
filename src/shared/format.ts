// Display helpers for the ambient findings UI. Decimal (1000-based) KB/MB with
// at most one decimal place, matching the byte accounting style of the MCP
// audit tool (packages/mcp-server/src/tools/audit-lcp.ts).

/** Round to at most one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Format a byte count as B / KB / MB using decimal (1000-based) units. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const kb = bytes / 1000;
  if (kb < 1000) return `${round1(kb)} KB`;
  return `${round1(kb / 1000)} MB`;
}

/** Format a 0..1 fraction as a percentage with at most one decimal place. */
export function formatPercent(fraction: number): string {
  return `${round1(fraction * 100)}%`;
}
