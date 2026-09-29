import type { BlueprintIR, Diagnostic, IRAgent, IRGate, IRKnowledge, IRLifecycle } from "../../ir/types";
import { JEV_DEFAULT_MIN_PROBABILITY } from "../../model/metadata";
import type { AdapterOutput, ExportAdapter, FidelityItem } from "../types";
import { ruleBodyLines } from "../claude-code/generators/policy-rule";
import { compactText, firstLine, nestHeadings } from "../../util/text";

export const AGENTS_MD_ADAPTER_ID = "agents-md";
const VERSION = "1.0.0";

const code = (value: string) => `\`${value}\``;

function agentSection(agent: IRAgent, skillSlugById: Map<string, string>, ir: BlueprintIR): string {
  const config = agent.config;
  const scope = ir.settings.scoped.agents[agent.slug];
  const scopedDenies = scope?.permissions?.deny ?? [];
  const avoid = [...new Set([...(config?.deniedTools ?? []), ...scopedDenies])];
  const servers = Object.keys(scope?.mcpServers ?? {});
  const purpose = compactText(config?.promptSections.role ?? firstLine(agent.content), 200) || "No explicit purpose provided.";
  const procedures = agent.skillIds.map((id) => skillSlugById.get(id)).filter((slug): slug is string => Boolean(slug));

  const facts = [
    `- Purpose: ${purpose}`,
    `- Procedures: ${procedures.length > 0 ? procedures.map(code).join(", ") : "None"}`,
    agent.ancestors.length > 0 ? `- Inherits from: ${agent.ancestors.map((ancestor) => code(ancestor.slug)).join(", ")}` : null,
    config?.model ? `- Preferred model: ${config.model}` : null,
    config && config.allowedTools.length > 0 ? `- Tools: ${config.allowedTools.join(", ")}` : null,
    avoid.length > 0 ? `- Avoid tools: ${avoid.join(", ")}` : null,
    servers.length > 0 ? `- MCP servers (configure in your runtime): ${servers.map(code).join(", ")}` : null,
  ].filter((line): line is string => Boolean(line));

  // An agent whose metadata could not be merged falls back to its own content.
  const instructions = config ? config.prompt : agent.content;

  return [`### ${agent.title} (${code(agent.slug)})`, facts.join("\n"), nestHeadings(instructions, 3)].join("\n\n");
}

function gateInstruction(gate: IRGate): string {
  const config = gate.config;
  const blocking = config?.blocking === false ? " (advisory; does not block)" : "";
  if (!config) return `- ${gate.title}: not configured; treat it as a person's approval.`;
  if (config.gateType === "HUMAN_APPROVAL") {
    const evidence = config.requiredEvidence.length > 0 ? ` Evidence: ${config.requiredEvidence.join("; ")}.` : "";
    return `- ${gate.title}${blocking}: stop and ask a person (${config.approverRole.toLowerCase()}) to approve.${evidence}`;
  }
  if (config.gateType === "CHECK") {
    return `- ${gate.title}${blocking}: ${code(config.command)} must exit 0 (timeout ${config.timeoutSec}s).`;
  }
  const threshold = config.rubric.passThreshold !== undefined ? ` Pass at ${Math.round(config.rubric.passThreshold * 100)}% of criteria.` : "";
  const grader =
    config.rubric.grader === "jev"
      ? ` Graded by Jev (TypeSafe AI): each criterion needs probability ${config.rubric.minProbability ?? JEV_DEFAULT_MIN_PROBABILITY} or higher.`
      : "";
  return [`- ${gate.title}${blocking}: the output must meet every criterion below.${threshold}${grader}`, ...config.rubric.criteria.map((criterion) => `  - ${criterion}`)].join("\n");
}

