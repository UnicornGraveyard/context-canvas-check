import "../util/zod-browser";
import { z } from "zod";
import { PERMISSION_MODES, STAGE_KINDS } from "../model/metadata";
import type { BlueprintIR, Diagnostic } from "../ir/types";
import { lintMcpSecrets } from "../adapters/claude-code/mcp-lint";

// Organization policy: rules every blueprint in an organization must meet.
// The build gate reports violations, so a blocking policy stops publishing
// and exporting until the blueprint complies.

export const orgPolicyRulesSchema = z.object({
  /** Agent permission modes nobody may use, e.g. bypassPermissions. */
  forbiddenPermissionModes: z.array(z.enum(PERMISSION_MODES)).max(PERMISSION_MODES.length).default([]),
  /**
   * Models agents may name (aliases such as "sonnet" or full ids), compared
   * case-insensitively. Empty allows any. Agents that name no model, or
   * "inherit", use the session's model and pass.
   */
  allowedModels: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  /**
   * Tools no agent may use. "Bash" also covers "Bash(npm test)"; a trailing
   * "*" matches a prefix, e.g. "mcp__prod_db__*". An agent passes when it
   * denies the tool, or lists its tools and none match.
   */
  forbiddenTools: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  /** Every blueprint must model its lifecycle as stages. */
  requireLifecycle: z.boolean().default(false),
  /** Stage kinds every lifecycle must include, e.g. VERIFICATION. */
  requiredStageKinds: z.array(z.enum(STAGE_KINDS)).max(STAGE_KINDS.length).default([]),
  /** Stages of these kinds need a blocking human approval gate. */
  approvalRequiredForStageKinds: z.array(z.enum(STAGE_KINDS)).max(STAGE_KINDS.length).default([]),
  /** MCP env and header values that look like credentials must be ${VAR} references. */
  forbidLiteralSecrets: z.boolean().default(false),
  /** Most agents a blueprint may define; null for no limit. */
  maxAgents: z.number().int().min(1).max(500).nullable().default(null),
  /** Moving a version to production needs a second person's approval. Not a build gate rule. */
  requireProductionApproval: z.boolean().default(false),
});

export const orgPolicySchema = z.object({
  version: z.literal(1).default(1),
  /** block: violations fail the build gate. warn: they are warnings. */
  enforcement: z.enum(["block", "warn"]).default("block"),
  rules: orgPolicyRulesSchema.default(orgPolicyRulesSchema.parse({})),
});

export type OrgPolicy = z.infer<typeof orgPolicySchema>;
export type OrgPolicyRules = OrgPolicy["rules"];

export const EMPTY_ORG_POLICY: OrgPolicy = orgPolicySchema.parse({});

/** Starting points for the policy editor. */
export const ORG_POLICY_PRESETS: ReadonlyArray<{ id: string; name: string; description: string; policy: OrgPolicy }> = [
  {
    id: "baseline",
    name: "Baseline",
    description: "No permission bypass and no credentials written into exported files.",
    policy: orgPolicySchema.parse({
      rules: { forbiddenPermissionModes: ["bypassPermissions"], forbidLiteralSecrets: true },
    }),
  },
  {
    id: "governed-lifecycle",
    name: "Governed lifecycle",
    description:
      "Baseline, plus every blueprint runs as a lifecycle with a verification stage, releases and operations need a person to approve, and production releases need a second person.",
    policy: orgPolicySchema.parse({
      rules: {
        forbiddenPermissionModes: ["bypassPermissions", "dontAsk"],
        forbidLiteralSecrets: true,
        requireLifecycle: true,
        requiredStageKinds: ["VERIFICATION"],
        approvalRequiredForStageKinds: ["RELEASE", "OPERATIONS"],
        requireProductionApproval: true,
      },
    }),
  },
];

/** True when the policy has no rules switched on. */
export function isEmptyOrgPolicy(policy: OrgPolicy): boolean {
  const rules = policy.rules;
  return (
    rules.forbiddenPermissionModes.length === 0 &&
    rules.allowedModels.length === 0 &&
    rules.forbiddenTools.length === 0 &&
    !rules.requireLifecycle &&
    rules.requiredStageKinds.length === 0 &&
    rules.approvalRequiredForStageKinds.length === 0 &&
    !rules.forbidLiteralSecrets &&
    rules.maxAgents === null &&
    !rules.requireProductionApproval
  );
}

/** Whether a forbidden-tool entry covers a tool rule such as "Bash(npm test)". */
export function toolMatches(entry: string, tool: string): boolean {
  if (entry.endsWith("*")) return tool.startsWith(entry.slice(0, -1));
  return tool === entry || tool.startsWith(`${entry}(`);
}

