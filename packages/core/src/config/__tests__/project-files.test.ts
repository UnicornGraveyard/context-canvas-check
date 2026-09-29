import { describe, expect, it } from "vitest";
import { checkConfig, CONFIG_WALK, mightBeConfigPath, shouldDescend, snapshotFromProjectFiles, type ConfigSnapshot, type ProjectFile } from "../index";

// The location rules of packages/cli discover.ts, applied to files already
// read. packages/cli parity.test.ts compares the two on real folders; these
// cases pin each rule.

const files = (entries: Record<string, string>): ProjectFile[] => Object.entries(entries).map(([path, content]) => ({ path, content }));
const listed = (snapshot: ConfigSnapshot) => snapshot.files.map((file) => `${file.scope} ${file.kind} ${file.path}${file.nested ? " (nested)" : ""}`);
const stub = (name: string) => `---\nname: ${name}\ndescription: ${name}.\n---\n`;
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

describe("snapshotFromProjectFiles: project scope", () => {
  it("reads the start folder's files in discover()'s order", () => {
    const { snapshot } = snapshotFromProjectFiles(files({
      "AGENTS.md": "Agents.\n",
      ".claude/CLAUDE.md": "More.\n",
      "CLAUDE.local.md": "Local.\n",
      "CLAUDE.md": "Root.\n",
      "infra/CLAUDE.md": "Never apply.\n",
      ".claude/commands/ops/deploy.md": "Deploy.\n",
      ".claude/rules/style.md": "Style.\n",
      ".claude/skills/review/SKILL.md": stub("review"),
      ".claude/skills/review/reference.md": "Not a skill file.\n",
      ".claude/skills/review/nested/SKILL.md": stub("too-deep"),
      ".claude/skills/SKILL.md": stub("no-folder"),
      ".claude/agents/team/reviewer.md": stub("reviewer"),
      ".claude/agents/notes.txt": "Not markdown.\n",
      ".mcp.json": "{}",
      ".claude/settings.local.json": "{}",
      ".claude/settings.json": "{}",
      "src/index.ts": "export {};\n",
    }));
    expect(listed(snapshot)).toEqual([
      "project settings .claude/settings.json",
      "local settings .claude/settings.local.json",
      "project mcp .mcp.json",
      "project agent .claude/agents/team/reviewer.md",
      "project skill .claude/skills/review/SKILL.md",
      "project rule .claude/rules/style.md",
      "project command .claude/commands/ops/deploy.md",
      "project instructions CLAUDE.md",
      "project instructions CLAUDE.local.md",
      "project instructions .claude/CLAUDE.md",
      "project instructions AGENTS.md",
      "project instructions infra/CLAUDE.md (nested)",
    ]);
    expect(snapshot.files[0]).toEqual({ path: ".claude/settings.json", scope: "project", kind: "settings", content: "{}" });
    expect(snapshot.pluginName).toBeUndefined();
  });

  it("sorts agents with localeCompare per folder, skills as plain strings, nested CLAUDE.md breadth first", () => {
    const { snapshot } = snapshotFromProjectFiles(files({
      ".claude/agents/Zeta.md": stub("zeta"),
      ".claude/agents/beta/one.md": stub("one"),
      ".claude/agents/alpha.md": stub("alpha"),
      ".claude/skills/a/SKILL.md": stub("a"),
      ".claude/skills/a-b/SKILL.md": stub("a-b"),
      ".claude/skills/Lint/SKILL.md": stub("lint"),
      "docs/guide/CLAUDE.local.md": "Guide.\n",
      "apps/web/CLAUDE.md": "Web.\n",
      "docs/CLAUDE.md": "Docs.\n",
    }));
    expect(snapshot.files.map((file) => file.path)).toEqual([
      ".claude/agents/alpha.md",
      ".claude/agents/beta/one.md",
      ".claude/agents/Zeta.md",
      ".claude/skills/Lint/SKILL.md",
      ".claude/skills/a-b/SKILL.md",
      ".claude/skills/a/SKILL.md",
      "docs/CLAUDE.md",
      "apps/web/CLAUDE.md",
      "docs/guide/CLAUDE.local.md",
    ]);
  });

  it("leaves dot-folders and skipped folders out of the nested search, and stops after maxDirs folders", () => {
    const skipped = snapshotFromProjectFiles(files({
      "node_modules/pkg/CLAUDE.md": "Vendored.\n",
      "build/CLAUDE.md": "Built.\n",
      ".github/CLAUDE.md": "Hidden.\n",
      "src/.cache/CLAUDE.md": "Hidden.\n",
      "src/CLAUDE.md": "Source.\n",
    }));
    expect(listed(skipped.snapshot)).toEqual(["project instructions src/CLAUDE.md (nested)"]);

    // The start folder counts as the first folder visited, as in discover().
    const many: Record<string, string> = {};
    for (let index = 0; index < CONFIG_WALK.maxDirs; index += 1) many[`f${String(index).padStart(4, "0")}/CLAUDE.md`] = "Notes.\n";
    const capped = snapshotFromProjectFiles(files(many));
    expect(capped.snapshot.files).toHaveLength(CONFIG_WALK.maxDirs - 1);
    expect(capped.snapshot.files.at(-1)?.path).toBe("f4998/CLAUDE.md");
  });

  it("reads settings.local.json from the nearest git root at or above the start folder", () => {
    const tree = files({
      ".claude/settings.local.json": '{ "at": "root" }',
      "packages/app/.claude/settings.local.json": '{ "at": "app" }',
      "packages/app/CLAUDE.md": "App.\n",
    });
    const local = (gitDirs: string[]) => {
      const result = snapshotFromProjectFiles(tree, { startDir: "packages/app", gitDirs });
      return { repoRoot: result.repoRoot, local: result.snapshot.files.filter((file) => file.scope === "local").map((file) => file.path) };
    };
    expect(local([""])).toEqual({ repoRoot: "", local: ["../../.claude/settings.local.json"] });
    expect(local(["", "packages/app"])).toEqual({ repoRoot: "packages/app", local: [".claude/settings.local.json"] });
    // No git root in the dropped folder, or none above the start folder: the start folder, as findRepoRoot does.
    expect(local([])).toEqual({ repoRoot: "packages/app", local: [".claude/settings.local.json"] });
    expect(local(["other"])).toEqual({ repoRoot: "packages/app", local: [".claude/settings.local.json"] });
  });

  it("a monorepo started in packages/app: settings above it are ancestors, and settings-in-parent-folder fires", () => {
    const { snapshot } = snapshotFromProjectFiles(files({
      ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(./.env)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] } }),
      "packages/.claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } }),
      "packages/app/.claude/settings.json": "{}",
      "packages/app/.claude/agents/reviewer.md": stub("reviewer"),
    }), { startDir: "packages/app", gitDirs: [""] });
    expect(listed(snapshot)).toEqual([
      "project settings .claude/settings.json",
      "project agent .claude/agents/reviewer.md",
      "ancestor settings ../.claude/settings.json",
      "ancestor settings ../../.claude/settings.json",
    ]);
    const findings = checkConfig(snapshot, { now: "2026-09-27T00:00:00.000Z" }).findings.filter((finding) => finding.check === "settings-in-parent-folder");
    expect(findings.map((finding) => finding.file)).toEqual(["../../.claude/settings.json", "../.claude/settings.json"]);
    expect(findings[0].message).toContain("its 1 permission rule and 1 hook don't apply");
    expect(findings[0].fix).toContain("Start Claude Code in ../..");
  });

  it("accepts start folders and paths with stray slashes, and keeps the first of two files with the same path", () => {
    const tree = files({ "packages/app/CLAUDE.md": "First.\n", "./packages/app/CLAUDE.md": "Second.\n", "packages/app/.mcp.json": "{}" });
    for (const startDir of ["packages/app", "packages/app/", "./packages/app"]) {
      const { snapshot } = snapshotFromProjectFiles(tree, { startDir, gitDirs: ["./"] });
      expect(snapshot.files.map((file) => `${file.path}: ${file.content}`)).toEqual([".mcp.json: {}", "CLAUDE.md: First.\n"]);
    }
  });

  it("gives the same snapshot whatever order the files come in", () => {
    const tree = files({
      ".claude/agents/b.md": stub("b"),
      ".claude/agents/a/x.md": stub("x"),
      "docs/CLAUDE.md": "Docs.\n",
      "apps/CLAUDE.md": "Apps.\n",
      ".claude/skills/one/SKILL.md": stub("one"),
    });
    expect(snapshotFromProjectFiles([...tree].reverse()).snapshot).toEqual(snapshotFromProjectFiles(tree).snapshot);
  });
});

