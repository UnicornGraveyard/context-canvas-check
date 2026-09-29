import type { BlueprintIR, Diagnostic } from "../../ir/types";

/** Built-in tool names from the Claude Code tools reference (code.claude.com/docs/en/tools-reference). */
export const CLAUDE_CODE_BUILTIN_TOOLS: ReadonlySet<string> = new Set([
  "Agent", "Artifact", "AskUserQuestion", "Bash", "CronCreate", "CronDelete", "CronList", "Edit",
  "EndConversation", "EnterPlanMode", "EnterWorktree", "ExitPlanMode", "ExitWorktree", "Glob", "Grep",
  "ListAgents", "ListMcpResourcesTool", "LSP", "Monitor", "NotebookEdit", "PowerShell", "PushNotification",
  "Read", "ReadMcpResourceTool", "RemoteTrigger", "ReportFindings", "ScheduleWakeup", "SendFeedback",
  "SendMessage", "SendUserFile", "ShareOnboardingGuide", "Skill", "SubagentHandback", "TaskCreate", "TaskGet",
  "TaskList", "TaskOutput", "TaskStop", "TaskUpdate", "TodoWrite", "ToolSearch", "WaitForMcpServers",
  "WebFetch", "WebSearch", "Workflow", "Write",
]);

// mcp__server, mcp__server__tool, or a wildcard such as mcp__server__*.
const MCP_TOOL = /^mcp__[\w-]+(__[\w*-]+)?$|^mcp__\*$/;
// Tool or Tool(specifier), e.g. Bash(npm run *) or WebFetch(domain:example.com).
const BUILTIN_WITH_SPECIFIER = /^([A-Za-z]+)(\(.*\))?$/;

/** True for a built-in tool (optionally with a permission specifier) or an MCP tool name. */
export function isKnownClaudeCodeTool(name: string): boolean {
  const trimmed = name.trim();
  if (MCP_TOOL.test(trimmed)) return true;
  const match = trimmed.match(BUILTIN_WITH_SPECIFIER);
  return Boolean(match && CLAUDE_CODE_BUILTIN_TOOLS.has(match[1]));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Warns about tool names Claude Code will not recognize. These are warnings,
 * not errors: Claude Code ignores unknown names, so the export still works but
 * the agent will not get the tool it was meant to have.
 */
export function lintClaudeCodeTools(ir: BlueprintIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  const check = (tools: string[], owner: string, atomId?: string) => {
    for (const tool of tools) {
      if (isKnownClaudeCodeTool(tool)) continue;
      const key = `${atomId ?? owner}|${tool}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push({
        code: "UNKNOWN_TOOL",
        severity: "warning",
        adapterId: "claude-code",
        atomId,
        message: `${owner} lists "${tool}", which is not a Claude Code tool. Use a built-in tool name or an MCP tool (mcp__server__tool); Claude Code ignores unknown names.`,
      });
    }
  };

  for (const agent of ir.agents) {
    check([...stringList(agent.metadata?.allowedTools), ...stringList(agent.metadata?.deniedTools)], `Agent "${agent.title}"`, agent.id);
  }
  for (const skill of ir.skills) {
    check(stringList(skill.metadata?.allowedTools), `Skill "${skill.title}"`, skill.id);
  }

  const { global, scoped } = ir.settings;
  check([...(global.permissions?.allow ?? []), ...(global.permissions?.deny ?? [])], "Project permissions");
  for (const [group, entries] of [["agent", scoped.agents], ["skill", scoped.skills]] as const) {
    for (const [slug, scope] of Object.entries(entries)) {
      check([...(scope.permissions?.allow ?? []), ...(scope.permissions?.deny ?? [])], `Permissions for ${group} "${slug}"`);
    }
  }

  return diagnostics;
}
