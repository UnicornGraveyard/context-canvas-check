import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeCodeAdapter, compile } from "@context-canvas/core";
import { run } from "../cli";
import { BENCHMARK_FIXTURES, brokenRepo, copyBenchmarkFixture, pluginRepo, REPO, write, writeFixture } from "./fixtures";

// End-to-end: real folders on disk, discovered and checked the way a
// person or a Claude Code hook would run the CLI.

const temps: string[] = [];
const tempDir = (label: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `cc-check-${label}-`)));
  temps.push(dir);
  return dir;
};
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

type Report = { summary: { error: number; warning: number; info: number }; findings: { check: string; severity: string; file: string; message: string }[] };
const check = (cwd: string, home: string, ...args: string[]) => {
  const result = run(["check", "--cwd", cwd, "--json", ...args], { HOME: home });
  return { ...result, report: JSON.parse(result.stdout) as Report };
};

describe("real configurations produce no errors or warnings", () => {
  // Golden exports live in the web app; the public repository doesn't have them.
  const goldenRoot = join(REPO, "apps/web/lib/export/__tests__/__golden__");
  for (const template of existsSync(goldenRoot) ? readdirSync(goldenRoot) : []) {
    it(`Context Canvas export: ${template}`, () => {
      const dir = tempDir(template);
      const paths = [...(JSON.parse(readFileSync(join(goldenRoot, template, "_files.json"), "utf8")) as string[]), "AGENTS.md"];
      for (const path of paths) {
        const golden = join(goldenRoot, template, `${path.split("/").map((segment) => (segment.startsWith(".") ? `_${segment.slice(1)}` : segment)).join("/")}.golden`);
        if (existsSync(golden)) write(dir, { [path]: readFileSync(golden, "utf8") });
      }
      const { exitCode, report } = check(dir, tempDir("home"), "--no-user");
      expect(report.findings.filter((finding) => finding.severity !== "info")).toEqual([]);
      expect(exitCode).toBe(0);
    });
  }

  it("fresh Claude Code exports: agents that inherit, skills, and a gated lifecycle", () => {
    const atom = (id: string, type: string, title: string, metadata: unknown = null) => ({ id, type, title, content: `${title}.`, metadata });
    const edge = (id: string, sourceAtomId: string, targetAtomId: string, label: string, metadata?: unknown) => ({ id, sourceAtomId, targetAtomId, label, ...(metadata ? { metadata } : {}) });
    const { ir } = compile(
      {
        atoms: [
          atom("base", "AGENT_CLASS", "Base Engineer"),
          atom("builder", "AGENT_CLASS", "Builder"),
          atom("reviewer", "AGENT_CLASS", "Reviewer"),
          atom("tests", "SKILL", "Write Tests"),
          atom("plan", "STAGE", "Plan", { kind: "PLANNING" }),
          atom("build", "STAGE", "Build", { kind: "CONSTRUCTION", maxIterations: 3 }),
          atom("approve", "GATE", "Plan approval", { gateType: "HUMAN_APPROVAL" }),
          atom("ci", "GATE", "Tests pass", { gateType: "CHECK", command: "npm test" }),
        ],
        edges: [
          edge("e1", "builder", "base", "EXTENDS"),
          edge("e2", "reviewer", "base", "EXTENDS"),
          edge("e3", "builder", "tests", "COMPOSES"),
          edge("e4", "plan", "build", "NEXT"),
          edge("e5", "reviewer", "plan", "ASSIGNED_TO", { role: "LEAD" }),
          edge("e6", "builder", "build", "ASSIGNED_TO", { role: "LEAD" }),
          edge("e7", "plan", "approve", "GATED_BY"),
          edge("e8", "build", "ci", "GATED_BY"),
        ],
      },
      { name: "Fresh export" }
    );
    for (const layout of ["project", "plugin"]) {
      const dir = tempDir(`fresh-${layout}`);
      write(dir, claudeCodeAdapter.emit(ir, { layout }).files);
      const { exitCode, report } = check(dir, tempDir("home"), "--no-user");
      expect(report.findings.filter((finding) => finding.severity !== "info"), layout).toEqual([]);
      expect(exitCode).toBe(0);
    }
  });

  for (const fixture of BENCHMARK_FIXTURES) {
    it(`benchmark fixture: ${fixture}`, () => {
      const dir = tempDir(fixture);
      copyBenchmarkFixture(fixture, dir);
      const { exitCode, report } = check(dir, tempDir("home"), "--no-user");
      expect(report.findings.filter((finding) => finding.severity !== "info")).toEqual([]);
      expect(exitCode).toBe(0);
    });
  }
});