describe("snapshotFromProjectFiles: plugin layout", () => {
  const plugin = {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "deploy-tools" }),
    "agents/reviewer.md": stub("reviewer"),
    "agents/ops/oncall.md": stub("oncall"),
    "skills/review/SKILL.md": stub("review"),
    "commands/rollback.md": "Roll back.\n",
    "hooks/hooks.json": JSON.stringify({ hooks: {} }),
    ".claude/agents/local.md": stub("local"),
  };

  it("reads agents, skills, commands and hooks.json after the project files, with the plugin's name", () => {
    const { snapshot } = snapshotFromProjectFiles(files(plugin));
    expect(listed(snapshot)).toEqual([
      "project agent .claude/agents/local.md",
      "plugin agent agents/ops/oncall.md",
      "plugin agent agents/reviewer.md",
      "plugin skill skills/review/SKILL.md",
      "plugin command commands/rollback.md",
      "plugin settings hooks/hooks.json",
    ]);
    expect(snapshot.pluginName).toBe("deploy-tools");
  });

  it("without .claude-plugin/plugin.json, agents/ is an ordinary folder", () => {
    const { ".claude-plugin/plugin.json": _manifest, ...rest } = plugin;
    expect(listed(snapshotFromProjectFiles(files(rest)).snapshot)).toEqual(["project agent .claude/agents/local.md"]);
  });

  it("reads the plugin's files without a name when the manifest has none", () => {
    for (const manifest of ["{ not json", "null", JSON.stringify({ name: 7 }), JSON.stringify({ name: "" })]) {
      const { snapshot } = snapshotFromProjectFiles(files({ ...plugin, ".claude-plugin/plugin.json": manifest }));
      expect(snapshot.pluginName).toBeUndefined();
      expect(snapshot.files.filter((file) => file.scope === "plugin")).toHaveLength(5);
    }
  });
});

