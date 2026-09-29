import type { BlueprintIR, IRGate, IRLifecycle } from "../../../ir/types";
import { toFrontmatter } from "../frontmatter";
import { JEV_DEFAULT_MIN_PROBABILITY, JEV_DEFAULT_MODEL } from "../../../model/metadata";
import { GATE_SCRIPT } from "./gate-script";

export const LIFECYCLE_JSON_PATH = ".context-canvas/lifecycle.json";
export const GATE_SCRIPT_PATH = ".claude/hooks/context-canvas/gate.mjs";

/** The hook command for an agent; slugs are [a-z0-9-], so no shell quoting beyond the path. */
const gateCommand = (verb: "stop" | "guard", agentSlug: string) =>
  `node "$CLAUDE_PROJECT_DIR/${GATE_SCRIPT_PATH}" ${verb} ${agentSlug}`;

/** Tools that change files or run commands; the guard blocks these until earlier gates pass. */
const GUARDED_TOOLS = "Write|Edit|MultiEdit|NotebookEdit|Bash";

export const approvalSkillName = (gate: IRGate) => `approve-gate-${gate.slug}`;

type GateRecord = {
  slug: string;
  title: string;
  type: string;
  blocking: boolean;
  command?: string;
  timeoutSec?: number;
  approverRole?: string;
  requiredEvidence?: string[];
  criteria?: string[];
  passThreshold?: number;
  /** Rubric gates graded by Jev (TypeSafe) instead of self-assessment. */
  grader?: "jev";
  model?: string;
  minProbability?: number;
};

function gateRecord(gate: IRGate): GateRecord {
  const config = gate.config;
  const base = { slug: gate.slug, title: gate.title, blocking: config?.blocking ?? true };
  // Unconfigured gates fall back to a person's approval, the safe default.
  if (!config || config.gateType === "HUMAN_APPROVAL") {
    return { ...base, type: "HUMAN_APPROVAL", approverRole: config?.approverRole ?? "APPROVER", requiredEvidence: config?.requiredEvidence ?? [] };
  }
  if (config.gateType === "CHECK") {
    return { ...base, type: "CHECK", command: config.command, timeoutSec: config.timeoutSec };
  }
  return {
    ...base,
    type: "OUTCOME_RUBRIC",
    criteria: config.rubric.criteria,
    ...(config.rubric.passThreshold !== undefined ? { passThreshold: config.rubric.passThreshold } : {}),
    ...(config.rubric.grader === "jev"
      ? {
          grader: "jev" as const,
          model: config.rubric.model ?? JEV_DEFAULT_MODEL,
          minProbability: config.rubric.minProbability ?? JEV_DEFAULT_MIN_PROBABILITY,
        }
      : {}),
  };
}

function lifecycleJson(ir: BlueprintIR, lifecycle: IRLifecycle): string {
  return `${JSON.stringify(
    {
      blueprint: ir.blueprint.name ?? null,
      stages: lifecycle.stages.map((stage) => ({
        slug: stage.slug,
        title: stage.title,
        kind: stage.kind,
        order: stage.order,
        lead: stage.lead,
        contributors: stage.contributors,
        ...(stage.entryCriteria.length > 0 ? { entryCriteria: stage.entryCriteria } : {}),
        ...(stage.exitCriteria.length > 0 ? { exitCriteria: stage.exitCriteria } : {}),
        ...(stage.outcomeRubric ? { outcomeRubric: stage.outcomeRubric } : {}),
        ...(stage.maxIterations ? { maxIterations: stage.maxIterations } : {}),
        produces: stage.produces,
        consumes: stage.consumes,
        gates: stage.gates.map(gateRecord),
      })),
      // Titles for the artifact slugs above; importers use them to rebuild the blueprint.
      artifacts: lifecycle.artifacts.map((artifact) => ({ slug: artifact.slug, title: artifact.title })),
    },
    null,
    2
  )}\n`;
}

function approvalSkill(gate: IRGate, stageTitle: string): { path: string; content: string } {
  const record = gateRecord(gate);
  const name = approvalSkillName(gate);
  const frontmatter = toFrontmatter({
    name,
    description: `Record a person's approval of the "${gate.title}" gate (${stageTitle} stage). Only people can run this.`,
    "disable-model-invocation": true,
  });
  const evidence = record.requiredEvidence && record.requiredEvidence.length > 0
    ? ["Evidence the approver confirmed:", ...record.requiredEvidence.map((item) => `- ${item}`)].join("\n")
    : "";
  const body = [
    // Runs when a person invokes /name, before Claude sees this skill; a failure aborts it.
    `!\`node "\${CLAUDE_PROJECT_DIR:-.}/${GATE_SCRIPT_PATH}" approve ${gate.slug}\``,
    "",
    `The line above records the approval in \`.context-canvas/approvals/${gate.slug}.json\`. Confirm it to the person in one sentence; the next stage can now change files.`,
    evidence,
  ]
    .filter((line) => line !== "")
    .join("\n\n");
  return { path: `.claude/skills/${name}/SKILL.md`, content: `${frontmatter}\n\n${body}\n` };
}

