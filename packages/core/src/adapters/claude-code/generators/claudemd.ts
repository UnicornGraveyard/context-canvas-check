import type { BlueprintIR, IRAgent, IRKnowledge } from "../../../ir/types";
import { compactText, firstLine } from "../../../util/text";
import { lifecycleClaudeMdLines } from "./lifecycle";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function agentCondition(agent: IRAgent): string {
  const metadata = asObject(agent.metadata);
  const promptSections = asObject(metadata?.promptSections);

  const role = promptSections?.role;
  if (typeof role === "string" && role.trim().length > 0) {
    return compactText(role, 140);
  }

  const constraints = promptSections?.constraints;
  if (typeof constraints === "string" && constraints.trim().length > 0) {
    return compactText(constraints, 140);
  }

  const fromContent = firstLine(agent.content);
  if (fromContent) return compactText(fromContent, 140);

  return "its responsibility boundary matches the task scope";
}

function renderTeamProtocol(ir: BlueprintIR): string[] {
  const agents = [...ir.agents].sort((a, b) => a.title.localeCompare(b.title));

  if (agents.length === 0) return [];

  const sortedByCoordinationWeight = [...agents].sort((a, b) => {
    const diff = b.directComposeCount - a.directComposeCount;
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title);
  });
  const coordinator = sortedByCoordinationWeight[0];

  const hasScopedConfig = ir.settings.hasAgentOrSkillConfigures;

  const lines: string[] = [
    "## Team Protocol",
    `- Start with \`${coordinator.slug}\` for orchestration and delegation.`,
    "- Delegate execution through explicit `COMPOSES` skills; let `REQUIRES` dependencies resolve transitively.",
    "- When a task violates constraints or policy, escalate to the agent with matching role/constraint ownership before proceeding.",
    "- Log final decisions and unresolved risks in `CLAUDE.md` context sections for auditability.",
  ];

  if (hasScopedConfig) {
    lines.push(
      "- Agent-specific MCP servers and denied tools are declared in each agent's frontmatter; skill-specific pre-approved tools in each skill's `allowed-tools`."
    );
  }

  return lines;
}

function renderDispatchGuide(ir: BlueprintIR): string[] {
  const skillById = new Map(ir.skills.map((skill) => [skill.id, skill]));
  const agents = [...ir.agents].sort((a, b) => a.title.localeCompare(b.title));

  if (agents.length === 0) return [];

  const lines: string[] = ["## Dispatch Guide"];

  for (const agent of agents) {
    const slug = agent.slug;
    const condition = agentCondition(agent);
    const skills = agent.skillIds
      .map((skillId) => skillById.get(skillId))
      .filter((skill) => skill !== undefined)
      .map((skill) => `\`${skill.slug}\``);

    if (skills.length > 0) {
      lines.push(`- Use \`${slug}\` when ${condition}. Skills: ${skills.join(", ")}.`);
    } else {
      lines.push(`- Use \`${slug}\` when ${condition}.`);
    }
  }

  return lines;
}

export function generateClaudeMd(ir: BlueprintIR): { path: string; content: string } | null {
  const relevantKnowledge = ir.knowledge;
  const hasAgents = ir.agents.length > 0;
  const { name: packName, description: packDescription } = ir.blueprint;
  const hasContextHeader = Boolean(packName || packDescription);

  if (relevantKnowledge.length === 0 && !hasAgents && !hasContextHeader) {
    return null;
  }

  const byType = new Map<string, IRKnowledge[]>();
  for (const atom of relevantKnowledge) {
    const list = byType.get(atom.type) ?? [];
    list.push(atom);
    byType.set(atom.type, list);
  }

  const sections: string[] = ["# Project Context"];

  if (packName || packDescription) {
    sections.push("## Team Context");
    if (packName) {
      sections.push(`- Team: ${packName}`);
    }
    if (packDescription) {
      sections.push(`- Summary: ${compactText(packDescription, 240)}`);
    }
  }

  const teamProtocol = renderTeamProtocol(ir);
  if (teamProtocol.length > 0) {
    sections.push(teamProtocol.join("\n"));
  }

  const dispatchGuide = renderDispatchGuide(ir);
  if (dispatchGuide.length > 0) {
    sections.push(dispatchGuide.join("\n"));
  }

  const lifecycle = lifecycleClaudeMdLines(ir);
  if (lifecycle.length > 0) {
    sections.push(lifecycle.join("\n"));
  }

  for (const [type, typeAtoms] of byType) {
    sections.push(`## ${type}`);
    for (const atom of typeAtoms) {
      sections.push(`### ${atom.title}`);
      sections.push(atom.content);
    }
  }

  return {
    path: "CLAUDE.md",
    content: sections.join("\n\n"),
  };
}
