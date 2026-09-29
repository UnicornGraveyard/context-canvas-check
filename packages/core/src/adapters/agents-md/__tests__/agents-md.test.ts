import { describe, expect, it } from "vitest";
import { agentsMdAdapter } from "..";
import { emitAdapters, emitTargets } from "../../registry";
import type { ExportAdapter } from "../../types";
import { compile } from "../../../ir/compile";
import type { SourceAtom, SourceEdge } from "../../../model/source";

const atom = (id: string, type: string, title: string, metadata: unknown = null, content = `${title} content`): SourceAtom => ({
  id,
  type,
  title,
  content,
  metadata,
});
const edge = (sourceAtomId: string, targetAtomId: string, label: string): SourceEdge => ({
  id: `${sourceAtomId}-${targetAtomId}`,
  sourceAtomId,
  targetAtomId,
  label,
});

const atoms = [
  atom("lead", "AGENT_CLASS", "Security Lead", { model: "opus", allowedTools: ["Read"], promptSections: { role: "Own security review." } }, "Review changes.\n\n# Checklist\n- auth"),
  atom("scan", "SKILL", "OWASP Scan", null, "Scan endpoints.\n\n## Steps\n```\n# not a heading\n```"),
  atom("rule", "POLICY", "Evidence Rule", { exportAsRule: true, preconditions: ["Findings cite files"] }, "Every finding cites evidence."),
  atom("env", "SETTING", "Env", { settingType: "environment", environment: { API_TOKEN: "super-secret-value" } }),
  atom("mcp", "SETTING", "MCP", { settingType: "mcp", mcpServers: { tracker: { command: "npx", env: { TOKEN: "mcp-secret" } } } }),
  atom("fact", "FACT", "Scope", null, "Only the API service."),
];
const edges = [edge("lead", "scan", "COMPOSES"), edge("env", "lead", "CONFIGURES")];
const { ir } = compile({ atoms, edges }, { name: "Security Team", description: "Reviews code for security issues." });

describe("agentsMdAdapter", () => {
  const { files, fidelity } = agentsMdAdapter.emit(ir);
  const doc = files["AGENTS.md"];

  it("writes one AGENTS.md with roles, procedures, rules and context", () => {
    expect(Object.keys(files)).toEqual(["AGENTS.md"]);
    expect(doc.startsWith("# Security Team\n\nReviews code for security issues.")).toBe(true);
    expect(doc).toContain("### Security Lead (`security-lead`)");
    expect(doc).toContain("- Purpose: Own security review.");
    expect(doc).toContain("- Procedures: `owasp-scan`");
    expect(doc).toContain("- Preferred model: opus");
    expect(doc).toContain("### OWASP Scan (`owasp-scan`)");
    expect(doc).toContain("### Evidence Rule");
    expect(doc).toContain("- Findings cite files");
    expect(doc).toContain("#### Scope");
  });

  it("nests embedded headings under their section, leaving code fences alone", () => {
    // Agent prompt: "## Role" (from sections) and "# Checklist" (content) keep their relative levels.
    expect(doc).toContain("#### Checklist");
    expect(doc).toContain("##### Role");
    // Skill content's shallowest heading lands one level below its ### section.
    expect(doc).toContain("#### Steps");
    expect(doc).toContain("```\n# not a heading\n```");
  });

  it("never writes secret values; lists env and MCP server names only", () => {
    expect(doc).not.toContain("super-secret-value");
    expect(doc).not.toContain("mcp-secret");
    expect(doc).toContain("`API_TOKEN`");
    expect(doc).toContain("`tracker`");
  });

  it("reports honest fidelity levels", () => {
    const levels = Object.fromEntries(fidelity.items.map((item) => [item.feature, item.level]));
    expect(levels).toMatchObject({
      "Agent roles": "advisory",
      Skills: "advisory",
      Rules: "native",
      "MCP servers": "unsupported",
      "Environment variables": "unsupported",
      "Per-agent settings": "unsupported",
    });
  });
});

describe("emitTargets", () => {
  it("merges Claude Code and AGENTS.md outputs with a report per target", () => {
    const output = emitTargets(ir, ["claude-code", "agents-md", "claude-code"]);
    expect(output.files["AGENTS.md"]).toBeDefined();
    expect(output.files["CLAUDE.md"]).toBeDefined();
    expect(output.fidelity.map((report) => report.adapterId)).toEqual(["claude-code", "agents-md"]);
    expect(output.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("keeps the first writer and reports a conflict when two targets write one path differently", () => {
    const fake = (id: string, content: string): ExportAdapter => ({
      id,
      version: "0",
      lint: () => [],
      emit: () => ({ files: { "AGENTS.md": content }, fidelity: { adapterId: id, adapterVersion: "0", items: [] } }),
    });

    const output = emitAdapters(ir, [fake("a", "first"), fake("b", "second"), fake("c", "first")]);

    expect(output.files["AGENTS.md"]).toBe("first");
    expect(output.diagnostics).toEqual([expect.objectContaining({ code: "PATH_CONFLICT", adapterId: "b", path: "AGENTS.md" })]);
  });
});