/**
 * Lifecycle files for Claude Code: the lifecycle manifest, the gate runtime,
 * and one people-only approval skill per human-approval gate.
 */
export function generateLifecycleFiles(ir: BlueprintIR): Record<string, string> {
  const lifecycle = ir.lifecycle;
  if (!lifecycle) return {};
  const files: Record<string, string> = {
    [LIFECYCLE_JSON_PATH]: lifecycleJson(ir, lifecycle),
    [GATE_SCRIPT_PATH]: GATE_SCRIPT,
  };
  for (const stage of lifecycle.stages) {
    for (const gate of stage.gates) {
      if (gateRecord(gate).type !== "HUMAN_APPROVAL") continue;
      const skill = approvalSkill(gate, stage.title);
      files[skill.path] = skill.content;
    }
  }
  return files;
}

type HookEntry = { matcher?: string; hooks: Array<{ type: "command"; command: string; timeout?: number }> };

/**
 * Frontmatter hooks for an agent in the lifecycle. The lead of a stage with
 * check or rubric gates gets a Stop hook that runs them (SubagentStop when it
 * runs as a subagent). Agents of later stages get a PreToolUse guard that
 * blocks edits until earlier stages' gates pass.
 */
export function agentLifecycleHooks(agentSlug: string, ir: BlueprintIR): Record<string, HookEntry[]> | null {
  const lifecycle = ir.lifecycle;
  if (!lifecycle) return null;
  const hooks: Record<string, HookEntry[]> = {};

  const led = lifecycle.stages.filter((stage) => stage.lead === agentSlug);
  const autoGates = led.flatMap((stage) => stage.gates.map(gateRecord)).filter((gate) => gate.type !== "HUMAN_APPROVAL");
  if (autoGates.length > 0) {
    const checkSeconds = autoGates.reduce((sum, gate) => sum + (gate.timeoutSec ?? 0), 0);
    hooks.Stop = [{ hooks: [{ type: "command", command: gateCommand("stop", agentSlug), timeout: Math.max(60, checkSeconds + 30) }] }];
  }

  const assigned = lifecycle.stages.filter((stage) => stage.lead === agentSlug || stage.contributors.includes(agentSlug));
  const earliest = Math.min(...assigned.map((stage) => stage.order));
  const gatedBefore = lifecycle.stages.some((stage) => stage.order < earliest && stage.gates.length > 0);
  if (assigned.length > 0 && gatedBefore) {
    hooks.PreToolUse = [{ matcher: GUARDED_TOOLS, hooks: [{ type: "command", command: gateCommand("guard", agentSlug) }] }];
  }

  return Object.keys(hooks).length > 0 ? hooks : null;
}

/** CLAUDE.md section explaining how the lifecycle is enforced in this repository. */
export function lifecycleClaudeMdLines(ir: BlueprintIR): string[] {
  const lifecycle = ir.lifecycle;
  if (!lifecycle) return [];
  const lines = [
    "## Lifecycle",
    "Work moves through these stages in order. Hooks enforce the gates: a stage's lead cannot finish while its checks fail, and later stages cannot change files until earlier gates pass.",
    "",
  ];
  for (const stage of lifecycle.stages) {
    const gates = stage.gates.map((gate) => {
      const record = gateRecord(gate);
      if (record.type === "HUMAN_APPROVAL") return `${gate.title} (a person runs \`/${approvalSkillName(gate)}\`)`;
      if (record.type === "CHECK") return `${gate.title} (\`${record.command}\` must pass)`;
      if (record.grader === "jev") {
        return `${gate.title} (rubric graded by Jev from the stage's files and \`.context-canvas/evidence/${gate.slug}.md\`)`;
      }
      return `${gate.title} (self-assessed rubric in \`.context-canvas/evidence/${gate.slug}.md\`)`;
    });
    lines.push(
      `${stage.order}. **${stage.title}**, led by ${stage.lead ? `\`${stage.lead}\`` : "no one"}${gates.length > 0 ? `; gates: ${gates.join(", ")}` : ""}.`
    );
  }
  lines.push("", `Check gate state with \`node ${GATE_SCRIPT_PATH} status\`.`);
  return lines;
}