function lifecycleSections(lifecycle: IRLifecycle, artifactTitles: Map<string, string>): string[] {
  const titleOf = (slug: string) => artifactTitles.get(slug) ?? slug;
  const table = [
    "| # | Stage | Lead | Contributors | Produces | Exit gates |",
    "| --- | --- | --- | --- | --- | --- |",
    ...lifecycle.stages.map((stage) =>
      [
        stage.order,
        stage.title,
        stage.lead ? code(stage.lead) : "Unassigned",
        stage.contributors.length > 0 ? stage.contributors.map(code).join(", ") : "None",
        stage.produces.length > 0 ? stage.produces.map(titleOf).join(", ") : "None",
        stage.gates.length > 0 ? stage.gates.map((gate) => gate.title).join(", ") : "None",
      ].join(" | ").replace(/^/, "| ").concat(" |")
    ),
  ].join("\n");

  const sections = [
    "## Lifecycle",
    "Work moves through these stages in order. Start a stage only after the previous stage's gates pass, and hand off the artifacts it produces.",
    table,
  ];
  for (const stage of lifecycle.stages) {
    const lines = [
      stage.consumes.length > 0 ? `- Reads: ${stage.consumes.map(titleOf).join(", ")}` : null,
      stage.produces.length > 0 ? `- Writes: ${stage.produces.map(titleOf).join(", ")}` : null,
      stage.entryCriteria.length > 0 ? `- Start when: ${stage.entryCriteria.join("; ")}` : null,
      stage.exitCriteria.length > 0 ? `- Done when: ${stage.exitCriteria.join("; ")}` : null,
      stage.maxIterations ? `- Revise at most ${stage.maxIterations} times, then ask a person.` : null,
    ].filter((line): line is string => Boolean(line));
    sections.push(`### ${stage.order}. ${stage.title}`, nestHeadings(stage.content, 3));
    if (lines.length > 0) sections.push(lines.join("\n"));
    if (stage.gates.length > 0) sections.push(["Exit gates:", ...stage.gates.map(gateInstruction)].join("\n"));
  }
  return sections;
}

function knowledgeSections(knowledge: IRKnowledge[]): string[] {
  const byType = new Map<string, IRKnowledge[]>();
  for (const item of knowledge) {
    byType.set(item.type, [...(byType.get(item.type) ?? []), item]);
  }
  const sections: string[] = [];
  for (const [type, items] of byType) {
    sections.push(`### ${type}`);
    for (const item of items) {
      sections.push(`#### ${item.title}`, nestHeadings(item.content, 4));
    }
  }
  return sections;
}

function runtimeConfiguration(ir: BlueprintIR): string[] {
  const { global, mcpServers } = ir.settings;
  const lines: string[] = [];
  if (global.permissions && (global.permissions.allow.length > 0 || global.permissions.deny.length > 0)) {
    if (global.permissions.allow.length > 0) lines.push(`- Allowed tools: ${global.permissions.allow.join(", ")}`);
    if (global.permissions.deny.length > 0) lines.push(`- Denied tools: ${global.permissions.deny.join(", ")}`);
  }
  const envNames = Object.keys(global.env ?? {});
  if (envNames.length > 0) {
    lines.push(`- Environment variables (set these; values are not exported): ${envNames.map(code).join(", ")}`);
  }
  const serverNames = Object.keys(mcpServers);
  if (serverNames.length > 0) {
    lines.push(`- MCP servers (configure these in your agent runtime): ${serverNames.map(code).join(", ")}`);
  }
  return lines;
}

function fidelity(ir: BlueprintIR): FidelityItem[] {
  const items: FidelityItem[] = [];
  const hasToolLists =
    ir.agents.some((agent) => (agent.config?.allowedTools.length ?? 0) > 0 || (agent.config?.deniedTools.length ?? 0) > 0) ||
    Boolean(ir.settings.global.permissions);
  const hasScopes = Object.keys(ir.settings.scoped.agents).length > 0 || Object.keys(ir.settings.scoped.skills).length > 0;

  if (ir.agents.length > 0) {
    items.push({ feature: "Agent roles", irPath: "agents", level: "advisory", message: "Roles become written instructions. AGENTS.md runtimes do not run agents in isolation." });
  }
  if (ir.agents.some((agent) => agent.config?.model)) {
    items.push({ feature: "Model per agent", irPath: "agents[].config.model", level: "advisory", message: "Preferred models are listed; the runtime chooses its own model." });
  }
  if (hasToolLists) {
    items.push({ feature: "Tool permissions", irPath: "agents[].config.allowedTools", level: "advisory", message: "Tool lists are guidance; the runtime enforces its own permissions." });
  }
  if (ir.skills.length > 0) {
    items.push({ feature: "Skills", irPath: "skills", level: "advisory", message: "Skills become written procedures; they are not invocable commands." });
  }
  if (ir.rules.length > 0) {
    items.push({ feature: "Rules", irPath: "rules", level: "native", message: "Rules are included as always-on instructions." });
  }
  if (ir.knowledge.length > 0) {
    items.push({ feature: "Project context", irPath: "knowledge", level: "native", message: "Knowledge atoms are included as project context." });
  }
  if (Object.keys(ir.settings.mcpServers).length > 0) {
    items.push({ feature: "MCP servers", irPath: "settings.mcpServers", level: "unsupported", message: "Server names are listed; configure the servers in your agent runtime." });
  }
  if (Object.keys(ir.settings.global.env ?? {}).length > 0) {
    items.push({ feature: "Environment variables", irPath: "settings.global.env", level: "unsupported", message: "Variable names are listed; values are never exported." });
  }
  if (hasScopes) {
    items.push({ feature: "Per-agent settings", irPath: "settings.scoped", level: "unsupported", message: "Settings attached to one agent or skill cannot be expressed in AGENTS.md." });
  }
  if (ir.lifecycle) {
    items.push({ feature: "Lifecycle stages and gates", irPath: "lifecycle", level: "advisory", message: "Stages, handoffs and gates are written instructions; AGENTS.md runtimes do not enforce gates." });
  }
  return items;
}

