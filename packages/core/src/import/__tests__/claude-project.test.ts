import { describe, expect, it } from "vitest";
import { humanize, importClaudeProject, normalizeImportPaths, splitToolList } from "../claude-project";
import { compile } from "../../ir/compile";
import { evaluateBuildGate } from "../../graph/build-gate";
import { claudeCodeAdapter } from "../../adapters/claude-code";
import { agentsMdAdapter } from "../../adapters/agents-md";

const file = (path: string, content: string) => ({ path, content });

const reviewer = `---
name: code-reviewer
description: Reviews diffs for correctness and security.
tools: Read, Grep, Bash(git diff:*)
disallowedTools: Write
model: sonnet
permissionMode: plan
skills:
  - lint-check
  - missing-skill
mcpServers:
  - github
  - tracker:
      type: http
      url: https://mcp.tracker.example
      headers:
        Authorization: Bearer \${TRACKER_TOKEN}
hooks:
  Stop:
    - hooks:
        - type: command
          command: ./check.sh
color: teal
---

You review pull requests. Cite file and line for every finding.
`;

const lintSkill = `---
name: lint-check
description: Run the linters and summarize failures.
allowed-tools: Bash(npm run lint) Read
when_to_use: Before opening a pull request.
disable-model-invocation: true
arguments: [path]
---

Run \`npm run lint\` and group failures by file.
`;

