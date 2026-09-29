import { parse } from "yaml";
import type { ConfigFile, ConfigSnapshot } from "./types";

/**
 * A lossless reading of a configuration: every file keeps its text, every
 * parsed value keeps every key, and parse problems are recorded instead of
 * thrown. Checks read this; nothing here drops or truncates.
 */

export type JsonFile = {
  file: ConfigFile;
  data?: Record<string, unknown>;
  error?: string;
};

export type MarkdownFile = {
  file: ConfigFile;
  /** Parsed frontmatter, when the file opens with a valid block. */
  frontmatter?: Record<string, unknown>;
  /** The raw frontmatter text, for line lookups. */
  frontmatterText?: string;
  body: string;
  /** The file opens with `---` on its first line. */
  opensWithFrontmatter: boolean;
  /** A `---` block appears, but not on the first line. */
  frontmatterNotOnFirstLine: boolean;
  error?: string;
};

export type ConfigModel = {
  files: ConfigFile[];
  settings: JsonFile[];
  mcp: JsonFile[];
  agents: MarkdownFile[];
  skills: MarkdownFile[];
  rules: MarkdownFile[];
  commands: MarkdownFile[];
  instructions: ConfigFile[];
  pluginName?: string;
};

function readJson(file: ConfigFile): JsonFile {
  try {
    const data: unknown = JSON.parse(file.content);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { file, error: "the top level is not a JSON object" };
    return { file, data: data as Record<string, unknown> };
  } catch (error) {
    return { file, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readMarkdown(file: ConfigFile): MarkdownFile {
  const text = file.content.replace(/\r\n/g, "\n");
  const opens = /^---\n/.test(text);
  if (!opens) {
    // A frontmatter-like block that starts after line 1 (for example after a blank line or a title).
    const lines = text.split("\n");
    const open = lines.findIndex((line) => line.trim() === "---");
    const close = open > 0 ? lines.findIndex((line, index) => index > open && line.trim() === "---") : -1;
    const looksLikeFrontmatter = close > open && lines.slice(open + 1, close).some((line) => /^name\s*:/.test(line));
    return { file, body: text, opensWithFrontmatter: false, frontmatterNotOnFirstLine: open > 0 && looksLikeFrontmatter };
  }
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { file, body: text, opensWithFrontmatter: true, frontmatterNotOnFirstLine: false, error: "the frontmatter block is not closed with ---" };
  const body = text.slice(match[0].length);
  try {
    const parsed: unknown = parse(match[1]);
    if (parsed === null || parsed === undefined) return { file, frontmatter: {}, frontmatterText: match[1], body, opensWithFrontmatter: true, frontmatterNotOnFirstLine: false };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { file, frontmatterText: match[1], body, opensWithFrontmatter: true, frontmatterNotOnFirstLine: false, error: "the frontmatter is not a set of key: value fields" };
    }
    return { file, frontmatter: parsed as Record<string, unknown>, frontmatterText: match[1], body, opensWithFrontmatter: true, frontmatterNotOnFirstLine: false };
  } catch (error) {
    return { file, frontmatterText: match[1], body, opensWithFrontmatter: true, frontmatterNotOnFirstLine: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

export function buildConfigModel(snapshot: ConfigSnapshot): ConfigModel {
  const of = (kind: ConfigFile["kind"]) => snapshot.files.filter((file) => file.kind === kind);
  return {
    files: snapshot.files,
    settings: of("settings").map(readJson),
    mcp: of("mcp").map(readJson),
    agents: of("agent").map(readMarkdown),
    skills: of("skill").map(readMarkdown),
    rules: of("rule").map(readMarkdown),
    commands: of("command").map(readMarkdown),
    instructions: of("instructions"),
    pluginName: snapshot.pluginName,
  };
}

/** 1-based line of the first frontmatter line that starts with `key:` (the file's line, counting the opening ---). */
export function frontmatterLine(markdown: MarkdownFile, key: string): number | undefined {
  if (!markdown.frontmatterText) return undefined;
  const index = markdown.frontmatterText.split("\n").findIndex((line) => line.replace(/^\s+/, "").startsWith(`${key}:`));
  return index === -1 ? undefined : index + 2;
}

/** 1-based line of the first occurrence of `needle` in a file. */
export function lineOf(file: ConfigFile, needle: string): number | undefined {
  const index = file.content.indexOf(needle);
  return index === -1 ? undefined : file.content.slice(0, index).split("\n").length;
}

export const asStringList = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return undefined;
};

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
