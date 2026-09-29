/** Collapses whitespace and truncates to `max` characters with "...". */
export function compactText(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

/** The first non-empty line, compacted. */
export function firstLine(value: string): string {
  for (const line of value.replace(/\r\n/g, "\n").split("\n")) {
    const cleaned = compactText(line);
    if (cleaned) return cleaned;
  }
  return "";
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})(\s.*)$/;

/**
 * Re-levels embedded markdown so its shallowest ATX heading sits one level
 * below `parentLevel`, keeping relative structure (capped at h6). Fenced code
 * blocks are left alone.
 */
export function nestHeadings(markdown: string, parentLevel: number): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let shallowest = 7;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence) shallowest = Math.min(shallowest, line.match(HEADING)?.[1].length ?? 7);
  }
  const shift = shallowest === 7 ? 0 : Math.max(0, parentLevel + 1 - shallowest);
  if (shift === 0) return markdown;

  inFence = false;
  return lines
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      const match = inFence ? null : line.match(HEADING);
      return match ? "#".repeat(Math.min(6, match[1].length + shift)) + match[2] : line;
    })
    .join("\n");
}
