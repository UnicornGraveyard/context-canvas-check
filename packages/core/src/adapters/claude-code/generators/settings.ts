import type { IRSettings } from "../../../ir/types";

/**
 * Serializes project-wide settings to Claude Code files: `.claude/settings.json`
 * (top-level "permissions" allow/deny and "env") and `.mcp.json`. Settings
 * scoped to one agent or skill are written into that agent's or skill's
 * frontmatter instead (see generators/agent.ts and generators/skill.ts).
 */
export function generateSettingsFiles(settings: IRSettings): Record<string, string> {
  const files: Record<string, string> = {};

  if (Object.keys(settings.global).length > 0) {
    files[".claude/settings.json"] = JSON.stringify(settings.global, null, 2);
  }

  if (Object.keys(settings.mcpServers).length > 0) {
    files[".mcp.json"] = JSON.stringify({ mcpServers: settings.mcpServers }, null, 2);
  }

  return files;
}