const project = [
  file("repo/.claude/agents/code-reviewer.md", reviewer),
  file("repo/.claude/skills/lint-check/SKILL.md", lintSkill),
  file("repo/.claude/rules/testing.md", "# Testing Rules\n\nEvery change ships with a test.\n"),
  file("repo/.claude/settings.json", JSON.stringify({ permissions: { allow: ["Bash(npm test)"], deny: ["Read(.env)"], defaultMode: "plan" }, env: { LOG_LEVEL: "debug" }, statusLine: {} })),
  file("repo/.claude/settings.local.json", JSON.stringify({ permissions: { allow: ["Bash(*)"] } })),
  file("repo/.mcp.json", JSON.stringify({ mcpServers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/" }, broken: { type: "ws" } } })),
  file("repo/CLAUDE.md", "# Project\n\nUse pnpm. Never commit secrets.\n"),
  file("repo/AGENTS.md", "Agents: follow the testing rules.\n"),
  file("repo/src/index.ts", "export {};\n"),
];

describe("helpers", () => {
  it("splits tool lists without breaking specifiers", () => {
    expect(splitToolList("Read, Grep, Bash(git diff:*)")).toEqual(["Read", "Grep", "Bash(git diff:*)"]);
    expect(splitToolList("Bash(npm run lint) Read")).toEqual(["Bash(npm run lint)", "Read"]);
    expect(splitToolList(["Read", " Edit "])).toEqual(["Read", "Edit"]);
    expect(splitToolList(42)).toEqual([]);
  });

  it("humanizes names and strips one shared folder", () => {
    expect(humanize("code-reviewer")).toBe("Code Reviewer");
    expect(normalizeImportPaths([file("repo/.claude/a.md", ""), file("repo/CLAUDE.md", "")]).map((f) => f.path)).toEqual([".claude/a.md", "CLAUDE.md"]);
    expect(normalizeImportPaths([file(".\\.claude\\a.md", "")]).map((f) => f.path)).toEqual([".claude/a.md"]);
  });
});

describe("importClaudeProject", () => {
  const plan = importClaudeProject(project);
  const atom = (key: string) => plan.atoms.find((item) => item.key === key);

  it("imports agents with their settings and keeps the description first", () => {
    expect(atom("agent:code-reviewer")).toMatchObject({
      type: "AGENT_CLASS",
      title: "Code Reviewer",
      metadata: { allowedTools: ["Read", "Grep", "Bash(git diff:*)"], deniedTools: ["Write"], model: "sonnet", permissionMode: "plan" },
      source: ".claude/agents/code-reviewer.md",
    });
    expect(atom("agent:code-reviewer")!.content.startsWith("Reviews diffs for correctness and security.\n\nYou review pull requests.")).toBe(true);
  });

  it("links skills, scopes inline MCP servers to the agent, and reports what it dropped", () => {
    expect(plan.edges).toContainEqual({ source: "agent:code-reviewer", target: "skill:lint-check", label: "COMPOSES" });
    expect(atom("setting:mcp:code-reviewer")).toMatchObject({
      type: "SETTING",
      metadata: { settingType: "mcp", mcpServers: { tracker: { type: "http", url: "https://mcp.tracker.example" } } },
    });
    expect(plan.edges).toContainEqual({ source: "setting:mcp:code-reviewer", target: "agent:code-reviewer", label: "CONFIGURES" });

    const warnings = plan.notes.filter((note) => note.level === "warning").map((note) => note.message);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Skill "missing-skill" is listed but not in the imported files.',
        "Invalid values were dropped: color.",
        expect.stringContaining("Hooks were dropped"),
        "Not modeled yet, dropped: arguments.",
        expect.stringContaining('MCP server "broken" was skipped'),
        "Permission settings not modeled yet: defaultMode.",
        "Settings not modeled yet were dropped: statusLine.",
      ])
    );
  });

  it("imports skills, rules, settings, MCP servers and instruction files", () => {
    expect(atom("skill:lint-check")).toMatchObject({
      metadata: { allowedTools: ["Bash(npm run lint)", "Read"], disableModelInvocation: true },
    });
    expect(atom("skill:lint-check")!.content).toContain("When to use: Before opening a pull request.");
    expect(atom("rule:testing-rules")).toMatchObject({ type: "POLICY", title: "Testing Rules", content: "Every change ships with a test.", metadata: { exportAsRule: true } });
    expect(atom("setting:permissions")?.metadata).toEqual({ settingType: "permissions", permissions: { allow: ["Bash(npm test)"], deny: ["Read(.env)"] } });
    expect(atom("setting:environment")?.metadata).toEqual({ settingType: "environment", environment: { LOG_LEVEL: "debug" } });
    expect(Object.keys((atom("setting:mcp")?.metadata as { mcpServers: object }).mcpServers)).toEqual(["github"]);
    expect(atom("doc:CLAUDE.md")).toMatchObject({ type: "FACT", title: "Project Instructions (CLAUDE.md)" });
    expect(atom("doc:AGENTS.md")?.content).toBe("Agents: follow the testing rules.");
    expect(plan.notes.map((note) => note.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("settings.local.json holds personal settings"), "1 file was not part of a Claude Code project setup and was ignored."])
    );
  });

  it("produces a graph that compiles and passes the build gate", () => {
    const atoms = plan.atoms.map((item) => ({ id: item.key, type: item.type, title: item.title, content: item.content, metadata: item.metadata }));
    const edges = plan.edges.map((edge, index) => ({ id: `e${index}`, sourceAtomId: edge.source, targetAtomId: edge.target, label: edge.label, metadata: edge.metadata }));
    const gate = evaluateBuildGate(atoms, edges);
    expect(gate.errors).toEqual([]);
    expect(compile({ atoms, edges }).ir.agents[0].config?.allowedTools).toEqual(["Read", "Grep", "Bash(git diff:*)"]);
  });

  it("reads plugins: manifest name and top-level agents and skills", () => {
    const plugin = importClaudeProject([
      file(".claude-plugin/plugin.json", JSON.stringify({ name: "release-kit", description: "Release helpers" })),
      file("agents/releaser.md", "---\nname: releaser\ndescription: Cuts releases.\n---\nTag and publish."),
      file("skills/changelog/SKILL.md", "---\nname: changelog\ndescription: Writes the changelog.\n---\nSummarize merged PRs."),
    ]);
    expect(plugin).toMatchObject({ name: "Release Kit", description: "Release helpers" });
    expect(plugin.atoms.map((item) => item.key).sort()).toEqual(["agent:releaser", "skill:changelog"]);
  });

  it("warns on invalid YAML and on projects with nothing to import", () => {
    const broken = importClaudeProject([file(".claude/agents/bad.md", "---\nname: [unclosed\n---\nBody")]);
    expect(broken.atoms).toEqual([]);
    expect(broken.notes[0]).toEqual({
      level: "warning",
      message: "Claude Code doesn't load this file as an agent, so it was not imported: the frontmatter doesn't parse.",
      path: ".claude/agents/bad.md",
    });
    expect(importClaudeProject([file("README.md", "hi")]).notes.map((note) => note.message)).toContain(
      "No agents, skills, rules, settings or instructions were found."
    );
  });
});

