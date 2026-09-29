import { parse, stringify } from "yaml";

/**
 * A YAML frontmatter block. Values are quoted and escaped as YAML requires, so
 * text such as "Note: do X" or a leading backtick stays valid. Undefined
 * values and empty arrays are omitted.
 */
export function toFrontmatter(data: Record<string, unknown>): string {
  const entries = Object.entries(data).filter(
    ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)
  );
  const body = stringify(Object.fromEntries(entries), { lineWidth: 0 }).trimEnd();
  return `---\n${body}\n---`;
}

/**
 * Parses a leading YAML frontmatter block. Returns null when the file has no
 * frontmatter; throws when the block is not valid YAML.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;
  const parsed: unknown = parse(match[1]);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