describe("snapshotFromProjectFiles: a dropped ~/.claude (rootScope user)", () => {
  const home = files({
    "settings.json": JSON.stringify({ permissions: { deny: ["Read(/Users/alice/.ssh/**)"] } }),
    "agents/helper.md": stub("helper"),
    "agents/team/lead.md": stub("lead"),
    "skills/notes/SKILL.md": stub("notes"),
    "CLAUDE.md": "Personal.\n",
    "settings.local.json": "{}",
    "rules/style.md": "Style.\n",
    "commands/standup.md": "Standup.\n",
    ".claude/settings.json": "{}",
    "projects/app/CLAUDE.md": "Not config.\n",
  });

  it("reads user settings, agents, skills and CLAUDE.md as ~/.claude/...", () => {
    const result = snapshotFromProjectFiles(home, { rootScope: "user", startDir: "projects/app", gitDirs: [""] });
    expect(listed(result.snapshot)).toEqual([
      "user settings ~/.claude/settings.json",
      "user agent ~/.claude/agents/helper.md",
      "user agent ~/.claude/agents/team/lead.md",
      "user skill ~/.claude/skills/notes/SKILL.md",
      "user instructions ~/.claude/CLAUDE.md",
    ]);
    expect(result).toMatchObject({ repoRoot: "", startDirOptions: [], suggestedStartDir: "" });
    expect(result.notEvaluated.join("\n")).not.toContain("~/.claude");
    expect(result.notEvaluated.join("\n")).toContain("Project files");
  });

  it("appends to a project snapshot the way the CLI's user scope does", () => {
    const project = snapshotFromProjectFiles(files({ ".claude/settings.json": "{}" })).snapshot;
    const user = snapshotFromProjectFiles(home, { rootScope: "user" }).snapshot;
    const { findings } = checkConfig({ files: [...project.files, ...user.files] }, { now: "2026-09-27T00:00:00.000Z" });
    expect(findings.map((finding) => `${finding.check} ${finding.file}`)).toContain("single-slash-path ~/.claude/settings.json");
  });
});

