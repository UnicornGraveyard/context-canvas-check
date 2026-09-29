import { frontmatterLine, type MarkdownFile } from "./model";
import type { ConfigEdit, ConfigFile } from "./types";

/**
 * Exact line edits for fixes that are mechanical: rename a field, add the
 * missing ---, quote a value, double a slash. A fix prompt, the CLI and the
 * MCP server show them so a person or an agent doesn't have to work the change
 * out. Anything that needs a decision gets no edit, only the fix text.
 */

/** A minified file's one line isn't a readable change. */
const MAX_EDIT_LINE = 300;

/** The text of a 1-based line, without a trailing \r. */
export function lineText(file: ConfigFile, line: number): string | undefined {
  const text = file.content.split("\n")[line - 1];
  return text === undefined ? undefined : text.replace(/\r$/, "");
}

function lineEdit(file: ConfigFile, line: number | undefined, change: (before: string) => string | undefined): ConfigEdit | undefined {
  if (!line) return undefined;
  const before = lineText(file, line);
  if (before === undefined || before.length > MAX_EDIT_LINE) return undefined;
  const after = change(before);
  return after === undefined || after === before ? undefined : { line, before, after };
}

/** A tool name agents read the same in either list form: Read, mcp__github__create_issue. */
const SIMPLE_TOOL = /^[\w.*-]+$/;

/**
 * Renames a top-level frontmatter field and keeps its value. allowed-tools
 * becomes tools only when agents read the value the same way: a list, or
 * plain names (a space-separated skill list becomes comma-separated).
 */
export function renameFieldEdit(markdown: MarkdownFile, field: string, to: string): ConfigEdit | undefined {
  if (!markdown.frontmatter || to in markdown.frontmatter) return undefined;
  return lineEdit(markdown.file, frontmatterLine(markdown, field), (before) => {
    if (!before.startsWith(`${field}:`)) return undefined;
    let rest = before.slice(field.length + 1);
    const value = rest.trim();
    if (field === "allowed-tools" && value && !value.startsWith("[")) {
      const unquoted = value.replace(/^(["'])(.*)\1$/, "$2");
      const names = unquoted.includes(",") ? unquoted.split(",").map((name) => name.trim()) : unquoted.split(/\s+/);
      if (!names.every((name) => SIMPLE_TOOL.test(name))) return undefined;
      rest = ` ${names.join(", ")}`;
    }
    return `${to}:${rest}`;
  });
}

/** Sets a top-level frontmatter field to a new plain value. */
export function setFieldEdit(markdown: MarkdownFile, field: string, value: string): ConfigEdit | undefined {
  return lineEdit(markdown.file, frontmatterLine(markdown, field), (before) => (before.startsWith(`${field}:`) ? `${field}: ${value}` : undefined));
}

/** Deletes `hooks: []`, which does nothing but makes Claude Code drop the agent. */
export function removeEmptyHooksEdit(markdown: MarkdownFile): ConfigEdit | undefined {
  return lineEdit(markdown.file, frontmatterLine(markdown, "hooks"), (before) => (/^hooks:\s*\[\s*\]\s*$/.test(before) ? "" : undefined));
}

/**
 * Adds the closing --- to a frontmatter block that was never closed, after
 * the last line that reads as frontmatter: `key:`, an indented line, or a
 * list item, counted from line 2.
 */
export function closeFrontmatterEdit(file: ConfigFile): ConfigEdit | undefined {
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  let last = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_][\w-]*\s*:/.test(lines[index]) || /^\s+\S/.test(lines[index]) || /^-\s/.test(lines[index])) last = index;
    else break;
  }
  return last === 0 ? undefined : lineEdit(file, last + 1, (before) => `${before}\n---`);
}

/**
 * Quotes a `key: value` line whose value holds ": ", which YAML reads as a
 * nested mapping. The parser's message gives the line within the frontmatter.
 */
export function quoteValueEdit(markdown: MarkdownFile): ConfigEdit | undefined {
  const at = markdown.error?.match(/at line (\d+), column \d+/);
  if (!at) return undefined;
  return lineEdit(markdown.file, Number(at[1]) + 1, (before) => {
    const match = before.match(/^([A-Za-z_][\w-]*):[ \t]+(.*\S)\s*$/);
    if (!match || !/:\s/.test(match[2]) || /^["'[{|>&*!%@`]/.test(match[2])) return undefined;
    return `${match[1]}: ${JSON.stringify(match[2])}`;
  });
}

/** Rewrites Read(/Users/...) as Read(//Users/...), the absolute form. */
export function doubleSlashEdit(file: ConfigFile, line: number | undefined, rule: string, spec: string): ConfigEdit | undefined {
  const fixed = rule.replace(`(${spec}`, `(/${spec}`);
  return lineEdit(file, line, (before) => (before.split(rule).length === 2 ? before.replace(rule, fixed) : undefined));
}