describe("agents folders", () => {
  const agent = (name: string, extra = "") => `---\nname: ${name}\ndescription: The ${name} agent.\n${extra}---\nWork carefully.\n`;
  const stub = (name: string) => `---\nname: ${name}\ndescription: A stub with no closing line.\n`;

  it("imports agents in subfolders, as Claude Code loads them", () => {
    const plan = importClaudeProject([
      file(".claude/agents/core/coder.md", agent("coder")),
      file(".claude/agents/core/review/reviewer.md", agent("reviewer")),
      file(".claude/agents/planner.md", agent("planner")),
    ]);
    expect(plan.atoms.map((atom) => [atom.key, atom.source])).toEqual([
      ["agent:coder", ".claude/agents/core/coder.md"],
      ["agent:reviewer", ".claude/agents/core/review/reviewer.md"],
      ["agent:planner", ".claude/agents/planner.md"],
    ]);
    expect(plan.atoms[0].content).toBe("The coder agent.\n\nWork carefully.");
  });

  it("reports the files Claude Code skips, grouped by reason, and imports none of them", () => {
    const plan = importClaudeProject([
      file(".claude/agents/ok.md", agent("ok")),
      ...["a", "b", "c", "d"].map((name) => file(`.claude/agents/stubs/${name}.md`, stub(name))),
      file(".claude/agents/no-description.md", "---\nname: no-description\n---\nBody.\n"),
      file(".claude/agents/list-hooks.md", agent("list-hooks", "hooks: []\n")),
      file(".claude/agents/README.md", "# Our agents\n\nNotes for people.\n"),
    ]);
    expect(plan.atoms.map((atom) => atom.key)).toEqual(["agent:ok"]);
    // In path order, one note per reason.
    expect(plan.notes).toEqual([
      { level: "info", message: "Claude Code doesn't load this file as an agent, so it was not imported: there's no frontmatter, so it reads as documentation.", path: ".claude/agents/README.md" },
      { level: "warning", message: "Claude Code doesn't load this file as an agent, so it was not imported: hooks isn't a map of hook events.", path: ".claude/agents/list-hooks.md" },
      { level: "warning", message: "Claude Code doesn't load this file as an agent, so it was not imported: there's a name but no description.", path: ".claude/agents/no-description.md" },
      {
        level: "warning",
        message:
          "Claude Code doesn't load 4 files in agents folders, so they were not imported: the frontmatter isn't closed with --- (.claude/agents/stubs/a.md, .claude/agents/stubs/b.md, .claude/agents/stubs/c.md and 1 more).",
      },
    ]);
  });

  it("keeps the first of two files with the same agent name", () => {
    const plan = importClaudeProject([
      file(".claude/agents/v3/memory.md", agent("memory-manager")),
      file(".claude/agents/hive/memory.md", agent("memory-manager")),
    ]);
    expect(plan.atoms.map((atom) => atom.source)).toEqual([".claude/agents/hive/memory.md"]);
    expect(plan.notes).toEqual([
      { level: "warning", message: ".claude/agents/hive/memory.md already uses this agent name, so this file was not imported.", path: ".claude/agents/v3/memory.md" },
    ]);
  });

  it("lists what was left out before what was changed", () => {
    const plan = importClaudeProject([file(".claude/agents/a-extra.md", agent("a-extra", "category: misc\n")), file(".claude/agents/z-stub.md", stub("z-stub"))]);
    expect(plan.notes.map((note) => note.message)).toEqual([
      "Claude Code doesn't load this file as an agent, so it was not imported: the frontmatter isn't closed with ---.",
      "Unknown frontmatter keys were dropped: category.",
    ]);
  });

  it("reads a plugin's agents in subfolders too", () => {
    const plan = importClaudeProject([
      file(".claude-plugin/plugin.json", JSON.stringify({ name: "kit" })),
      file("agents/release/releaser.md", agent("releaser")),
    ]);
    expect(plan.atoms.map((atom) => atom.key)).toEqual(["agent:releaser"]);
  });
});

describe("Jev-graded rubric gates", () => {
  const atoms = [
    { id: "lead", type: "AGENT_CLASS", title: "Lead", content: "Leads the build.", metadata: null },
    { id: "build", type: "STAGE", title: "Build", content: "Build.", metadata: { kind: "CONSTRUCTION" } },
    {
      id: "quality",
      type: "GATE",
      title: "Quality",
      content: "Quality.",
      metadata: {
        gateType: "OUTCOME_RUBRIC",
        rubric: { criteria: ["Has tests"], grader: "jev", minProbability: 0.8, model: "jev-1.13.0" },
      },
    },
  ];
  const edges = [
    { id: "e1", sourceAtomId: "lead", targetAtomId: "build", label: "ASSIGNED_TO", metadata: { role: "LEAD" } },
    { id: "e2", sourceAtomId: "build", targetAtomId: "quality", label: "GATED_BY" },
  ];

  it("keep their grader through export and import", () => {
    const { files } = claudeCodeAdapter.emit(compile({ atoms, edges }, { name: "Graded" }).ir);
    const manifest = JSON.stringify({ blueprint: { name: "Graded" } });
    const plan = importClaudeProject([
      ...Object.entries(files).map(([path, content]) => ({ path, content })),
      file(".context-canvas/manifest.json", manifest),
    ]);
    expect(plan.atoms.find((item) => item.key === "gate:quality")?.metadata).toEqual({
      gateType: "OUTCOME_RUBRIC",
      blocking: true,
      rubric: { criteria: ["Has tests"], grader: "jev", model: "jev-1.13.0", minProbability: 0.8 },
    });
  });

  it("are described in AGENTS.md", () => {
    const { files } = agentsMdAdapter.emit(compile({ atoms, edges }, { name: "Graded" }).ir);
    expect(files["AGENTS.md"]).toContain("Graded by Jev (TypeSafe AI): each criterion needs probability 0.8 or higher.");
  });
});