describe("snapshotFromProjectFiles: start folder options", () => {
  const options = (paths: string[]) => {
    const { startDirOptions, suggestedStartDir } = snapshotFromProjectFiles(paths.map((path) => ({ path, content: "{}" })));
    return { startDirOptions, suggestedStartDir };
  };

  it("lists folders with a .claude folder or a plugin manifest, shallowest first, then by name", () => {
    expect(options([
      "services/web/.claude/settings.json",
      "apps/api/.claude/agents/x.md",
      "tools/.claude-plugin/plugin.json",
      "zeta/.claude/settings.local.json",
      "node_modules/pkg/.claude/settings.json",
      "build/.claude/settings.json",
      ".claude/worktrees/feature/.claude/settings.json",
      "docs/.claude",
    ])).toEqual({ startDirOptions: ["", "tools", "zeta", "apps/api", "services/web"], suggestedStartDir: "" });
  });

  it("suggests the dropped folder when it has one, else the only option, else the dropped folder", () => {
    expect(options([".claude/settings.json", "packages/app/.claude/settings.json"]).suggestedStartDir).toBe("");
    expect(options(["packages/app/.claude/settings.json", "packages/app/CLAUDE.md"])).toEqual({ startDirOptions: ["packages/app"], suggestedStartDir: "packages/app" });
    expect(options(["a/.claude/settings.json", "b/.claude-plugin/plugin.json"])).toEqual({ startDirOptions: ["a", "b"], suggestedStartDir: "" });
    expect(options(["CLAUDE.md"])).toEqual({ startDirOptions: [], suggestedStartDir: "" });
  });
});

describe("snapshotFromProjectFiles: what isn't evaluated", () => {
  it("names user settings, managed settings, folders above, flags and marketplace plugins", () => {
    const tree = files({ "packages/app/CLAUDE.md": "App.\n" });
    const withoutGit = snapshotFromProjectFiles(tree, { startDir: "packages/app" }).notEvaluated;
    expect(withoutGit).toEqual([
      "User settings, agents and skills in ~/.claude",
      "Folders above the dropped folder, including a git root and its .claude/settings.local.json",
      "Managed settings set by an administrator",
      "Command-line flags",
      "Plugins installed from a marketplace",
    ]);
    const withGit = snapshotFromProjectFiles(tree, { startDir: "packages/app", gitDirs: [""] }).notEvaluated;
    expect(withGit).toContain("Folders above the dropped folder");
    expect(withGit.join("\n")).not.toContain("git root");
  });
});

describe("shouldDescend", () => {
  it("enters .claude only for agents, skills, rules and commands, and skips nothing below them", () => {
    for (const path of ["", "src", "packages/app", ".claude", ".claude/agents", ".claude/agents/build", ".claude/agents/.drafts", ".claude/skills/pdf/node_modules", ".claude/rules/api", ".claude/commands/ops", "packages/app/.claude/rules", ".claude-plugin", "tools/.claude-plugin", "agents/ops"]) {
      expect(shouldDescend(path), path).toBe(true);
    }
    for (const path of [".git", ".github", ".vscode", ".claude/worktrees", ".claude/worktrees/feature", ".claude/hooks", ".claude/.claude", "node_modules", "src/dist", "packages/app/build", "vendor/pkg/.claude", "__pycache__", "venv"]) {
      expect(shouldDescend(path), path).toBe(false);
    }
  });

  it("can't tell a plugin's agents/ from other folders: agents/build/ is skipped though discover() reads it", () => {
    expect(shouldDescend("agents/build")).toBe(false);
    expect(listed(snapshotFromProjectFiles(files({ ".claude-plugin/plugin.json": "{}", "agents/build/x.md": stub("x") })).snapshot)).toEqual(["plugin agent agents/build/x.md"]);
  });
});

