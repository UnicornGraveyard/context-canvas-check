/**
 * Types for checking whether a Claude Code configuration actually applies.
 * Pure data, so this module runs anywhere, including the browser. Files are
 * read elsewhere: the CLI walks the disk, and a browser reads a dropped
 * folder, applying the same location rules (project-files.ts).
 */

/** Where a file sits, which decides whether and when Claude Code reads it. */
export type ConfigScope =
  | "project" // under the directory Claude Code starts in
  | "local" // .claude/settings.local.json at the repository root
  | "user" // ~/.claude
  | "ancestor" // a parent directory of the start directory (not the home directory)
  | "plugin"; // the repository is itself a plugin (.claude-plugin/plugin.json)

export type ConfigFileKind =
  | "settings" // settings.json, settings.local.json, a plugin's hooks/hooks.json
  | "mcp" // .mcp.json
  | "agent"
  | "skill"
  | "rule"
  | "command"
  | "instructions"; // CLAUDE.md, CLAUDE.local.md, AGENTS.md

export type ConfigFile = {
  /** Display path: relative to the start directory, or ~/... for user files. */
  path: string;
  scope: ConfigScope;
  kind: ConfigFileKind;
  content: string;
  /** Instruction files only: true when the file sits in a subdirectory below the start directory. */
  nested?: boolean;
};

export type ConfigSnapshot = {
  files: ConfigFile[];
  /** Set when the start directory is a plugin; its components are namespaced under this name. */
  pluginName?: string;
};

export type ConfigSeverity = "error" | "warning" | "info";

/**
 * A mechanical fix, set only when the change is certain: line `line` of the
 * finding's file reads `before`; replace it with `after`. An empty `after`
 * deletes the line, and a multi-line `after` inserts lines after `before`.
 */
export type ConfigEdit = {
  line: number;
  before: string;
  after: string;
};

export type ConfigFinding = {
  check: string;
  severity: ConfigSeverity;
  file: string;
  line?: number;
  /** One sentence: what won't apply as written. */
  message: string;
  /** Why, in plain language. */
  detail?: string;
  fix?: string;
  /** The exact change, when the fix is mechanical. */
  edit?: ConfigEdit;
  docs: string;
  /** The public reports that motivated this check (docs/research/option-c). */
  reports: string[];
};

export type ConfigCheck = {
  id: string;
  title: string;
  /** What the check catches, in one sentence. */
  description: string;
  reports: string[];
  docs: string;
  run: (model: import("./model").ConfigModel) => ConfigFinding[];
};
