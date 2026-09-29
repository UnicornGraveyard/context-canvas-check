import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Folders shared by cli.test.ts and parity.test.ts. Paths are relative to the
// folder's root; `start` is where a Claude Code session starts.

export const REPO = join(__dirname, "../../../..");

export type Fixture = {
  files: Record<string, string>;
  /** Empty folders to create, such as ".git". */
  dirs?: string[];
  start: string;
};

export function write(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

export function writeFixture(root: string, fixture: Fixture) {
  for (const dir of fixture.dirs ?? []) mkdirSync(join(root, dir), { recursive: true });
  write(root, fixture.files);
}

/** A monorepo with the reported problems. The session starts in packages/app. */
export const brokenRepo: Fixture & { home: Record<string, string> } = {
  dirs: [".git"],
  start: "packages/app",
  files: {
    // R09: project settings at the repository root; the session starts in packages/app.
    ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(./.env)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] } }),
    // R07: local settings load from the repository root, even from a subfolder.
    ".claude/settings.local.json": JSON.stringify({ enabledMcpjsonServers: ["docs"], disabledMcpjsonServers: ["docs"] }),
    "packages/app/.claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews code.\nallowed-tools: Read, Grep\n---\nReview.\n", // R11
    "packages/app/.claude/agents/tester.md": "---\nname: tester\ndescription: Tests.\nhooks: []\n---\nTest.\n", // R16
    "packages/app/infra/CLAUDE.md": "Never run terraform apply.\n", // R41
    "packages/app/src/index.ts": "export {};\n",
  },
  home: { ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(/Users/alice/.ssh/**)"] } }) }, // R39
};

/** A plugin whose skill names a plugin agent without its namespace (R12). */
export const pluginRepo: Fixture = {
  start: "",
  files: {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "deploy-tools" }),
    "agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews.\n---\n",
    "skills/review/SKILL.md": "---\nname: review\ndescription: Review a change.\ncontext: fork\nagent: reviewer\n---\nReview.\n",
  },
};

export const BENCHMARK_FIXTURES = ["webapp", "platform"];

/** Copies a benchmark fixture, which is stored with `_` in place of leading dots. */
export function copyBenchmarkFixture(name: string, dir: string) {
  cpSync(join(REPO, "docs/research/evidence-sprint/benchmark/fixtures", name), dir, { recursive: true });
  for (const [from, to] of [["_claude", ".claude"], ["_mcp.json", ".mcp.json"], ["_CLAUDE.md", "CLAUDE.md"], ["_AGENTS.md", "AGENTS.md"]]) {
    if (existsSync(join(dir, from))) renameSync(join(dir, from), join(dir, to));
  }
}

const stub = (name: string) => `---\nname: ${name}\ndescription: ${name}.\n---\n`;

/** Orders and edge cases of discovery, checked from each of `starts`. */
export const orderingRepo: Fixture & { starts: string[] } = {
  start: "",
  starts: ["", "apps/web", "tools/deploy"],
  files: {
    // A .git file (a worktree or submodule) marks the repository root.
    ".git": "gitdir: /elsewhere/.git/worktrees/ordering\n",
    ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Read(./.env)"] } }),
    ".claude/settings.local.json": JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } }),
    ".mcp.json": JSON.stringify({ mcpServers: {} }),
    // localeCompare puts alpha before Zeta; build/ is read inside .claude/agents.
    ".claude/agents/Zeta.md": stub("zeta"),
    ".claude/agents/alpha.md": stub("alpha"),
    ".claude/agents/build/x.md": stub("x"),
    // Over 1 MiB: not read.
    ".claude/agents/huge.md": `${stub("huge")}${"x".repeat(1024 * 1024)}\n`,
    // Plain string order on full paths: Lint/ first (uppercase), then a-b/SKILL.md before a/SKILL.md.
    ".claude/skills/a/SKILL.md": stub("a"),
    ".claude/skills/a-b/SKILL.md": stub("a-b"),
    ".claude/skills/Lint/SKILL.md": stub("lint"),
    ".claude/skills/a/reference/SKILL.md": stub("not-a-skill"),
    ".claude/rules/style.md": "Use two spaces.\n",
    ".claude/rules/api/errors.md": "Return problem details.\n",
    ".claude/commands/deploy.md": "Deploy.\n",
    ".claude/worktrees/feature/.claude/agents/stale.md": stub("stale"),
    "CLAUDE.md": "Root.\n",
    "CLAUDE.local.md": "Local.\n",
    "AGENTS.md": "Agents.\n",
    // Nested CLAUDE.md files at three depths, found breadth first.
    "docs/CLAUDE.md": "Docs.\n",
    "docs/guide/CLAUDE.local.md": "Guide.\n",
    "apps/web/CLAUDE.md": "Web.\n",
    "apps/web/src/CLAUDE.md": "Web source.\n",
    "apps/web/.claude/settings.json": JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] } }),
    // Never searched: dependency and build folders, and dot-folders.
    "node_modules/pkg/CLAUDE.md": "Vendored.\n",
    "build/CLAUDE.md": "Build output.\n",
    ".github/CLAUDE.md": "Hidden.\n",
    // A plugin in a subfolder.
    "tools/deploy/.claude-plugin/plugin.json": JSON.stringify({ name: "deploy" }),
    "tools/deploy/agents/release.md": stub("release"),
    "tools/deploy/agents/ops/oncall.md": stub("oncall"),
    "tools/deploy/skills/ship/SKILL.md": stub("ship"),
    "tools/deploy/commands/rollback.md": "Roll back.\n",
    "tools/deploy/hooks/hooks.json": JSON.stringify({ hooks: {} }),
  },
};