describe("a repository with the reported problems", () => {
  const root = tempDir("broken");
  const home = tempDir("home");
  writeFixture(root, brokenRepo);
  write(home, brokenRepo.home);
  const app = join(root, brokenRepo.start);

  it("finds each problem and exits 1 on errors", () => {
    const { exitCode, report } = check(app, home);
    const found = report.findings.map((finding) => `${finding.severity} ${finding.check} ${finding.file}`);
    expect(found).toEqual(expect.arrayContaining([
      "error agent-not-loaded .claude/agents/tester.md",
      "warning agent-unknown-field .claude/agents/reviewer.md",
      "warning mcp-enabled-and-disabled ../../.claude/settings.local.json",
      "warning settings-in-parent-folder ../../.claude/settings.json",
      "warning nested-claude-md infra/CLAUDE.md",
      "warning single-slash-path ~/.claude/settings.json",
    ]));
    expect(exitCode).toBe(1);
  });

  it("prints readable text with fixes and doc links", () => {
    const { stdout } = run(["check", "--cwd", app], { HOME: home });
    expect(stdout).toContain("ERROR  .claude/agents/tester.md:4");
    expect(stdout).toContain("Fix: Rename allowed-tools to tools.");
    expect(stdout).toContain("Docs: https://code.claude.com/docs/en/sub-agents");
    expect(stdout).toContain("No baseline yet.");
  });

  it("skips user settings with --no-user", () => {
    expect(check(app, home, "--no-user").report.findings.some((finding) => finding.file.startsWith("~/"))).toBe(false);
  });

  it("tracks drift against the last-seen baseline", () => {
    check(app, home, "--update-baseline");
    write(root, { ".claude/settings.json": JSON.stringify({ permissions: { deny: [] } }) });
    const drift = check(app, home).report.findings.filter((finding) => finding.check === "config-drift").map((finding) => finding.message);
    expect(drift).toEqual(expect.arrayContaining([
      expect.stringContaining("A PreToolUse [Bash] hook was removed in ../../.claude/settings.json"),
      expect.stringContaining("The deny rule Read(./.env) was removed"),
    ]));
  });

  it("post-edit hook: exit 2 with the edited file's problems, silent for other files", () => {
    const edited = run(["check", "--hook", "post-edit"], { HOME: home, CLAUDE_PROJECT_DIR: app }, JSON.stringify({ tool_input: { file_path: join(app, ".claude/agents/tester.md") } }));
    expect(edited.exitCode).toBe(2);
    expect(edited.stderr).toContain(".claude/agents/tester.md won't apply as written");
    expect(edited.stderr).toContain("hooks written as a list");
    const other = run(["check", "--hook", "post-edit"], { HOME: home, CLAUDE_PROJECT_DIR: app }, JSON.stringify({ tool_input: { file_path: join(app, "src/index.ts") } }));
    expect(other).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("session-start hook: exit 0, summary on stdout", () => {
    const result = run(["check", "--hook", "session-start"], { HOME: home, CLAUDE_PROJECT_DIR: app });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[error] .claude/agents/tester.md:4");
  });
});

describe("readable output for large repositories", () => {
  it("groups identical problems and hides notes unless asked", () => {
    const dir = tempDir("many");
    const stub = (name: string) => `---\nname: ${name}\ndescription: A stub.\n`;
    write(dir, Object.fromEntries(["a", "b", "c", "d"].map((name) => [`.claude/agents/${name}.md`, stub(name)])));
    write(dir, { ".claude/agents/meta.md": "---\nname: meta\ndescription: M.\ntype: core\npriority: high\n---\n" });
    const { stdout } = run(["check", "--cwd", dir, "--no-user"], { HOME: tempDir("home") });
    expect(stdout).toContain("ERROR  Agent file Claude Code skips: 4 files");
    expect(stdout).toContain("Fix: Add a closing --- line after the last frontmatter field.");
    expect(stdout).toContain("    .claude/agents/d.md");
    expect(stdout).toContain("1 note not shown (1 × Agent frontmatter field Claude Code ignores). Add --notes to list them.");
    expect(stdout).not.toContain("NOTE ");
    const withNotes = run(["check", "--cwd", dir, "--no-user", "--notes"], { HOME: tempDir("home") }).stdout;
    expect(withNotes).toContain('Agent "meta" has 2 fields Claude Code ignores: type, priority.');
  });
});

describe("a plugin repository (R12)", () => {
  it("tells the author to use the namespaced agent name", () => {
    const dir = tempDir("plugin");
    writeFixture(dir, pluginRepo);
    const [finding] = check(dir, tempDir("home"), "--no-user").report.findings.filter((item) => item.check === "agent-reference-unresolved");
    expect(finding.message).toContain('"deploy-tools:reviewer"');
  });
});

describe("unusual layouts", () => {
  it("doesn't crash when .claude/agents, skills, rules or commands is a file", () => {
    const dir = tempDir("files-not-folders");
    write(dir, { ".claude/agents": "", ".claude/skills": "", ".claude/rules": "", ".claude/commands": "", "CLAUDE.md": "# Project\n" });
    const result = run(["check", "--cwd", dir, "--no-user", "--json"], { HOME: tempDir("home") });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).findings).toEqual([]);
  });
});

describe("usage", () => {
  it("runs check by default", () => {
    const dir = tempDir("default");
    const result = run(["--cwd", dir, "--no-user", "--json"], { HOME: tempDir("home") });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toEqual({ error: 0, warning: 0, info: 0 });
  });
  it("rejects unknown options with exit 2", () => {
    expect(run(["check", "--nope"], {}).exitCode).toBe(2);
    expect(run(["frobnicate"], {}).exitCode).toBe(2);
    expect(run(["--help"], {}).stdout).toContain("context-canvas-check [check] [options]");
  });
});
