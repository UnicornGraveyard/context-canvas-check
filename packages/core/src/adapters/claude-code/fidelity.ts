import type { BlueprintIR } from "../../ir/types";
import type { FidelityItem } from "../types";

const quote = (names: string[]) => names.map((name) => `"${name}"`).join(", ");

/**
 * How faithfully the Claude Code files carry the blueprint. Listed features
 * are the ones that are not fully native; everything else maps one-to-one.
 */
export function claudeCodeFidelity(ir: BlueprintIR): FidelityItem[] {
  const items: FidelityItem[] = [];
  const { agents, skills } = ir.settings.scoped;

  const agentAllow = Object.entries(agents).filter(([, scope]) => (scope.permissions?.allow.length ?? 0) > 0);
  if (agentAllow.length > 0) {
    items.push({
      feature: "Per-agent allow rules",
      irPath: "settings.scoped.agents[].permissions.allow",
      level: "unsupported",
      message: `Allow rules attached to ${quote(agentAllow.map(([slug]) => slug))} were not exported: Claude Code has no per-agent allow list. Attach them to a skill (allowed-tools) or to the whole project instead.`,
    });
  }

  const patternDenies = Object.entries(agents).filter(([, scope]) => scope.permissions?.deny.some((rule) => rule.includes("(")));
  const skillDenies = Object.entries(skills).filter(([, scope]) => (scope.permissions?.deny.length ?? 0) > 0);
  if (patternDenies.length > 0 || skillDenies.length > 0) {
    items.push({
      feature: "Scoped deny rules",
      irPath: "settings.scoped[].permissions.deny",
      level: "approximated",
      message: "Deny rules with a pattern, and deny rules attached to skills, apply to the whole project. They are stricter than designed, never looser.",
    });
  }

  const scopedEnv = [...Object.values(agents), ...Object.values(skills)].some((scope) => Object.keys(scope.env ?? {}).length > 0);
  if (scopedEnv) {
    items.push({
      feature: "Scoped environment variables",
      irPath: "settings.scoped[].env",
      level: "approximated",
      message: "Claude Code has no per-agent environment, so variables attached to an agent or skill are set for the whole project.",
    });
  }

  const skillMcp = Object.entries(skills).filter(([, scope]) => Object.keys(scope.mcpServers ?? {}).length > 0);
  if (skillMcp.length > 0) {
    items.push({
      feature: "Skill MCP servers",
      irPath: "settings.scoped.skills[].mcpServers",
      level: "approximated",
      message: `MCP servers attached to ${quote(skillMcp.map(([slug]) => slug))} are configured for the whole project in .mcp.json; skills cannot own servers.`,
    });
  }

  if (ir.lifecycle) {
    const gates = ir.lifecycle.stages.flatMap((stage) => stage.gates);
    const types = new Set(gates.map((gate) => gate.config?.gateType ?? "HUMAN_APPROVAL"));
    items.push({
      feature: "Stage order",
      irPath: "lifecycle.stages",
      level: "approximated",
      message: "A PreToolUse hook stops agents of later stages from changing files until earlier gates pass. It applies when those agents run, not to the main session.",
    });
    if (types.has("CHECK")) {
      items.push({
        feature: "Check gates",
        irPath: "lifecycle.stages[].gates[CHECK]",
        level: "native",
        message: "A Stop hook on the stage lead runs each command; failures send the agent back to fix them, up to the stage's revision limit.",
      });
    }
    if (types.has("HUMAN_APPROVAL")) {
      items.push({
        feature: "Human approval gates",
        irPath: "lifecycle.stages[].gates[HUMAN_APPROVAL]",
        level: "approximated",
        message: "People record approval with /approve-gate-<gate>, which agents cannot invoke. Enforcement is a local hook, not access control; approver roles are not checked.",
      });
    }
    const rubrics = gates.filter((gate) => gate.config?.gateType === "OUTCOME_RUBRIC");
    const jevGraded = rubrics.filter((gate) => gate.config?.gateType === "OUTCOME_RUBRIC" && gate.config.rubric.grader === "jev");
    if (rubrics.length > jevGraded.length) {
      items.push({
        feature: "Rubric gates",
        irPath: "lifecycle.stages[].gates[OUTCOME_RUBRIC]",
        level: "approximated",
        message:
          "The stage lead self-assesses each criterion in .context-canvas/evidence/<gate>.md, which the Stop hook checks. Set the gate's grader to Jev for independent grading.",
      });
    }
    if (jevGraded.length > 0) {
      items.push({
        feature: "Rubric gates graded by Jev",
        irPath: "lifecycle.stages[].gates[OUTCOME_RUBRIC].rubric.grader",
        level: "native",
        message:
          "At stop time the gate script asks Jev (TypeSafe AI) one calibrated yes/no question per criterion, judged from the stage's files and evidence. It needs TYPESAFE_API_KEY; without it, or if the call fails, the gate falls back to the self-assessed checklist and records why.",
      });
    }
  }

  return items;
}