describe("mightBeConfigPath", () => {
  it("is true for the paths Claude Code reads, relative or absolute", () => {
    for (const path of [
      ".claude/settings.json", ".claude/settings.local.json", ".mcp.json", "CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md",
      ".claude/agents/reviewer.md", ".claude/agents/team/lead.md", ".claude/skills/review/SKILL.md", ".claude/rules/api/errors.md",
      ".claude/commands/deploy.md", "infra/CLAUDE.md", ".claude-plugin/plugin.json", "agents/reviewer.md", "skills/review/SKILL.md",
      "commands/rollback.md", "hooks/hooks.json", "settings.json", "./settings.json", "packages/app/.claude/agents/x.md",
      "../../.claude/settings.json", "~/.claude/settings.json", "/Users/alice/.claude/settings.json", "/repo/.claude/agents/x.md",
      "C:\\repo\\.claude\\settings.json", "C:\\repo\\CLAUDE.md",
    ]) {
      expect(mightBeConfigPath(path), path).toBe(true);
    }
  });

  it("is false for other files, including settings.json outside .claude/ unless it is the whole relative path", () => {
    for (const path of [
      "src/index.ts", "README.md", "docs/guide.md", "rules/style.md", "src/rules/x.md", ".claude/hooks/guard.sh", ".claude/settings.yaml",
      ".vscode/settings.json", "/settings.json", "/repo/settings.json", "C:\\repo\\settings.json", "packages/app/settings.json",
      "plugin.json", "hooks.json", ".claude/skills/review/reference.md", ".claude/skills/review/nested/SKILL.md", "claude.md", ".git",
    ]) {
      expect(mightBeConfigPath(path), path).toBe(false);
    }
  });

  it("covers every file snapshotFromProjectFiles uses, from every start folder, and a walker reaches its folder", () => {
    const tree = files({
      ".claude/settings.json": "{}", ".claude/settings.local.json": "{}", ".mcp.json": "{}", "CLAUDE.md": "", "CLAUDE.local.md": "", "AGENTS.md": "", ".claude/CLAUDE.md": "",
      ".claude/agents/a.md": "", ".claude/agents/build/b.md": "", ".claude/skills/s/SKILL.md": "", ".claude/rules/r/x.md": "", ".claude/commands/c.md": "",
      "docs/CLAUDE.md": "", "docs/deep/CLAUDE.local.md": "", "packages/app/.claude/settings.json": "{}", "packages/app/.claude/agents/x.md": "",
      "packages/app/infra/CLAUDE.md": "", "tools/p/.claude-plugin/plugin.json": "{}", "tools/p/agents/y.md": "", "tools/p/agents/sub/z.md": "",
      "tools/p/skills/k/SKILL.md": "", "tools/p/commands/w.md": "", "tools/p/hooks/hooks.json": "{}",
    });
    const folders = new Set([""]);
    for (const file of tree) for (let dir = parentOf(file.path); dir; dir = parentOf(dir)) folders.add(dir);
    const used = new Set<string>();
    for (const startDir of folders) {
      for (const file of snapshotFromProjectFiles(tree, { startDir, gitDirs: [""] }).snapshot.files) {
        const segments = startDir ? startDir.split("/") : [];
        for (const segment of file.path.split("/")) {
          if (segment === "..") segments.pop();
          else segments.push(segment);
        }
        used.add(segments.join("/"));
      }
    }
    expect(used.size).toBeGreaterThan(20);
    for (const path of used) {
      expect(mightBeConfigPath(path), path).toBe(true);
      expect(mightBeConfigPath(`/home/alice/repo/${path}`), path).toBe(true);
      expect(shouldDescend(parentOf(path)), path).toBe(true);
    }
    for (const file of snapshotFromProjectFiles(files({ "settings.json": "{}", "agents/a/b.md": "", "skills/s/SKILL.md": "", "CLAUDE.md": "" }), { rootScope: "user" }).snapshot.files) {
      const path = file.path.replace(/^~\/\.claude\//, "");
      expect(mightBeConfigPath(path), path).toBe(true);
      expect(mightBeConfigPath(`/home/alice/.claude/${path}`), path).toBe(true);
    }
  });
});
