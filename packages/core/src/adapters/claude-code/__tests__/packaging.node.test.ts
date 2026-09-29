import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compile } from "../../../ir/compile";
import { claudeCodeAdapter } from "../index";
import { parseFrontmatter } from "../frontmatter";

type Atom = { id: string; type: string; title: string; content: string; metadata: unknown };
const atom = (id: string, type: string, title: string, metadata: unknown = null): Atom => ({ id, type, title, content: `${title}.`, metadata });
const edge = (sourceAtomId: string, targetAtomId: string, label: string, metadata?: unknown) => ({
  id: `${sourceAtomId}-${label}-${targetAtomId}`,
  sourceAtomId,
  targetAtomId,
  label,
  ...(metadata ? { metadata } : {}),
});

function lifecycleBlueprint() {
  const atoms = [
    atom("planner", "AGENT_CLASS", "Planner", { permissionMode: "plan" }),
    atom("builder", "AGENT_CLASS", "Builder"),
    atom("plan", "STAGE", "Plan", { kind: "PLANNING", exitCriteria: ["done"] }),
    atom("build", "STAGE", "Build", { kind: "CONSTRUCTION" }),
    atom("approve", "GATE", "Plan approval", { gateType: "HUMAN_APPROVAL" }),
    atom("tests", "GATE", "Tests", { gateType: "CHECK", command: "exit 0" }),
    atom("rule", "POLICY", "No secrets", { exportAsRule: true }),
    atom("mcp", "SETTING", "Browser", { settingType: "mcp", mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp"] } } }),
    atom("perm", "SETTING", "Project", { settingType: "permissions", permissions: { allow: ["Read"], deny: [] } }),
  ];
  const edges = [
    edge("plan", "build", "NEXT"),
    edge("planner", "plan", "ASSIGNED_TO", { role: "LEAD" }),
    edge("builder", "build", "ASSIGNED_TO", { role: "LEAD" }),
    edge("plan", "approve", "GATED_BY"),
    edge("build", "tests", "GATED_BY"),
    edge("mcp", "builder", "CONFIGURES"),
  ];
  return compile({ atoms, edges }, { name: "Release Train", description: "Ships releases." }).ir;
}

describe("telemetry", () => {
  it("writes OTel settings tagged with the blueprint", () => {
    const { ir } = compile({ atoms: [atom("a", "AGENT_CLASS", "Solo")], edges: [] }, { name: "T" });
    const { files } = claudeCodeAdapter.emit(ir, {
      telemetry: {
        endpoint: "https://otel.example.com:4318",
        resourceAttributes: { "cc.blueprint.id": "abc", "cc.blueprint.version": "3", "cc.blueprint.name": "Release, Train" },
      },
    });
    expect(JSON.parse(files[".claude/settings.json"]).env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com:4318",
      OTEL_RESOURCE_ATTRIBUTES: "cc.blueprint.id=abc,cc.blueprint.name=Release%2C%20Train,cc.blueprint.version=3",
    });
  });

  it("rejects invalid options instead of writing broken settings", () => {
    const { ir } = compile({ atoms: [], edges: [] });
    expect(() => claudeCodeAdapter.emit(ir, { telemetry: { endpoint: "not a url" } })).toThrow();
    expect(() => claudeCodeAdapter.emit(ir, { layout: "zip" })).toThrow();
  });
});

describe("plugin layout", () => {
  const ir = lifecycleBlueprint();
  const { files, fidelity } = claudeCodeAdapter.emit(ir, { layout: "plugin", plugin: { version: "1.2.0", marketplace: true } });
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("writes a plugin manifest, marketplace entry and plugin directories", () => {
    expect(JSON.parse(files[".claude-plugin/plugin.json"])).toEqual({
      name: "release-train",
      version: "1.2.0",
      description: "Ships releases.",
      displayName: "Release Train",
    });
    expect(JSON.parse(files[".claude-plugin/marketplace.json"]).plugins).toEqual([{ name: "release-train", source: "./", description: "Ships releases." }]);
    expect(Object.keys(files).filter((path) => path.startsWith(".claude/"))).toEqual([]);
    expect(files["agents/builder.md"]).toBeDefined();
    expect(files["skills/approve-gate-plan-approval/SKILL.md"]).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs\" approve plan-approval");
  });

  it("moves what plugin agents ignore into plugin-wide files", () => {
    const builder = parseFrontmatter(files["agents/builder.md"]);
    const planner = parseFrontmatter(files["agents/planner.md"]);
    expect(builder?.hooks).toBeUndefined();
    expect(builder?.mcpServers).toBeUndefined();
    expect(planner?.permissionMode).toBeUndefined();
    expect(Object.keys(JSON.parse(files[".mcp.json"]).mcpServers)).toEqual(["playwright"]);
    expect(JSON.parse(files["hooks/hooks.json"]).hooks.PreToolUse[0].matcher).toBe("Write|Edit|MultiEdit|NotebookEdit|Bash");
    expect(files["README.md"]).toContain("## Rules");
    expect(files["README.md"]).toContain('"allow"');
    expect(fidelity.items.map((item) => item.feature)).toEqual(
      expect.arrayContaining(["Lifecycle hooks in a plugin", "Agent MCP servers in a plugin", "Permission modes in a plugin", "Project context, rules and settings in a plugin"])
    );
  });

  it("runs gates from the plugin, keeping state in the project and naming agents from hook input", () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "cc-plugin-"));
    const projectDir = mkdtempSync(join(tmpdir(), "cc-project-"));
    dirs.push(pluginRoot, projectDir);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(pluginRoot, path)), { recursive: true });
      writeFileSync(join(pluginRoot, path), content);
    }
    const run = (args: string[], stdin: unknown) =>
      spawnSync(process.execPath, [join(pluginRoot, "hooks/gate.mjs"), ...args], {
        cwd: projectDir,
        input: JSON.stringify(stdin),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: projectDir },
      });

    const blocked = run(["guard"], { agent_type: "release-train:builder", tool_name: "Write", tool_input: { file_path: "src/x.ts" } });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("/approve-gate-plan-approval");
    // The main session (no agent_type) is not guarded.
    expect(run(["guard"], { tool_name: "Write", tool_input: { file_path: "src/x.ts" } }).status).toBe(0);

    expect(run(["approve", "plan-approval"], {}).status).toBe(0);
    expect(run(["guard"], { agent_type: "release-train:builder", tool_name: "Write", tool_input: { file_path: "src/x.ts" } }).status).toBe(0);
    expect(run(["stop"], { agent_type: "release-train:builder" }).status).toBe(0);
  });
});
