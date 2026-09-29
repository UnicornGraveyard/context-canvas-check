import { describe, expect, it } from "vitest";
import { compile } from "../../../ir/compile";
import { claudeCodeAdapter } from "../index";
import { parseFrontmatter } from "../frontmatter";

type Atom = { id: string; type: string; title: string; content: string; metadata: unknown };
const atom = (id: string, type: string, title: string, metadata: unknown = null): Atom => ({ id, type, title, content: `${title} does its job.`, metadata });
const edge = (sourceAtomId: string, targetAtomId: string, label: string) => ({ id: `${sourceAtomId}-${label}-${targetAtomId}`, sourceAtomId, targetAtomId, label });

function emit(atoms: Atom[], edges: ReturnType<typeof edge>[] = []) {
  const { ir } = compile({ atoms, edges });
  return { ir, ...claudeCodeAdapter.emit(ir), lint: claudeCodeAdapter.lint(ir) };
}

describe("Claude Code adapter v2: agents", () => {
  it("writes the full agent frontmatter, including full model IDs", () => {
    const { files } = emit([
      atom("a", "AGENT_CLASS", "Release Captain", {
        model: "claude-opus-5",
        permissionMode: "acceptEdits",
        effort: "high",
        memory: "project",
        isolation: "worktree",
        background: true,
        color: "purple",
        initialPrompt: "Check the release checklist.",
      }),
    ]);
    const frontmatter = parseFrontmatter(files[".claude/agents/release-captain.md"]);
    expect(frontmatter).toMatchObject({
      name: "release-captain",
      model: "claude-opus-5",
      permissionMode: "acceptEdits",
      effort: "high",
      memory: "project",
      isolation: "worktree",
      background: true,
      color: "purple",
      initialPrompt: "Check the release checklist.",
    });
  });

  it("inherits new settings from parents unless the child overrides them", () => {
    const { files } = emit(
      [atom("base", "AGENT_CLASS", "Base", { effort: "low", color: "blue" }), atom("child", "AGENT_CLASS", "Child", { color: "red" })],
      [edge("child", "base", "EXTENDS")]
    );
    expect(parseFrontmatter(files[".claude/agents/child.md"])).toMatchObject({ effort: "low", color: "red" });
  });

  it("gives agent-scoped MCP servers and bare denies to that agent only", () => {
    const { files } = emit(
      [
        atom("t", "AGENT_CLASS", "Tester", { deniedTools: ["Write"] }),
        atom("other", "AGENT_CLASS", "Other"),
        atom("mcp", "SETTING", "Browser", { settingType: "mcp", mcpServers: { playwright: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"] } } }),
        atom("perm", "SETTING", "Tester Limits", { settingType: "permissions", permissions: { allow: [], deny: ["WebFetch", "Bash(rm *)"] } }),
      ],
      [edge("mcp", "t", "CONFIGURES"), edge("perm", "t", "CONFIGURES")]
    );
    const tester = parseFrontmatter(files[".claude/agents/tester.md"]);
    expect(tester?.mcpServers).toEqual([{ playwright: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"] } }]);
    expect(tester?.disallowedTools).toBe("Write, WebFetch");
    expect(parseFrontmatter(files[".claude/agents/other.md"])?.mcpServers).toBeUndefined();
    expect(files[".mcp.json"]).toBeUndefined();
    expect(JSON.parse(files[".claude/settings.json"]).permissions.deny).toEqual(["Bash(rm *)"]);
  });

  it("no longer writes the non-standard settings.scopes.json", () => {
    const { files } = emit(
      [atom("t", "AGENT_CLASS", "Tester"), atom("env", "SETTING", "Env", { settingType: "environment", environment: { LOG_LEVEL: "debug" } })],
      [edge("env", "t", "CONFIGURES")]
    );
    expect(Object.keys(files).some((path) => path.includes("settings.scopes"))).toBe(false);
    expect(JSON.parse(files[".claude/settings.json"]).env).toEqual({ LOG_LEVEL: "debug" });
  });
});

describe("Claude Code adapter v2: skills", () => {
  it("writes invocation, context and path settings, and scoped allow rules as allowed-tools", () => {
    const { files } = emit(
      [
        atom("s", "SKILL", "Deploy", { disableModelInvocation: true, context: "fork", agent: "Explore", paths: ["infra/**", "*.tf"], allowedTools: ["Read"] }),
        atom("perm", "SETTING", "Deploy Access", { settingType: "permissions", permissions: { allow: ["Bash(terraform plan:*)"], deny: [] } }),
      ],
      [edge("perm", "s", "CONFIGURES")]
    );
    expect(parseFrontmatter(files[".claude/skills/deploy/SKILL.md"])).toMatchObject({
      "disable-model-invocation": true,
      context: "fork",
      agent: "Explore",
      paths: "infra/**,*.tf",
      "allowed-tools": "Read, Bash(terraform plan:*)",
    });
  });
});

describe("Claude Code adapter v2: fidelity and lint", () => {
  it("reports what cannot be expressed natively", () => {
    const { fidelity } = emit(
      [
        atom("t", "AGENT_CLASS", "Tester"),
        atom("perm", "SETTING", "Tester Allow", { settingType: "permissions", permissions: { allow: ["Bash"], deny: [] } }),
        atom("env", "SETTING", "Env", { settingType: "environment", environment: { A: "1" } }),
      ],
      [edge("perm", "t", "CONFIGURES"), edge("env", "t", "CONFIGURES")]
    );
    expect(fidelity.items.map((item) => [item.feature, item.level])).toEqual([
      ["Per-agent allow rules", "unsupported"],
      ["Scoped environment variables", "approximated"],
    ]);
  });

  it("reports nothing for a plain blueprint", () => {
    expect(emit([atom("a", "AGENT_CLASS", "Solo")]).fidelity.items).toEqual([]);
  });

  it("warns about literal MCP secrets but accepts ${VAR} references", () => {
    const { lint } = emit([
      atom("mcp", "SETTING", "Servers", {
        settingType: "mcp",
        mcpServers: {
          api: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-123" } },
          gh: { command: "gh-mcp", env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", LOG_LEVEL: "debug" } },
          db: { command: "db-mcp", env: { DB_PASSWORD: "hunter2" } },
        },
      }),
    ]);
    expect(lint.map((issue) => issue.message.match(/(headers|env)\.\w+/)?.[0])).toEqual(["headers.Authorization", "env.DB_PASSWORD"]);
  });
});