function emit(ir: BlueprintIR): AdapterOutput {
  const skillSlugById = new Map(ir.skills.map((skill) => [skill.id, skill.slug]));
  const sections: string[] = [`# ${ir.blueprint.name ?? "Agent Team"}`];

  if (ir.blueprint.description) sections.push(ir.blueprint.description);

  sections.push(
    "> Generated by Context Canvas from this blueprint. It describes roles, procedures and rules for any coding agent that reads AGENTS.md. Change the blueprint rather than editing this file."
  );

  sections.push(
    [
      "## How to work in this project",
      "- Pick the role below whose purpose matches the task and follow its instructions.",
      "- Use that role's procedures; each is described under Procedures.",
      "- Follow every rule under Rules at all times.",
      "- Tool and model lists are guidance; your runtime may enforce its own.",
      ...(ir.lifecycle ? ["- Follow the Lifecycle: work in stage order and stop at every gate until it passes."] : []),
    ].join("\n")
  );

  if (ir.lifecycle) {
    const artifactTitles = new Map(ir.lifecycle.artifacts.map((artifact) => [artifact.slug, artifact.title]));
    sections.push(...lifecycleSections(ir.lifecycle, artifactTitles));
  }

  if (ir.agents.length > 0) {
    sections.push("## Roles", ...ir.agents.map((agent) => agentSection(agent, skillSlugById, ir)));
  }

  if (ir.skills.length > 0) {
    sections.push("## Procedures");
    for (const skill of ir.skills) {
      sections.push(`### ${skill.title} (${code(skill.slug)})`, nestHeadings(skill.content, 3));
    }
  }

  if (ir.rules.length > 0) {
    sections.push("## Rules");
    for (const rule of ir.rules) {
      sections.push(`### ${rule.title}`, nestHeadings(ruleBodyLines(rule).join("\n").trimEnd(), 3));
    }
  }

  if (ir.knowledge.length > 0) {
    sections.push("## Project Context", ...knowledgeSections(ir.knowledge));
  }

  const runtime = runtimeConfiguration(ir);
  if (runtime.length > 0) {
    sections.push("## Runtime configuration", runtime.join("\n"));
  }

  return {
    files: { "AGENTS.md": `${sections.join("\n\n")}\n` },
    fidelity: { adapterId: AGENTS_MD_ADAPTER_ID, adapterVersion: VERSION, items: fidelity(ir) },
  };
}

function lint(ir: BlueprintIR): Diagnostic[] {
  return ir.agents
    .filter((agent) => !agent.config)
    .map((agent) => ({
      code: "AGENT_CONFIG_UNRESOLVED",
      severity: "warning" as const,
      adapterId: AGENTS_MD_ADAPTER_ID,
      atomId: agent.id,
      message: `Agent "${agent.title}" metadata could not be merged (${agent.configError ?? "unknown error"}); AGENTS.md uses its own instructions only.`,
    }));
}

/** A single portable AGENTS.md, readable by Codex, Cursor, Copilot and other agent runtimes. */
export const agentsMdAdapter: ExportAdapter = {
  id: AGENTS_MD_ADAPTER_ID,
  version: VERSION,
  lint,
  emit,
};
