import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CONFIG_WALK, type ConfigFile, type ConfigSnapshot } from "@context-canvas/core/config/index";

/**
 * Finds the files Claude Code would read for a session started in `cwd`,
 * following the documented locations:
 * - .claude/settings.json, agents, skills, rules and commands from the start folder;
 * - .claude/settings.local.json from the repository root;
 * - CLAUDE.md files below the start folder (loaded on demand);
 * - .claude/settings.json in parent folders (never loaded; reported);
 * - ~/.claude for user scope, unless disabled;
 * - a plugin layout when the start folder has .claude-plugin/plugin.json.
 * Core's snapshotFromProjectFiles applies the same rules to files a browser
 * has read; __tests__/parity.test.ts checks that both find the same files.
 */

export type DiscoverOptions = { cwd: string; home?: string; includeUser?: boolean };
export type Discovery = { snapshot: ConfigSnapshot; startDir: string; repoRoot: string; userScope: boolean };

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function read(path: string): string | undefined {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > CONFIG_WALK.maxFileBytes) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** A folder's entries; none when it is missing, unreadable, or a file where a folder belongs. */
function list(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function markdownFiles(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  for (const entry of list(dir).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...markdownFiles(path, true));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

function skillFiles(dir: string): string[] {
  return list(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, "SKILL.md"))
    .filter((path) => existsSync(path))
    .sort();
}

/** CLAUDE.md and CLAUDE.local.md files in subfolders of the start folder. */
function nestedInstructions(startDir: string): string[] {
  const found: string[] = [];
  const queue = [startDir];
  let visited = 0;
  while (queue.length > 0 && visited < CONFIG_WALK.maxDirs) {
    const dir = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !CONFIG_WALK.skipDirs.has(entry.name)) queue.push(join(dir, entry.name));
      } else if (dir !== startDir && (entry.name === "CLAUDE.md" || entry.name === "CLAUDE.local.md")) {
        found.push(join(dir, entry.name));
      }
    }
  }
  return found;
}

export function discover(options: DiscoverOptions): Discovery {
  const startDir = resolve(options.cwd);
  const home = resolve(options.home ?? homedir());
  const repoRoot = findRepoRoot(startDir);
  const userScope = (options.includeUser ?? true) && startDir !== home;
  const files: ConfigFile[] = [];
  const seen = new Set<string>();

  const display = (path: string) => {
    if (path === startDir || path.startsWith(startDir + sep)) return relative(startDir, path).split(sep).join("/");
    if (path.startsWith(home + sep)) return `~/${relative(home, path).split(sep).join("/")}`;
    return relative(startDir, path).split(sep).join("/");
  };
  const add = (path: string, kind: ConfigFile["kind"], scope: ConfigFile["scope"], nested?: boolean) => {
    if (seen.has(path)) return;
    const content = read(path);
    if (content === undefined) return;
    seen.add(path);
    files.push({ path: display(path), kind, scope, content, ...(nested ? { nested: true } : {}) });
  };

  // Project scope, from the start folder.
  add(join(startDir, ".claude", "settings.json"), "settings", "project");
  add(join(repoRoot, ".claude", "settings.local.json"), "settings", "local");
  add(join(startDir, ".mcp.json"), "mcp", "project");
  for (const path of markdownFiles(join(startDir, ".claude", "agents"), true)) add(path, "agent", "project");
  for (const path of skillFiles(join(startDir, ".claude", "skills"))) add(path, "skill", "project");
  for (const path of markdownFiles(join(startDir, ".claude", "rules"), true)) add(path, "rule", "project");
  for (const path of markdownFiles(join(startDir, ".claude", "commands"), true)) add(path, "command", "project");
  for (const name of ["CLAUDE.md", "CLAUDE.local.md", join(".claude", "CLAUDE.md"), "AGENTS.md"]) add(join(startDir, name), "instructions", "project");
  for (const path of nestedInstructions(startDir)) add(path, "instructions", "project", true);

  // Project settings in parent folders, up to (not including) the home folder.
  for (let dir = dirname(startDir); dir !== dirname(dir) && dir !== home; dir = dirname(dir)) {
    add(join(dir, ".claude", "settings.json"), "settings", "ancestor");
  }

  // A plugin layout at the start folder.
  let pluginName: string | undefined;
  const manifest = read(join(startDir, ".claude-plugin", "plugin.json"));
  if (manifest !== undefined) {
    try {
      const name = (JSON.parse(manifest) as { name?: unknown }).name;
      if (typeof name === "string") pluginName = name;
    } catch {
      // An invalid manifest is `claude plugin validate`'s job to report.
    }
    for (const path of markdownFiles(join(startDir, "agents"), true)) add(path, "agent", "plugin");
    for (const path of skillFiles(join(startDir, "skills"))) add(path, "skill", "plugin");
    for (const path of markdownFiles(join(startDir, "commands"), true)) add(path, "command", "plugin");
    add(join(startDir, "hooks", "hooks.json"), "settings", "plugin");
  }

  // User scope.
  if (userScope) {
    add(join(home, ".claude", "settings.json"), "settings", "user");
    for (const path of markdownFiles(join(home, ".claude", "agents"), true)) add(path, "agent", "user");
    for (const path of skillFiles(join(home, ".claude", "skills"))) add(path, "skill", "user");
    add(join(home, ".claude", "CLAUDE.md"), "instructions", "user");
  }

  return { snapshot: { files, ...(pluginName ? { pluginName } : {}) }, startDir, repoRoot, userScope };
}
