import type { BlueprintIR, IRAgent } from "../../../ir/types";
import { toFrontmatter } from "../frontmatter";
import { compactText, firstLine } from "../../../util/text";
import { agentLifecycleHooks } from "./lifecycle";

export function generateAgentFile(agent: IRAgent, ir: BlueprintIR): { path: string; content: string } {
  // Surface the compiler's per-agent failure so callers report it for this agent.
  if (!agent.config) throw new Error(agent.configError ?? `Agent ${agent.title} has no configuration`);
  const config = agent.config;
  const skillById = new Map(ir.skills.map((skill) => [skill.id, skill]));
  const skillSlugs = agent.skillIds
    .map((id) => skillById.get(id))
    .filter((skill) => skill !== undefined)
    .map((skill) => skill.slug);

  const agentSlug = agent.slug;
  const roleText = config.promptSections.role;
  const constraintsText = config.promptSections.constraints;

  const purpose = compactText(roleText ?? firstLine(agent.content) ?? "", 200) || "No explicit purpose provided.";
  const keyConstraints = compactText(constraintsText ?? "", 220) || "No explicit constraints provided.";
  const parentChain = agent.ancestors.map((ancestor) => `\`${ancestor.slug}\``);
  const skillListSummary =
    skillSlugs.length > 0 ? skillSlugs.map((slug) => `\`${slug}\``).join(", ") : "None";

  // Claude Code agent frontmatter uses camelCase keys
  const frontmatterData: Record<string, unknown> = {
    name: agentSlug,
    description: firstLine(agent.content).slice(0, 200),
  };

  if (config.model) {
    frontmatterData.model = config.model;
  }
  if (config.maxTurns) {
    frontmatterData.maxTurns = config.maxTurns;
  }
  // Claude Code uses "tools" (not "allowedTools") for agent files
  if (config.allowedTools && config.allowedTools.length > 0) {
    frontmatterData.tools = config.allowedTools.join(", ");
  }
  // Claude Code uses "disallowedTools" (not "deniedTools")
  if (config.deniedTools && config.deniedTools.length > 0) {
    frontmatterData.disallowedTools = config.deniedTools.join(", ");
  }
  if (skillSlugs.length > 0) {
    frontmatterData.skills = skillSlugs;
  }

  // Settings attached to this agent with CONFIGURES: bare tool denies become
  // disallowedTools, and MCP servers are defined inline so only this agent
  // gets them. (Pattern denies and environment are project-wide; see settings.)
  const scope = ir.settings.scoped.agents[agentSlug];
  const scopedDenies = (scope?.permissions?.deny ?? []).filter((rule) => !rule.includes("("));
  if (scopedDenies.length > 0) {
    const denied = [...new Set([...(config.deniedTools ?? []), ...scopedDenies])];
    frontmatterData.disallowedTools = denied.join(", ");
  }
  const scopedServers = Object.entries(scope?.mcpServers ?? {});
  if (scopedServers.length > 0) {
    frontmatterData.mcpServers = scopedServers.map(([name, server]) => ({ [name]: server }));
  }

  for (const key of ["permissionMode", "effort", "memory", "isolation", "background", "color", "initialPrompt"] as const) {
    if (config[key] !== undefined) frontmatterData[key] = config[key];
  }

  const hooks = agentLifecycleHooks(agentSlug, ir);
  if (hooks) frontmatterData.hooks = hooks;

  const frontmatter = toFrontmatter(frontmatterData);

  const tldrSection = [
    "## TL;DR",
    `- Agent: \`${agentSlug}\``,
    `- Purpose: ${purpose}`,
    `- Key constraints: ${keyConstraints}`,
    `- Skills available: ${skillListSummary}`,
    parentChain.length > 0 ? `- Inherits from: ${parentChain.join(", ")}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    path: `.claude/agents/${agentSlug}.md`,
    content: `${frontmatter}\n\n${tldrSection}\n\n${config.prompt}`,
  };
}
