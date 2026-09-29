import type { ConfigFile, ConfigSnapshot } from "./types";

/**
 * Which files Claude Code reads for a session, worked out from files already
 * read: the rules of the CLI's disk walk (packages/cli/src/discover.ts) for a
 * browser that reads a dropped folder. packages/cli parity.test.ts checks that
 * both give the same snapshot on real folders.
 *
 * The dropped folder is the top of the world. Where that makes this differ
 * from discover():
 * - Folders above the dropped folder aren't seen: discover() looks there for
 *   the git root (and its .claude/settings.local.json) and for parent-folder
 *   .claude/settings.json files. `notEvaluated` says so.
 * - A dropped home folder: discover() reads ~/.claude/settings.json as user
 *   settings, never as a parent folder's. Drop ~/.claude with rootScope "user".
 * - Letter case: on a case-insensitive disk (the macOS and Windows default),
 *   discover()'s direct lookups (CLAUDE.md, SKILL.md, .claude/settings.json)
 *   also find claude.md or skill.md. Names match exactly here.
 * - The nested CLAUDE.md search stops after CONFIG_WALK.maxDirs folders. Here
 *   only folders that lead to a listed file count toward that limit.
 * - Both sort with localeCompare, which follows the runtime's default locale,
 *   so a browser set to another locale can list some names in another order.
 */

/** Limits shared by the CLI's walk and a browser's. */
export const CONFIG_WALK: { readonly skipDirs: ReadonlySet<string>; readonly maxDirs: number; readonly maxFileBytes: number } = {
  /** Folders never searched for nested CLAUDE.md files (dot-folders aren't either). */
  skipDirs: new Set(["node_modules", "dist", "build", "out", "target", "vendor", "coverage", "venv", "__pycache__"]),
  /** The nested CLAUDE.md search visits at most this many folders. */
  maxDirs: 5000,
  /** Larger files aren't read. */
  maxFileBytes: 1024 * 1024,
};

/** A file from the dropped folder: `path` is relative to it, "/"-separated, with no leading "./". */
export type ProjectFile = { path: string; content: string };

export type ProjectFilesOptions = {
  /** The folder a session starts in, relative to the dropped folder. Default "": the dropped folder. */
  startDir?: string;
  /** Folders that hold a `.git` file or folder ("" is the dropped folder). */
  gitDirs?: string[];
  /** "user" when the dropped folder is ~/.claude itself. Then startDir and gitDirs don't apply. */
  rootScope?: "project" | "user";
};

export type ProjectFilesResult = {
  snapshot: ConfigSnapshot;
  /** Where .claude/settings.local.json is read from: the nearest gitDir at or above startDir, else startDir. */
  repoRoot: string;
  /** Folders with a .claude folder or .claude-plugin/plugin.json, shallowest first. */
  startDirOptions: string[];
  /** "" when the dropped folder is an option, else the only option, else "". */
  suggestedStartDir: string;
  /** What Claude Code may also read that this can't see, for people to check themselves. */
  notEvaluated: string[];
};

type Folder = { folders: Map<string, Folder>; files: Set<string> };

const CLAUDE_COMPONENTS = new Set(["agents", "skills", "rules", "commands"]);
const INSTRUCTIONS = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]);

/** "./a//b/" becomes "a/b". */
const clean = (path: string) => path.split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
const join = (...parts: string[]) => parts.filter(Boolean).join("/");
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** A file path relative to a folder, like path.relative: "../../.claude/settings.json". */
function relativeTo(from: string, to: string): string {
  const base = from ? from.split("/") : [];
  const target = to.split("/");
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) shared += 1;
  return [...base.slice(shared).map(() => ".."), ...target.slice(shared)].join("/");
}

function readTree(files: ProjectFile[]): { root: Folder; contents: Map<string, string> } {
  const root: Folder = { folders: new Map(), files: new Set() };
  const contents = new Map<string, string>();
  for (const file of files) {
    const path = clean(file.path);
    if (!path || contents.has(path)) continue;
    contents.set(path, file.content);
    const segments = path.split("/");
    const name = segments.pop()!;
    let folder = root;
    for (const segment of segments) {
      let next = folder.folders.get(segment);
      if (!next) folder.folders.set(segment, (next = { folders: new Map(), files: new Set() }));
      folder = next;
    }
    folder.files.add(name);
  }
  return { root, contents };
}

function folderAt(root: Folder, path: string): Folder | undefined {
  let folder: Folder | undefined = root;
  for (const segment of path ? path.split("/") : []) folder = folder?.folders.get(segment);
  return folder;
}

/** A folder's entries in the order discover() reads them. */
const entries = (folder: Folder) => [...new Set([...folder.folders.keys(), ...folder.files])].sort((a, b) => a.localeCompare(b));

/** Every .md file below `dir`, depth first. */
function markdownFiles(root: Folder, dir: string): string[] {
  const out: string[] = [];
  const visit = (folder: Folder, path: string) => {
    for (const name of entries(folder)) {
      const child = folder.folders.get(name);
      if (child) visit(child, join(path, name));
      else if (name.endsWith(".md")) out.push(join(path, name));
    }
  };
  const start = folderAt(root, dir);
  if (start) visit(start, dir);
  return out;
}

