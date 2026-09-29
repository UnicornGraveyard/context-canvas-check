import { describe, expect, it } from "vitest";
import { checkConfig, compareToBaseline, configFingerprint, buildConfigModel, type ConfigFile, type ConfigSnapshot } from "../index";

// Each case reproduces the mechanism of a verified public report
// (docs/research/option-c), plus look-alikes the check must leave alone.

const file = (path: string, kind: ConfigFile["kind"], content: string, scope: ConfigFile["scope"] = "project", nested?: boolean): ConfigFile => ({ path, kind, content, scope, ...(nested ? { nested } : {}) });
const settings = (data: unknown, path = ".claude/settings.json", scope: ConfigFile["scope"] = "project") => file(path, "settings", JSON.stringify(data, null, 2), scope);
const findings = (snapshot: ConfigSnapshot, check?: string) => checkConfig(snapshot, { now: "2026-09-27T00:00:00.000Z" }).findings.filter((finding) => !check || finding.check === check);

describe("file-does-not-parse", () => {
  it("reports settings that aren't valid JSON (R04)", () => {
    const [finding] = findings({ files: [file(".claude/settings.json", "settings", '{ "permissions": { "deny": ["Read(./.env)",] } }')] }, "file-does-not-parse");
    expect(finding).toMatchObject({ severity: "error", file: ".claude/settings.json" });
    expect(finding.message).toContain("ignores everything in it");
  });
});

describe("mcp-enabled-and-disabled (R07)", () => {
  it("flags a server in both lists, across files", () => {
    const result = findings({
      files: [settings({ enabledMcpjsonServers: ["docs", "github"] }, ".claude/settings.local.json", "local"), settings({ disabledMcpjsonServers: ["docs"] })],
    }, "mcp-enabled-and-disabled");
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('"docs"');
    expect(result[0].message).toContain("won't load");
  });
  it("leaves separate lists alone", () => {
    expect(findings({ files: [settings({ enabledMcpjsonServers: ["github"], disabledMcpjsonServers: ["docs"] })] }, "mcp-enabled-and-disabled")).toEqual([]);
  });
});

