import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG_WALK, mightBeConfigPath, shouldDescend, snapshotFromProjectFiles, type ConfigSnapshot, type ProjectFile } from "@context-canvas/core/config/index";
import { discover } from "../discover";
import { BENCHMARK_FIXTURES, brokenRepo, copyBenchmarkFixture, orderingRepo, pluginRepo, writeFixture, type Fixture } from "./fixtures";

// The browser and the CLI must read the same files. For each folder, the CLI's
// disk discovery and core's snapshotFromProjectFiles (fed by a walk that uses
// shouldDescend and mightBeConfigPath, as a browser would) must agree on
// every file, its scope, kind, display path, content and order.

const temps: string[] = [];
const tempDir = (label: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `cc-parity-${label}-`)));
  temps.push(dir);
  return dir;
};
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Collects files the way a browser walks a dropped folder. */
function walk(root: string): { files: ProjectFile[]; gitDirs: string[] } {
  const files: ProjectFile[] = [];
  const gitDirs: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.name === ".git") gitDirs.push(dir);
      else if (entry.isDirectory()) {
        if (shouldDescend(path)) visit(path);
      } else if (entry.isFile() && mightBeConfigPath(path) && statSync(join(root, path)).size <= CONFIG_WALK.maxFileBytes) {
        files.push({ path, content: readFileSync(join(root, path), "utf8") });
      }
    }
  };
  visit("");
  return { files, gitDirs };
}

const describeFiles = (snapshot: ConfigSnapshot) => snapshot.files.map((file) => `${file.scope} ${file.kind} ${file.path}${file.nested ? " (nested)" : ""}`);

function expectParity(root: string, start: string) {
  const discovered = discover({ cwd: join(root, start), home: tempDir("home"), includeUser: false });
  // Files above the temporary folder are outside what a browser is given.
  const inside = (display: string) => {
    const absolute = resolve(discovered.startDir, display);
    return absolute === root || absolute.startsWith(root + sep);
  };
  const expected: ConfigSnapshot = { ...discovered.snapshot, files: discovered.snapshot.files.filter((file) => inside(file.path)) };
  const walked = walk(root);
  // Input order doesn't matter: the files come back in discover()'s order.
  const pure = snapshotFromProjectFiles([...walked.files].reverse(), { startDir: start, gitDirs: walked.gitDirs });

  expect(expected.files.length).toBeGreaterThan(0);
  expect(describeFiles(pure.snapshot)).toEqual(describeFiles(expected));
  expect(pure.snapshot).toEqual(expected);
  if (walked.gitDirs.length > 0) expect(pure.repoRoot).toBe(relative(root, discovered.repoRoot).split(sep).join("/"));
  return { pure, walked };
}

const scenario = (label: string, fixture: Fixture) => {
  const root = tempDir(label);
  writeFixture(root, fixture);
  return root;
};

describe("the CLI and snapshotFromProjectFiles read the same files", () => {
  it("a monorepo with the reported problems, from packages/app and from the root", () => {
    const root = scenario("broken", brokenRepo);
    const { pure } = expectParity(root, brokenRepo.start);
    expect(describeFiles(pure.snapshot)).toEqual(expect.arrayContaining(["ancestor settings ../../.claude/settings.json", "local settings ../../.claude/settings.local.json"]));
    expectParity(root, "");
  });

  it("a plugin repository", () => {
    const { pure } = expectParity(scenario("plugin", pluginRepo), pluginRepo.start);
    expect(pure.snapshot.pluginName).toBe("deploy-tools");
  });

  for (const fixture of BENCHMARK_FIXTURES) {
    it(`benchmark fixture: ${fixture}`, () => {
      const root = tempDir(fixture);
      copyBenchmarkFixture(fixture, root);
      expectParity(root, "");
    });
  }

  it("ordering and edge cases, from each start folder", () => {
    const root = scenario("ordering", orderingRepo);
    const { pure, walked } = expectParity(root, "");
    // The fixture exercises what it claims to.
    expect(pure.snapshot.files.map((file) => file.path)).toEqual([
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".mcp.json",
      ".claude/agents/alpha.md",
      ".claude/agents/build/x.md",
      ".claude/agents/Zeta.md",
      ".claude/skills/Lint/SKILL.md",
      ".claude/skills/a-b/SKILL.md",
      ".claude/skills/a/SKILL.md",
      ".claude/rules/api/errors.md",
      ".claude/rules/style.md",
      ".claude/commands/deploy.md",
      "CLAUDE.md",
      "CLAUDE.local.md",
      "AGENTS.md",
      "docs/CLAUDE.md",
      "apps/web/CLAUDE.md",
      "docs/guide/CLAUDE.local.md",
      "apps/web/src/CLAUDE.md",
    ]);
    const paths = walked.files.map((file) => file.path);
    expect(walked.gitDirs).toEqual([""]);
    expect(paths).not.toContain(".claude/agents/huge.md");
    for (const skipped of [".claude/worktrees/", "node_modules/", "build/", ".github/"]) expect(paths.filter((path) => path.startsWith(skipped))).toEqual([]);
    expect(pure.startDirOptions).toEqual(["", "apps/web", "tools/deploy"]);

    for (const start of orderingRepo.starts.slice(1)) expectParity(root, start);
    const plugin = snapshotFromProjectFiles(walked.files, { startDir: "tools/deploy", gitDirs: walked.gitDirs });
    expect(describeFiles(plugin.snapshot)).toEqual([
      "local settings ../../.claude/settings.local.json",
      "ancestor settings ../../.claude/settings.json",
      "plugin agent agents/ops/oncall.md",
      "plugin agent agents/release.md",
      "plugin skill skills/ship/SKILL.md",
      "plugin command commands/rollback.md",
      "plugin settings hooks/hooks.json",
    ]);
  });
});