/** `<dir>/<name>/SKILL.md` for each subfolder that has one, sorted as plain strings (not with localeCompare), as discover() does. */
function skillFiles(root: Folder, dir: string): string[] {
  const folder = folderAt(root, dir);
  if (!folder) return [];
  return [...folder.folders]
    .filter(([, child]) => child.files.has("SKILL.md"))
    .map(([name]) => join(dir, name, "SKILL.md"))
    .sort();
}

/** CLAUDE.md and CLAUDE.local.md in folders below `start`, breadth first. */
function nestedInstructions(root: Folder, start: string): string[] {
  const first = folderAt(root, start);
  if (!first) return [];
  const found: string[] = [];
  const queue: [string, Folder][] = [[start, first]];
  for (let next = 0; next < queue.length && next < CONFIG_WALK.maxDirs; next += 1) {
    const [path, folder] = queue[next];
    for (const name of entries(folder)) {
      const child = folder.folders.get(name);
      if (child) {
        if (!name.startsWith(".") && !CONFIG_WALK.skipDirs.has(name)) queue.push([join(path, name), child]);
      } else if (next > 0 && (name === "CLAUDE.md" || name === "CLAUDE.local.md")) {
        found.push(join(path, name));
      }
    }
  }
  return found;
}

/** Folders a walk reaches without passing a dot-folder or a skipped folder. */
const walkable = (folder: string) => !folder || folder.split("/").every((segment) => !segment.startsWith(".") && !CONFIG_WALK.skipDirs.has(segment));

function startFolders(paths: Iterable<string>): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    const claude = segments.indexOf(".claude");
    if (claude !== -1 && claude < segments.length - 1) folders.add(segments.slice(0, claude).join("/"));
    if (segments.length >= 2 && segments[segments.length - 2] === ".claude-plugin" && segments[segments.length - 1] === "plugin.json") {
      folders.add(segments.slice(0, -2).join("/"));
    }
  }
  const depth = (folder: string) => (folder ? folder.split("/").length : 0);
  return [...folders].filter(walkable).sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The files Claude Code reads for a session started in `startDir`, as
 * discover() finds them on disk, in the same order and with the same display
 * paths (relative to startDir, "../.." for files above it):
 * - startDir/.claude/settings.json (project), repoRoot/.claude/settings.local.json (local), startDir/.mcp.json;
 * - every .md file below startDir/.claude/agents, then .claude/skills/<name>/SKILL.md, then every .md file below .claude/rules and .claude/commands;
 * - CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md and AGENTS.md, then CLAUDE.md files in subfolders (nested);
 * - .claude/settings.json in each folder above startDir, nearest first, up to the dropped folder (ancestor);
 * - with startDir/.claude-plugin/plugin.json, the plugin's agents/, skills/, commands/ and hooks/hooks.json.
 * With rootScope "user", the dropped folder is ~/.claude: settings.json, agents/, skills/ and CLAUDE.md,
 * shown as ~/.claude/... To check both, append the user files to the project's, as the CLI does.
 * Callers skip files over CONFIG_WALK.maxFileBytes; the first of two files with the same path wins.
 */
