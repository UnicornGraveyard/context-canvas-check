import { describe, expect, it } from "vitest";
import { compile } from "../../ir/compile";
import { evaluateBuildGate } from "../../graph/build-gate";
import {
  EMPTY_ORG_POLICY,
  isEmptyOrgPolicy,
  lintOrgPolicy,
  ORG_POLICY_PRESETS,
  orgPolicySchema,
  toolMatches,
  type OrgPolicy,
} from "../org-policy";

type Atom = { id: string; type: string; title: string; content: string; metadata: unknown };
type Edge = { id: string; sourceAtomId: string; targetAtomId: string; label: string; metadata?: unknown };

const atom = (id: string, type: string, title = id, metadata: unknown = null): Atom => ({ id, type, title, content: `${title} content`, metadata });
let edgeCount = 0;
const edge = (sourceAtomId: string, targetAtomId: string, label: string, metadata?: unknown): Edge => ({
  id: `e${(edgeCount += 1)}`,
  sourceAtomId,
  targetAtomId,
  label,
  ...(metadata === undefined ? {} : { metadata }),
});

const policy = (rules: Record<string, unknown>, enforcement: "block" | "warn" = "block"): OrgPolicy =>
  orgPolicySchema.parse({ enforcement, rules });
const codes = (diagnostics: Array<{ code: string }>) => diagnostics.map((diagnostic) => diagnostic.code).sort();

/** Agents with different settings, a release stage without approval, and a literal MCP secret. */
function graph() {
  const atoms = [
    atom("yolo", "AGENT_CLASS", "Yolo Agent", { permissionMode: "bypassPermissions", model: "opus", allowedTools: ["Bash(npm test)", "Read"] }),
    atom("careful", "AGENT_CLASS", "Careful Agent", { model: "sonnet", allowedTools: ["Read"], deniedTools: ["Bash"] }),
    atom("open", "AGENT_CLASS", "Open Agent"),
    atom("build", "STAGE", "Build", { kind: "CONSTRUCTION" }),
    atom("release", "STAGE", "Release", { kind: "RELEASE" }),
    atom("check", "GATE", "Tests", { gateType: "CHECK", command: "npm test" }),
    atom("mcp", "SETTING", "Tracker", {
      settingType: "mcp",
      mcpServers: { tracker: { type: "http", url: "https://mcp.example", headers: { Authorization: "Bearer sk-live-123" } } },
    }),
  ];
  const edges = [
    edge("build", "release", "NEXT"),
    edge("yolo", "build", "ASSIGNED_TO", { role: "LEAD" }),
    edge("careful", "release", "ASSIGNED_TO", { role: "LEAD" }),
    edge("release", "check", "GATED_BY"),
  ];
  return { atoms, edges };
}

const irOf = (g = graph()) => compile(g).ir;

describe("toolMatches", () => {
  it("matches a tool, its specifiers and wildcard prefixes", () => {
    expect(toolMatches("Bash", "Bash")).toBe(true);
    expect(toolMatches("Bash", "Bash(npm test)")).toBe(true);
    expect(toolMatches("Bash", "BashOutput")).toBe(false);
    expect(toolMatches("mcp__prod__*", "mcp__prod__query")).toBe(true);
    expect(toolMatches("mcp__prod__*", "mcp__staging__query")).toBe(false);
  });
});

