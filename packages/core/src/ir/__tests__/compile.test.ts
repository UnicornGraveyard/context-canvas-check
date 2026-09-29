import { describe, expect, it } from "vitest";
import { compile } from "../compile";
import { canonicalJson, hashIR } from "../canonical";
import { validateClaudeExportCompliance } from "../../graph/compliance";
import type { SourceAtom, SourceEdge } from "../../model/source";

const atom = (id: string, type: string, title: string, metadata: unknown = null, content = `${title} content`): SourceAtom => ({
  id,
  type,
  title,
  content,
  metadata,
});
const edge = (sourceAtomId: string, targetAtomId: string, label: string): SourceEdge => ({
  id: `${sourceAtomId}->${targetAtomId}:${label}`,
  sourceAtomId,
  targetAtomId,
  label,
});

describe("compile", () => {
  const atoms = [
    atom("base", "AGENT_CLASS", "Base Reviewer", {
      model: "sonnet",
      allowedTools: ["Read", "Grep"],
      promptSections: { role: "Base role", constraints: "Base constraints" },
    }),
    atom("child", "AGENT_CLASS", "Security Reviewer", {
      allowedTools: ["Bash"],
      deniedTools: ["Grep"],
      promptSections: { role: "Security role" },
    }),
    atom("scan", "SKILL", "OWASP Scan"),
    atom("cve", "SKILL", "CVE Lookup"),
    atom("rule", "POLICY", "Evidence Rule", { exportAsRule: true }),
    atom("note", "POLICY", "Advisory Note"),
    atom("fact", "FACT", "Scope"),
  ];
  const edges = [
    edge("child", "base", "EXTENDS"),
    edge("child", "scan", "COMPOSES"),
    edge("child", "ghost", "COMPOSES"),
    edge("scan", "cve", "REQUIRES"),
  ];
  const { ir, diagnostics } = compile({ atoms, edges }, { name: "Security Team" });
  const child = ir.agents.find((agent) => agent.id === "child")!;

  it("merges EXTENDS ancestors: tools union minus denied, child sections override", () => {
    expect(diagnostics).toEqual([]);
    expect(child.ancestors.map((ancestor) => ancestor.id)).toEqual(["base"]);
    expect(child.config).toMatchObject({
      model: "sonnet",
      allowedTools: ["Read", "Bash"],
      deniedTools: ["Grep"],
      promptSections: { role: "Security role", constraints: "Base constraints" },
    });
    expect(child.config?.prompt).toContain("## Role\n\nSecurity role");
  });

  it("resolves COMPOSES plus transitive REQUIRES skills and drops missing targets", () => {
    expect(child.skillIds).toEqual(["scan", "cve"]);
    expect(child.directComposeCount).toBe(2);
  });

  it("separates exported rules from knowledge", () => {
    expect(ir.rules.map((rule) => rule.id)).toEqual(["rule"]);
    expect(ir.knowledge.map((item) => item.id)).toEqual(["note", "fact"]);
    expect(ir.blueprint).toEqual({ name: "Security Team" });
  });

  it("isolates an agent whose metadata cannot be merged", () => {
    const broken = [...atoms, atom("bad", "AGENT_CLASS", "Broken Agent", { allowedTools: 5 })];
    const result = compile({ atoms: broken, edges });
    const bad = result.ir.agents.find((agent) => agent.id === "bad")!;

    expect(bad.config).toBeNull();
    expect(bad.configError).toMatch(/iterable/);
    expect(result.ir.agents.find((agent) => agent.id === "child")?.config).not.toBeNull();

    // The build gate still reports it as a per-agent export error.
    const { errors } = validateClaudeExportCompliance(broken, edges);
    expect(errors).toContainEqual(
      expect.objectContaining({ code: "AGENT_EXPORT_INVALID", atomId: "bad" })
    );
  });
});

describe("compiled settings", () => {
  it("keeps scoped allow rules and agent-only bare denies out of the global settings", () => {
    const atoms = [
      atom("reviewer", "AGENT_CLASS", "Reviewer"),
      atom("scoped", "SETTING", "Reviewer Permissions", {
        settingType: "permissions",
        permissions: { allow: ["Bash"], deny: ["WebFetch", "Bash(rm *)"] },
      }),
      atom("global", "SETTING", "Project Permissions", {
        settingType: "permissions",
        permissions: { allow: ["Read"], deny: [] },
      }),
    ];
    const { ir } = compile({ atoms, edges: [edge("scoped", "reviewer", "CONFIGURES")] });

    // The bare deny becomes the agent's disallowedTools; the pattern deny stays global (safe direction).
    expect(ir.settings.global.permissions).toEqual({ allow: ["Read"], deny: ["Bash(rm *)"] });
    expect(ir.settings.scoped.agents.reviewer.permissions).toEqual({ allow: ["Bash"], deny: ["WebFetch", "Bash(rm *)"] });
  });

  it("sends every deny global when the setting also configures a skill", () => {
    const atoms = [
      atom("reviewer", "AGENT_CLASS", "Reviewer"),
      atom("scan", "SKILL", "Scan"),
      atom("scoped", "SETTING", "Shared Permissions", { settingType: "permissions", permissions: { allow: [], deny: ["WebFetch"] } }),
    ];
    const edges = [edge("scoped", "reviewer", "CONFIGURES"), edge("scoped", "scan", "CONFIGURES")];
    expect(compile({ atoms, edges }).ir.settings.global.permissions).toEqual({ allow: [], deny: ["WebFetch"] });
  });

  it("keeps agent-only MCP servers out of the project .mcp.json", () => {
    const server = { command: "npx", args: ["-y", "@playwright/mcp"] };
    const atoms = [
      atom("tester", "AGENT_CLASS", "Tester"),
      atom("mcp", "SETTING", "Browser", { settingType: "mcp", mcpServers: { playwright: server } }),
      atom("shared", "SETTING", "Shared", { settingType: "mcp", mcpServers: { github: { command: "gh-mcp" } } }),
    ];
    const { ir } = compile({ atoms, edges: [edge("mcp", "tester", "CONFIGURES")] });
    expect(Object.keys(ir.settings.mcpServers)).toEqual(["github"]);
    expect(ir.settings.scoped.agents.tester.mcpServers).toEqual({ playwright: server });
  });
});

// Deep copy with every object's keys in reverse insertion order.
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).reverse().map(([key, child]) => [key, reverseKeys(child)])
    );
  }
  return value;
}

describe("canonicalJson and hashIR", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("hashes equal IRs equally regardless of key order, and differently when content changes", async () => {
    const { ir } = compile({ atoms: [atom("a", "SKILL", "Scan")], edges: [] });
    const reordered = reverseKeys(ir) as typeof ir;
    const renamed = compile({ atoms: [atom("a", "SKILL", "Scan v2")], edges: [] }).ir;

    const hash = await hashIR(ir);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIR(reordered)).toBe(hash);
    expect(await hashIR(renamed)).not.toBe(hash);
  });
});