export function snapshotFromProjectFiles(files: ProjectFile[], options: ProjectFilesOptions = {}): ProjectFilesResult {
  const { root, contents } = readTree(files);
  const found: ConfigFile[] = [];
  const seen = new Set<string>();
  const adder = (display: (path: string) => string) => (path: string, kind: ConfigFile["kind"], scope: ConfigFile["scope"], nested?: boolean) => {
    const content = contents.get(path);
    if (content === undefined || seen.has(path)) return;
    seen.add(path);
    found.push({ path: display(path), kind, scope, content, ...(nested ? { nested: true } : {}) });
  };
  const outside = ["Managed settings set by an administrator", "Command-line flags", "Plugins installed from a marketplace"];

  if (options.rootScope === "user") {
    const add = adder((path) => `~/.claude/${path}`);
    add("settings.json", "settings", "user");
    for (const path of markdownFiles(root, "agents")) add(path, "agent", "user");
    for (const path of skillFiles(root, "skills")) add(path, "skill", "user");
    add("CLAUDE.md", "instructions", "user");
    return {
      snapshot: { files: found },
      repoRoot: "",
      startDirOptions: [],
      suggestedStartDir: "",
      notEvaluated: ["Project files: .claude/, .mcp.json and CLAUDE.md in the folder a session starts in", ...outside],
    };
  }

  const startDir = clean(options.startDir ?? "");
  const gitDirs = new Set((options.gitDirs ?? []).map(clean));
  let repoRoot = startDir;
  for (let dir = startDir; ; dir = parentOf(dir)) {
    if (gitDirs.has(dir)) {
      repoRoot = dir;
      break;
    }
    if (dir === "") break;
  }
  const add = adder((path) => relativeTo(startDir, path));
  const at = (path: string) => join(startDir, path);

  // Project scope, from the start folder.
  add(at(".claude/settings.json"), "settings", "project");
  add(join(repoRoot, ".claude/settings.local.json"), "settings", "local");
  add(at(".mcp.json"), "mcp", "project");
  for (const path of markdownFiles(root, at(".claude/agents"))) add(path, "agent", "project");
  for (const path of skillFiles(root, at(".claude/skills"))) add(path, "skill", "project");
  for (const path of markdownFiles(root, at(".claude/rules"))) add(path, "rule", "project");
  for (const path of markdownFiles(root, at(".claude/commands"))) add(path, "command", "project");
  for (const name of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md"]) add(at(name), "instructions", "project");
  for (const path of nestedInstructions(root, startDir)) add(path, "instructions", "project", true);

  // Project settings in parent folders, nearest first, up to the dropped folder.
  for (let dir = startDir; dir !== ""; ) {
    dir = parentOf(dir);
    add(join(dir, ".claude/settings.json"), "settings", "ancestor");
  }

  // A plugin layout at the start folder.
  let pluginName: string | undefined;
  const manifest = contents.get(at(".claude-plugin/plugin.json"));
  if (manifest !== undefined) {
    try {
      const name = (JSON.parse(manifest) as { name?: unknown }).name;
      if (typeof name === "string") pluginName = name;
    } catch {
      // An invalid manifest is `claude plugin validate`'s job to report.
    }
    for (const path of markdownFiles(root, at("agents"))) add(path, "agent", "plugin");
    for (const path of skillFiles(root, at("skills"))) add(path, "skill", "plugin");
    for (const path of markdownFiles(root, at("commands"))) add(path, "command", "plugin");
    add(at("hooks/hooks.json"), "settings", "plugin");
  }

  const startDirOptions = startFolders(contents.keys());
  return {
    snapshot: { files: found, ...(pluginName ? { pluginName } : {}) },
    repoRoot,
    startDirOptions,
    suggestedStartDir: startDirOptions.includes("") || startDirOptions.length !== 1 ? "" : startDirOptions[0],
    notEvaluated: [
      "User settings, agents and skills in ~/.claude",
      gitDirs.has(repoRoot)
        ? "Folders above the dropped folder"
        : "Folders above the dropped folder, including a git root and its .claude/settings.local.json",
      ...outside,
    ],
  };
}

/**
 * Whether a walker that collects files for any start folder should enter
 * `dirPath` (relative to the dropped folder; "" is the folder itself). Pair it
 * with mightBeConfigPath for files, record each folder holding a `.git` file
 * or folder as a gitDir, and skip files over CONFIG_WALK.maxFileBytes.
 *
 * It enters .claude, but inside it only agents, skills, rules and commands,
 * and below those it skips nothing (discover() reads everything there). It
 * enters .claude-plugin. It skips .git, other dot-folders and
 * CONFIG_WALK.skipDirs. In a dropped ~/.claude only settings.json, CLAUDE.md,
 * agents/ and skills/ count, so a walker there can leave out the rest
 * (projects/ and plugins/, for example).
 *
 * Differences from discover() a path test can't avoid: outside .claude a path
 * doesn't say whether agents/ belongs to a plugin (or to a dropped ~/.claude),
 * so dot-folders and skipped names below a plugin's agents/, skills/ or
 * commands/ (agents/build/, for example) aren't walked, though discover() reads
 * them. And discover() doesn't follow symbolic links to folders, or to agent,
 * rule and command files; a walker that does can find more.
 */
export function shouldDescend(dirPath: string): boolean {
  const segments = clean(dirPath).split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === ".claude") {
      const component = segments[index + 1];
      return component === undefined || CLAUDE_COMPONENTS.has(component);
    }
    if (segment === ".claude-plugin") continue;
    if (segment.startsWith(".") || CONFIG_WALK.skipDirs.has(segment)) return false;
  }
  return true;
}

/**
 * A cheap test on a path's last segments: true for every path
 * snapshotFromProjectFiles can use from some start folder, including
 * .claude-plugin/plugin.json, hooks/hooks.json and, for a dropped ~/.claude,
 * a root-level settings.json. It is also true for some paths no start folder
 * uses. It takes relative or absolute paths, with / or \ separators; a
 * root-level settings.json matches only as the relative path "settings.json".
 */
export function mightBeConfigPath(path: string): boolean {
  const segments = path.split(/[\\/]/);
  while (segments.length > 1 && segments[0] === ".") segments.shift();
  const name = segments[segments.length - 1];
  const parent = segments[segments.length - 2];
  if (name === ".mcp.json" || INSTRUCTIONS.has(name)) return true;
  if (name === "settings.json") return parent === ".claude" || segments.length === 1;
  if (name === "settings.local.json") return parent === ".claude";
  if (name === "plugin.json") return parent === ".claude-plugin";
  if (name === "hooks.json") return parent === "hooks";
  if (name === "SKILL.md" && segments[segments.length - 3] === "skills") return true;
  if (!name.endsWith(".md")) return false;
  // Agent and command files at any depth below agents/ or commands/; rules only below .claude/rules/.
  const folders = segments.slice(0, -1);
  return folders.some((segment, index) => segment === "agents" || segment === "commands" || (segment === "rules" && folders[index - 1] === ".claude"));
}
