import { parse } from "yaml";
import type { BlueprintIR } from "../../ir/types";
import { slugify } from "../../util/slug";
import type { FidelityItem } from "../types";
import { toFrontmatter } from "./frontmatter";
import { GATE_SCRIPT_PATH, LIFECYCLE_JSON_PATH } from "./generators/lifecycle";
import type { ClaudeCodeOptions } from "./options";

const PLUGIN_GATE = "hooks/gate.mjs";
const GUARDED_TOOLS = "Write|Edit|MultiEdit|NotebookEdit|Bash";

/** Splits "---\nyaml\n---\nbody" into its parsed frontmatter and body. */
function splitFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: content };
  const data = (parse(match[1]) ?? {}) as Record<string, unknown>;
  return { data, body: content.slice(match[0].length) };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Repackages the project-layout files as a Claude Code plugin:
 * .claude-plugin/plugin.json, agents/, skills/, hooks/hooks.json, .mcp.json.
 * Plugin subagents ignore frontmatter hooks, mcpServers and permissionMode, so
 * lifecycle hooks become plugin-wide hooks keyed by the agent that runs them,
 * agent MCP servers join the plugin's .mcp.json, and permission modes and
 * project settings are reported as not carried.
 */
export function toPluginLayout(
  projectFiles: Record<string, string>,
  ir: BlueprintIR,
  options: ClaudeCodeOptions
): { files: Record<string, string>; fidelity: FidelityItem[] } {
  const files: Record<string, string> = {};
  const fidelity: FidelityItem[] = [];
  const name = options.plugin.name ?? (slugify(ir.blueprint.name ?? "") || "blueprint");
  const mcpServers: Record<string, unknown> = { ...record(record(JSON.parse(projectFiles[".mcp.json"] ?? "{}")).mcpServers) };
  let droppedModes = 0;
  let movedServers = 0;
  let stopTimeout = 60;

  for (const [path, content] of Object.entries(projectFiles)) {
    if (path.startsWith(".claude/agents/")) {
      const { data, body } = splitFrontmatter(content);
      const hooks = record(data.hooks);
      for (const entry of Array.isArray(hooks.Stop) ? hooks.Stop : []) {
        for (const hook of Array.isArray(record(entry).hooks) ? (record(entry).hooks as unknown[]) : []) {
          const timeout = record(hook).timeout;
          if (typeof timeout === "number") stopTimeout = Math.max(stopTimeout, timeout);
        }
      }
      if (Array.isArray(data.mcpServers)) {
        for (const server of data.mcpServers) {
          for (const [serverName, definition] of Object.entries(record(server))) {
            mcpServers[serverName] = definition;
            movedServers += 1;
          }
        }
      }
      if (data.permissionMode !== undefined) droppedModes += 1;
      delete data.hooks;
      delete data.mcpServers;
      delete data.permissionMode;
      files[path.replace(".claude/agents/", "agents/")] = `${toFrontmatter(data)}\n\n${body.replace(/^\n+/, "")}`;
    } else if (path.startsWith(".claude/skills/")) {
      files[path.replace(".claude/skills/", "skills/")] = content.replaceAll(
        `\${CLAUDE_PROJECT_DIR:-.}/${GATE_SCRIPT_PATH}`,
        `\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_GATE}`
      );
    } else if (path === GATE_SCRIPT_PATH) {
      files[PLUGIN_GATE] = content;
    } else if (path === LIFECYCLE_JSON_PATH) {
      files["lifecycle.json"] = content;
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    files[".mcp.json"] = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
  }

  if (ir.lifecycle) {
    const command = (verb: string) => `node "\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_GATE}" ${verb}`;
    files["hooks/hooks.json"] = `${JSON.stringify(
      {
        hooks: {
          SubagentStop: [{ hooks: [{ type: "command", command: command("stop"), timeout: stopTimeout }] }],
          PreToolUse: [{ matcher: GUARDED_TOOLS, hooks: [{ type: "command", command: command("guard") }] }],
        },
      },
      null,
      2
    )}\n`;
    fidelity.push({
      feature: "Lifecycle hooks in a plugin",
      irPath: "lifecycle",
      level: "approximated",
      message: "Plugin agents ignore frontmatter hooks, so gates run from the plugin's hooks.json and identify the agent from the hook input.",
    });
  }

  const description = ir.blueprint.description ?? `Agents and skills from the ${ir.blueprint.name ?? name} blueprint.`;
  files[".claude-plugin/plugin.json"] = `${JSON.stringify(
    {
      name,
      version: options.plugin.version ?? "0.0.0",
      description,
      ...(ir.blueprint.name ? { displayName: ir.blueprint.name } : {}),
      ...(options.plugin.author ? { author: { name: options.plugin.author } } : {}),
    },
    null,
    2
  )}\n`;
  if (options.plugin.marketplace) {
    files[".claude-plugin/marketplace.json"] = `${JSON.stringify(
      {
        name: `${name}-marketplace`,
        description: `Marketplace for the ${ir.blueprint.name ?? name} blueprint plugin.`,
        owner: { name: options.plugin.author ?? "Context Canvas" },
        plugins: [{ name, source: "./", description }],
      },
      null,
      2
    )}\n`;
  }

  const rules = Object.keys(projectFiles).filter((path) => path.startsWith(".claude/rules/"));
  const readme = [
    `# ${ir.blueprint.name ?? name}`,
    description,
    "Generated by Context Canvas. Install for local testing with `claude --plugin-dir <this folder>`, or add the repository as a marketplace and run `/plugin install " + name + "`.",
    projectFiles["CLAUDE.md"] ? `## Project context\n\nAdd this to the CLAUDE.md of repositories that use the plugin:\n\n${projectFiles["CLAUDE.md"].replace(/^# Project Context\n+/, "")}` : "",
    rules.length > 0 ? `## Rules\n\n${rules.map((path) => projectFiles[path]).join("\n\n")}` : "",
    projectFiles[".claude/settings.json"] ? `## Project settings\n\nPlugins cannot set these. Add them to each repository's .claude/settings.json:\n\n\`\`\`json\n${projectFiles[".claude/settings.json"]}\n\`\`\`` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  files["README.md"] = `${readme}\n`;

  if (movedServers > 0) {
    fidelity.push({
      feature: "Agent MCP servers in a plugin",
      irPath: "settings.scoped.agents[].mcpServers",
      level: "approximated",
      message: "Plugin agents ignore their own mcpServers, so those servers are available to the whole plugin.",
    });
  }
  if (droppedModes > 0) {
    fidelity.push({
      feature: "Permission modes in a plugin",
      irPath: "agents[].config.permissionMode",
      level: "unsupported",
      message: "Plugin agents ignore permissionMode, so it was left out.",
    });
  }
  if (projectFiles["CLAUDE.md"] || rules.length > 0 || projectFiles[".claude/settings.json"]) {
    fidelity.push({
      feature: "Project context, rules and settings in a plugin",
      irPath: "knowledge, rules, settings.global",
      level: "advisory",
      message: "Plugins cannot ship CLAUDE.md, rules or project settings; they are copied into the plugin README for repositories to adopt.",
    });
  }

  return { files, fidelity };
}