describe("lintOrgPolicy", () => {
  it("finds nothing under the empty policy", () => {
    expect(isEmptyOrgPolicy(EMPTY_ORG_POLICY)).toBe(true);
    expect(lintOrgPolicy(irOf(), EMPTY_ORG_POLICY)).toEqual([]);
  });

  it("flags forbidden permission modes on the agent", () => {
    const found = lintOrgPolicy(irOf(), policy({ forbiddenPermissionModes: ["bypassPermissions"] }));
    expect(found).toEqual([
      expect.objectContaining({ code: "POLICY_PERMISSION_MODE", severity: "error", atomId: "yolo", message: expect.stringContaining("Yolo Agent") }),
    ]);
  });

  it("allows only listed models and lets agents without a model inherit", () => {
    const found = lintOrgPolicy(irOf(), policy({ allowedModels: ["Sonnet", "haiku"] }));
    expect(found.map((diagnostic) => diagnostic.atomId)).toEqual(["yolo"]);
    expect(found[0].message).toContain("opus");
  });

  it("forbids tools that are granted or not ruled out", () => {
    const found = lintOrgPolicy(irOf(), policy({ forbiddenTools: ["Bash"] }));
    // Yolo is granted Bash(npm test); Open lists no tools; Careful denies Bash.
    expect(found.map((diagnostic) => diagnostic.atomId).sort()).toEqual(["open", "yolo"]);
    expect(found.find((diagnostic) => diagnostic.atomId === "open")?.message).toContain("lists no tools");
  });

  it("does not treat denying one Bash form as denying Bash", () => {
    const g = graph();
    g.atoms = [atom("narrow", "AGENT_CLASS", "Narrow", { deniedTools: ["Bash(rm *)"] })];
    g.edges = [];
    expect(codes(lintOrgPolicy(compile(g).ir, policy({ forbiddenTools: ["Bash"] })))).toEqual(["POLICY_TOOL_FORBIDDEN"]);
  });

  it("checks lifecycle stage kinds and approval gates", () => {
    const found = lintOrgPolicy(
      irOf(),
      policy({ requireLifecycle: true, requiredStageKinds: ["VERIFICATION", "RELEASE"], approvalRequiredForStageKinds: ["RELEASE"] })
    );
    expect(codes(found)).toEqual(["POLICY_APPROVAL_REQUIRED", "POLICY_STAGE_KIND_MISSING"]);
    expect(found.find((diagnostic) => diagnostic.code === "POLICY_STAGE_KIND_MISSING")?.message).toContain("VERIFICATION");
    expect(found.find((diagnostic) => diagnostic.code === "POLICY_APPROVAL_REQUIRED")?.atomId).toBe("release");

    const noStages = { atoms: [atom("solo", "AGENT_CLASS", "Solo")], edges: [] };
    expect(codes(lintOrgPolicy(compile(noStages).ir, policy({ requireLifecycle: true, requiredStageKinds: ["VERIFICATION"] })))).toEqual([
      "POLICY_LIFECYCLE_REQUIRED",
      "POLICY_STAGE_KIND_MISSING",
    ]);
  });

  it("accepts a blocking human approval gate and rejects a non-blocking one", () => {
    const withGate = (blocking: boolean) => {
      const g = graph();
      g.atoms.push(atom("approve", "GATE", "Release approval", { gateType: "HUMAN_APPROVAL", blocking }));
      g.edges.push(edge("release", "approve", "GATED_BY"));
      return codes(lintOrgPolicy(compile(g).ir, policy({ approvalRequiredForStageKinds: ["RELEASE"] })));
    };
    expect(withGate(true)).toEqual([]);
    expect(withGate(false)).toEqual(["POLICY_APPROVAL_REQUIRED"]);
  });

  it("turns literal MCP secrets and agent counts into violations", () => {
    expect(codes(lintOrgPolicy(irOf(), policy({ forbidLiteralSecrets: true, maxAgents: 2 })))).toEqual([
      "POLICY_LITERAL_SECRET",
      "POLICY_TOO_MANY_AGENTS",
    ]);
  });

  it("reports warnings instead of errors when enforcement is warn", () => {
    const found = lintOrgPolicy(irOf(), policy({ forbiddenPermissionModes: ["bypassPermissions"] }, "warn"));
    expect(found.map((diagnostic) => diagnostic.severity)).toEqual(["warning"]);
  });
});

describe("build gate with a policy", () => {
  it("blocks on violations of a blocking policy and only warns otherwise", () => {
    const { atoms, edges } = graph();
    const baseline = evaluateBuildGate(atoms, edges);
    const blocked = evaluateBuildGate(atoms, edges, { policy: policy({ forbiddenPermissionModes: ["bypassPermissions"] }) });
    expect(blocked.valid).toBe(false);
    expect(blocked.errors.length).toBe(baseline.errors.length + 1);
    expect(blocked.errors.at(-1)).toMatchObject({ code: "POLICY_PERMISSION_MODE", atomId: "yolo" });

    const warned = evaluateBuildGate(atoms, edges, { policy: policy({ forbiddenPermissionModes: ["bypassPermissions"] }, "warn") });
    expect(warned.errors.length).toBe(baseline.errors.length);
    expect(codes(warned.warnings)).toContain("POLICY_PERMISSION_MODE");
  });

  it("ships presets that parse and are not empty", () => {
    expect(ORG_POLICY_PRESETS.map((preset) => preset.id)).toEqual(["baseline", "governed-lifecycle"]);
    for (const preset of ORG_POLICY_PRESETS) {
      expect(orgPolicySchema.parse(preset.policy)).toEqual(preset.policy);
      expect(isEmptyOrgPolicy(preset.policy)).toBe(false);
    }
  });
});