describe("settings-in-parent-folder (R09)", () => {
  it("flags a project settings file above the start folder, with what it would have applied", () => {
    const [finding] = findings({
      files: [settings({ permissions: { deny: ["Read(./.env)", "Bash(rm -rf:*)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] } }, "../../.claude/settings.json", "ancestor")],
    }, "settings-in-parent-folder");
    expect(finding.severity).toBe("warning");
    expect(finding.message).toContain("2 permission rules and 1 hook");
    expect(finding.fix).toContain("Start Claude Code in ../..");
  });
  it("leaves the start folder's own settings alone", () => {
    expect(findings({ files: [settings({ permissions: { deny: ["Read(./.env)"] } })] }, "settings-in-parent-folder")).toEqual([]);
  });
});

describe("allow-rule-protected-path (R10)", () => {
  it("flags allow rules that target protected paths", () => {
    const result = findings({
      files: [settings({ permissions: { allow: ["Edit(.claude/**)", "Write(.git/hooks/pre-commit)", "Edit(~/.zshrc)", "Edit(src/**)", "Edit(.claude/worktrees/**)", "Read(.claude/**)"] } })],
    }, "allow-rule-protected-path");
    expect(result.map((finding) => finding.message)).toEqual([
      "Allow rule Edit(.claude/**) can't pre-approve writes to .claude, a protected path.",
      "Allow rule Write(.git/hooks/pre-commit) can't pre-approve writes to .git, a protected path.",
      "Allow rule Edit(~/.zshrc) can't pre-approve writes to .zshrc, a protected path.",
    ]);
  });
  it("treats a single-slash path in user settings as inside ~/.claude", () => {
    const result = findings({ files: [settings({ permissions: { allow: ["Edit(/agents/**)"] } }, "~/.claude/settings.json", "user")] }, "allow-rule-protected-path");
    expect(result).toHaveLength(1);
  });
});

const agent = (path: string, content: string, scope: ConfigFile["scope"] = "project") => file(path, "agent", content, scope);

describe("agent-unknown-field (R11)", () => {
  it("flags allowed-tools on an agent and says it gets every tool", () => {
    const [finding] = findings({ files: [agent(".claude/agents/reviewer.md", "---\nname: reviewer\ndescription: Reviews code.\nallowed-tools: Read, Grep\n---\nReview.\n")] }, "agent-unknown-field");
    expect(finding.message).toContain("allowed-tools");
    expect(finding.detail).toContain("can use every tool");
    expect(finding.fix).toBe("Rename allowed-tools to tools.");
    expect(finding.line).toBe(4);
  });
  it("suggests the camelCase name for near misses", () => {
    const [finding] = findings({ files: [agent(".claude/agents/a.md", "---\nname: a\ndescription: A.\nmax_turns: 5\n---\n")] }, "agent-unknown-field");
    expect(finding.fix).toBe("Rename max_turns to maxTurns.");
  });
  it("notes other unknown fields and ignores x- extensions", () => {
    const result = findings({ files: [agent(".claude/agents/a.md", "---\nname: a\ndescription: A.\nteam: core\npriority: high\nx-owner: platform\n---\n")] }, "agent-unknown-field");
    expect(result.map((finding) => [finding.severity, finding.message])).toEqual([["info", 'Agent "a" has 2 fields Claude Code ignores: team, priority.']]);
  });
  it("accepts every documented field", () => {
    const fm = "name: a\ndescription: A.\ntools: Read\ndisallowedTools: Bash\nmodel: sonnet\npermissionMode: plan\nmaxTurns: 3\nskills: [x]\nmcpServers: [github]\nmemory: project\nbackground: false\nomitClaudeMd: true\neffort: high\nisolation: worktree\ncolor: blue\ninitialPrompt: hi\n";
    expect(findings({ files: [agent(".claude/agents/a.md", `---\n${fm}---\n`)] }, "agent-unknown-field")).toEqual([]);
  });
});

describe("agent-not-loaded (R16)", () => {
  const problems = (content: string) => findings({ files: [agent(".claude/agents/a.md", content)] }, "agent-not-loaded");
  it("flags hooks written as a list", () => {
    const [finding] = problems("---\nname: a\ndescription: A.\nhooks: []\n---\n");
    expect(finding).toMatchObject({ severity: "error", line: 4 });
    expect(finding.message).toContain("a list");
  });
  it("flags the documented skip conditions", () => {
    expect(problems("---\nname: a\n---\n")[0].message).toContain("no description");
    expect(problems("---\nname: team:a\ndescription: A.\n---\n")[0].message).toContain("can't start with - or contain :");
    expect(problems("---\nname: a\ndescription: [unclosed\n---\n")[0].message).toContain("doesn't parse");
    expect(problems("---\nname: a\ndescription: A.\n")[0].fix).toBe("Add a closing --- line after the last frontmatter field.");
    expect(problems("\n---\nname: a\ndescription: A.\n---\n")[0].message).toContain("doesn't start on the first line");
    expect(problems("---\ndescription: A.\ntools: Read\n---\n")[0]).toMatchObject({ severity: "warning" });
  });
  it("leaves documentation and valid agents alone", () => {
    expect(problems("# Our agents\n\nNotes for the team.\n")).toEqual([]);
    expect(problems("---\nname: a\ndescription: A.\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: x\n---\n")).toEqual([]);
  });
});

describe("agent-reference-unresolved (R12)", () => {
  const plugin = (agentRef: string): ConfigSnapshot => ({
    pluginName: "deploy-tools",
    files: [
      agent("agents/reviewer.md", "---\nname: reviewer\ndescription: Reviews.\n---\n", "plugin"),
      file("skills/review/SKILL.md", "skill", `---\nname: review\ndescription: Review.\ncontext: fork\nagent: ${agentRef}\n---\n`, "plugin"),
    ],
  });
  it("tells plugin authors to use the namespaced name", () => {
    const [finding] = findings(plugin("reviewer"), "agent-reference-unresolved");
    expect(finding.message).toContain('"deploy-tools:reviewer"');
    expect(finding.fix).toBe("Set agent to deploy-tools:reviewer.");
  });
  it("accepts namespaced, built-in and project agents", () => {
    expect(findings(plugin("deploy-tools:reviewer"), "agent-reference-unresolved")).toEqual([]);
    expect(findings(plugin("Explore"), "agent-reference-unresolved")).toEqual([]);
  });
  it("marks a missing project agent as info when user agents weren't checked", () => {
    const [finding] = findings({ files: [file(".claude/skills/s/SKILL.md", "skill", "---\nname: s\ndescription: S.\nagent: ghost\n---\n")] }, "agent-reference-unresolved");
    expect(finding.severity).toBe("info");
    expect(finding.message).toContain("user agents weren't checked");
  });
});

describe("ask-rule-overrides-hook (R37)", () => {
  it("notes ask rules a PreToolUse hook can't approve", () => {
    const [finding] = findings({
      files: [settings({ permissions: { ask: ["Bash(rm:*)", "Bash(rmdir:*)", "Edit(docs/**)"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node .claude/hooks/allow-safe-rm.mjs" }] }] } })],
    }, "ask-rule-overrides-hook");
    expect(finding.severity).toBe("info");
    expect(finding.message).toContain("Bash(rm:*), Bash(rmdir:*)");
    expect(finding.message).not.toContain("Edit(docs/**)");
  });
  it("ignores hooks whose matcher doesn't cover the ask rules", () => {
    expect(findings({ files: [settings({ permissions: { ask: ["Bash(rm:*)"] }, hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "fmt" }] }] } })] }, "ask-rule-overrides-hook")).toEqual([]);
  });
});

describe("single-slash-path (R39)", () => {
  it("flags single-slash paths in user settings, which anchor at ~/.claude", () => {
    const [finding] = findings({ files: [settings({ permissions: { deny: ["Read(/Users/alice/.ssh/**)"] } }, "~/.claude/settings.json", "user")] }, "single-slash-path");
    expect(finding.message).toBe("Deny rule Read(/Users/alice/.ssh/**) points at ~/.claude/Users/alice/.ssh/**, not /Users/alice/.ssh/**.");
    expect(finding.fix).toContain("//Users/alice/.ssh/**");
  });
  it("flags absolute-looking paths in project settings, and leaves project-relative ones alone", () => {
    const result = findings({ files: [settings({ permissions: { deny: ["Read(/etc/passwd)", "Edit(/src/**)", "Read(//Users/alice/secrets/**)"] } })] }, "single-slash-path");
    expect(result.map((finding) => finding.message)).toEqual(["Deny rule Read(/etc/passwd) points at <project>/etc/passwd, not /etc/passwd."]);
  });
});

describe("nested-claude-md (R41)", () => {
  it("warns when a subfolder CLAUDE.md holds rules, and notes it otherwise", () => {
    const result = findings({
      files: [
        file("CLAUDE.md", "instructions", "# Root\n"),
        file("infra/CLAUDE.md", "instructions", "Never run terraform apply.\n", "project", true),
        file("docs/CLAUDE.md", "instructions", "Docs use sentence case.\n", "project", true),
      ],
    }, "nested-claude-md");
    expect(result.map((finding) => [finding.file, finding.severity])).toEqual([["infra/CLAUDE.md", "warning"], ["docs/CLAUDE.md", "info"]]);
  });
});

describe("config-drift (R06, R36, R40)", () => {
  const before: ConfigSnapshot = {
    files: [
      settings({ permissions: { allow: ["Bash(npm test)"], deny: ["Read(./.env)"] }, env: { A: "1" }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] } }, "~/.claude/settings.json", "user"),
      file(".mcp.json", "mcp", JSON.stringify({ mcpServers: { docs: { type: "http", url: "https://x", headers: { Authorization: "Bearer sk-live-SECRET" } } } })),
    ],
  };
  const baseline = configFingerprint(buildConfigModel(before), "2026-09-20T00:00:00.000Z");

  it("reports removed guards, new allow rules, wiped keys and new servers", () => {
    const after: ConfigSnapshot = {
      files: [
        settings({ permissions: { allow: ["Bash(npm test)", "Bash(curl:*)"] } }, "~/.claude/settings.json", "user"),
        file(".mcp.json", "mcp", JSON.stringify({ mcpServers: { docs: { type: "http", url: "https://x", headers: { Authorization: "Bearer sk-live-SECRET" } }, extra: { type: "stdio", command: "npx" } } })),
      ],
    };
    const messages = checkConfig(after, { baseline, now: "2026-09-27T00:00:00.000Z" }).findings.filter((finding) => finding.check === "config-drift").map((finding) => `${finding.severity}: ${finding.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      "warning: A PreToolUse [Bash] hook was removed in ~/.claude/settings.json since 2026-09-20: `guard.sh`.",
      "warning: The allow rule Bash(curl:*) was added in ~/.claude/settings.json since 2026-09-20.",
      "warning: The deny rule Read(./.env) was removed in ~/.claude/settings.json since 2026-09-20.",
      "warning: ~/.claude/settings.json lost settings since 2026-09-20: env, hooks.",
      'warning: MCP server "extra" was added in .mcp.json since 2026-09-20.',
    ]));
  });

  it("stores no secret values in the baseline", () => {
    expect(JSON.stringify(baseline)).not.toContain("sk-live-SECRET");
  });

  it("reports nothing when nothing changed", () => {
    expect(compareToBaseline(baseline, configFingerprint(buildConfigModel(before), "2026-09-27T00:00:00.000Z"))).toEqual([]);
  });
});
