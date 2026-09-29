import { describe, expect, it } from "vitest";
import { isKnownClaudeCodeTool, lintClaudeCodeTools } from "../tools";
import { compile } from "../../../ir/compile";

describe("isKnownClaudeCodeTool", () => {
  it.each(["Read", "Bash", "WebFetch", "Bash(npm run *)", "WebFetch(domain:example.com)", "mcp__github", "mcp__github__create_issue", "mcp__github__*"])(
    "accepts %s",
    (tool) => expect(isKnownClaudeCodeTool(tool)).toBe(true)
  );

  it.each(["SheetQuery", "Calendar", "read", "Delete", "mcp_github", "Bash npm"])("rejects %s", (tool) =>
    expect(isKnownClaudeCodeTool(tool)).toBe(false)
  );
});

describe("lintClaudeCodeTools", () => {
  it("warns once per atom and tool, attributing agents and skills", () => {
    const { ir } = compile({
      atoms: [
        { id: "a", type: "AGENT_CLASS", title: "Analyst", content: "x", metadata: { allowedTools: ["Read", "SheetQuery", "SheetQuery"] } },
        { id: "s", type: "SKILL", title: "Plan", content: "x", metadata: { allowedTools: ["Calendar"] } },
      ],
      edges: [],
    });

    const findings = lintClaudeCodeTools(ir);

    expect(findings.map((d) => [d.atomId, d.code, d.severity])).toEqual([
      ["a", "UNKNOWN_TOOL", "warning"],
      ["s", "UNKNOWN_TOOL", "warning"],
    ]);
    expect(findings[0].message).toContain('"SheetQuery"');
  });
});