function list(values: readonly string[]): string {
  return values.join(", ");
}

/** Every way a blueprint breaks the policy, as diagnostics. */
export function lintOrgPolicy(ir: BlueprintIR, policy: OrgPolicy): Diagnostic[] {
  const severity = policy.enforcement === "block" ? "error" : "warning";
  const rules = policy.rules;
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string, atomId?: string) =>
    diagnostics.push({ code, severity, message: `Organization policy: ${message}`, ...(atomId ? { atomId } : {}) });

  const forbiddenModes = new Set<string>(rules.forbiddenPermissionModes);
  const allowedModels = new Set(rules.allowedModels.map((model) => model.toLowerCase()));

  for (const agent of ir.agents) {
    const config = agent.config;
    if (!config) continue;

    if (config.permissionMode && forbiddenModes.has(config.permissionMode)) {
      report("POLICY_PERMISSION_MODE", `agent "${agent.title}" uses permission mode ${config.permissionMode}, which is not allowed.`, agent.id);
    }

    const model = config.model?.trim();
    if (allowedModels.size > 0 && model && model !== "inherit" && !allowedModels.has(model.toLowerCase())) {
      report(
        "POLICY_MODEL_NOT_ALLOWED",
        `agent "${agent.title}" uses model ${model}. Allowed models: ${list(rules.allowedModels)}.`,
        agent.id
      );
    }

    for (const entry of rules.forbiddenTools) {
      // Denying the tool (or a wildcard that covers it) satisfies the rule; denying one form, e.g. "Bash(rm *)", does not.
      if (config.deniedTools.some((denied) => denied === entry || toolMatches(denied, entry))) continue;
      const granted = config.allowedTools.filter((tool) => toolMatches(entry, tool));
      if (granted.length > 0) {
        report("POLICY_TOOL_FORBIDDEN", `agent "${agent.title}" is allowed ${list(granted)}; ${entry} is forbidden.`, agent.id);
      } else if (config.allowedTools.length === 0) {
        report(
          "POLICY_TOOL_FORBIDDEN",
          `agent "${agent.title}" lists no tools, so it can use every tool, including ${entry}. List its tools or deny ${entry}.`,
          agent.id
        );
      }
    }
  }

  if (rules.forbiddenTools.length > 0) {
    const scopes: Array<[string, string[] | undefined]> = [
      ["project settings", ir.settings.global.permissions?.allow],
      ...Object.entries(ir.settings.scoped.agents).map(([slug, scope]): [string, string[] | undefined] => [`settings for agent ${slug}`, scope.permissions?.allow]),
      ...Object.entries(ir.settings.scoped.skills).map(([slug, scope]): [string, string[] | undefined] => [`settings for skill ${slug}`, scope.permissions?.allow]),
    ];
    for (const [where, allow] of scopes) {
      const granted = (allow ?? []).filter((tool) => rules.forbiddenTools.some((entry) => toolMatches(entry, tool)));
      if (granted.length > 0) report("POLICY_TOOL_FORBIDDEN", `${where} allow ${list(granted)}, which the policy forbids.`);
    }
  }

  if (rules.maxAgents !== null && ir.agents.length > rules.maxAgents) {
    report("POLICY_TOO_MANY_AGENTS", `the blueprint has ${ir.agents.length} agents; the limit is ${rules.maxAgents}.`);
  }

  const stages = ir.lifecycle?.stages ?? [];
  if (rules.requireLifecycle && stages.length === 0) {
    report("POLICY_LIFECYCLE_REQUIRED", "every blueprint must model its lifecycle. Add stages, or start from the AI-DLC or spec-driven template.");
  }
  if (stages.length > 0 || rules.requireLifecycle) {
    const kinds = new Set(stages.map((stage) => stage.kind));
    const missing = rules.requiredStageKinds.filter((kind) => !kinds.has(kind));
    if (missing.length > 0) {
      report("POLICY_STAGE_KIND_MISSING", `the lifecycle needs a stage of kind ${list(missing)}.`);
    }
  }
  const approvalKinds = new Set<string>(rules.approvalRequiredForStageKinds);
  for (const stage of stages) {
    if (!approvalKinds.has(stage.kind)) continue;
    const approved = stage.gates.some((gate) => gate.config?.gateType === "HUMAN_APPROVAL" && gate.config.blocking);
    if (!approved) {
      report(
        "POLICY_APPROVAL_REQUIRED",
        `stage "${stage.title}" (${stage.kind}) needs a blocking human approval gate before it hands off.`,
        stage.id
      );
    }
  }

  if (rules.forbidLiteralSecrets) {
    for (const finding of lintMcpSecrets(ir)) report("POLICY_LITERAL_SECRET", finding.message);
  }

  return diagnostics;
}
