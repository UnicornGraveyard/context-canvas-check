import { asRecord, asStringList, frontmatterLine, lineOf, type ConfigModel, type MarkdownFile } from "./model";
import { closeFrontmatterEdit, doubleSlashEdit, quoteValueEdit, removeEmptyHooksEdit, renameFieldEdit, setFieldEdit } from "./edits";
import { hookEntries, matcherMatches, permissionRules, PATH_RULE_TOOLS, WRITE_TOOLS } from "./rules";
import type { ConfigCheck, ConfigEdit, ConfigFinding } from "./types";

/**
 * Checks for configuration that won't apply as written. v0.1 includes only
 * checks that trace to a verified public report (docs/research/option-c), and
 * each rule states documented Claude Code behavior, linked in `docs`.
 */

const DOCS = "https://code.claude.com/docs/en";

const yamlFix = (error: string) =>
  error.includes("not closed") ? "Add a closing --- line after the last frontmatter field." : "Fix the YAML between the --- lines.";

/** The exact change for frontmatter that doesn't parse, when there is one: the missing ---, or quotes around a value. */
const yamlEdit = (markdown: MarkdownFile) => (markdown.error?.includes("not closed") ? closeFrontmatterEdit(markdown.file) : quoteValueEdit(markdown));

/** Spread into a finding: its edit and the edit's line, or nothing. */
const withEdit = (edit: ConfigEdit | undefined) => (edit ? { line: edit.line, edit } : {});

// ---------- Files that don't parse ----------

const unparsedFiles: ConfigCheck = {
  id: "file-does-not-parse",
  title: "Config file doesn't parse",
  description: "Settings or .mcp.json that isn't valid JSON, and skill, rule or command frontmatter that isn't valid YAML: Claude Code ignores what they set.",
  reports: ["R04"],
  docs: `${DOCS}/settings`,
  run: (model) => {
    const findings: ConfigFinding[] = [];
    for (const json of [...model.settings, ...model.mcp]) {
      if (!json.error) continue;
      findings.push({
        check: "file-does-not-parse",
        severity: "error",
        file: json.file.path,
        message: `${json.file.path} isn't valid JSON, so Claude Code ignores everything in it.`,
        detail: `Parser error: ${json.error}.`,
        fix: "Fix the JSON. `claude doctor` reports this too.",
        docs: `${DOCS}/settings`,
        reports: ["R04"],
      });
    }
    for (const markdown of [...model.skills, ...model.rules, ...model.commands]) {
      if (!markdown.error) continue;
      findings.push({
        check: "file-does-not-parse",
        severity: "error",
        file: markdown.file.path,
        message: `The frontmatter in ${markdown.file.path} doesn't parse, so its settings are ignored.`,
        detail: `YAML error: ${markdown.error}.`,
        fix: yamlFix(markdown.error),
        ...withEdit(yamlEdit(markdown)),
        docs: `${DOCS}/skills`,
        reports: ["R04"],
      });
    }
    return findings;
  },
};

// ---------- R07: an MCP server both enabled and disabled ----------

const mcpEnabledAndDisabled: ConfigCheck = {
  id: "mcp-enabled-and-disabled",
  title: "MCP server listed as both enabled and disabled",
  description: "An MCP server in both enabledMcpjsonServers and disabledMcpjsonServers. Disabled wins, so it doesn't load.",
  reports: ["R07"],
  docs: `${DOCS}/settings-reference#disabledmcpjsonservers`,
  run: (model) => {
    const enabled = new Map<string, string>();
    const disabled = new Map<string, string>();
    for (const settings of model.settings) {
      for (const name of asStringList(settings.data?.enabledMcpjsonServers) ?? []) enabled.set(name, settings.file.path);
      for (const name of asStringList(settings.data?.disabledMcpjsonServers) ?? []) disabled.set(name, settings.file.path);
    }
    return [...enabled].filter(([name]) => disabled.has(name)).map(([name, enabledIn]) => {
      const disabledIn = disabled.get(name)!;
      return {
        check: "mcp-enabled-and-disabled",
        severity: "warning" as const,
        file: disabledIn,
        line: lineOf(model.settings.find((settings) => settings.file.path === disabledIn)!.file, `"${name}"`),
        message: `MCP server "${name}" is in both enabledMcpjsonServers (${enabledIn}) and disabledMcpjsonServers (${disabledIn}), so it won't load.`,
        detail: "Rejection takes precedence: a server in disabledMcpjsonServers stays off, whatever enables it.",
        fix: `Remove "${name}" from one of the two lists.`,
        docs: `${DOCS}/settings-reference#disabledmcpjsonservers`,
        reports: ["R07"],
      };
    });
  },
};

// ---------- R09: settings in a parent folder ----------

const settingsInParentFolder: ConfigCheck = {
  id: "settings-in-parent-folder",
  title: "Project settings in a parent folder aren't loaded",
  description: ".claude/settings.json in a parent folder, which Claude Code doesn't load when a session starts in a subfolder.",
  reports: ["R09"],
  docs: `${DOCS}/settings#where-claude-code-looks-for-each-file`,
  run: (model) =>
    model.settings
      .filter((settings) => settings.file.scope === "ancestor")
      .map((settings) => {
        const rules = permissionRules([settings]).length;
        const hooks = hookEntries([settings]).length;
        const contents = [rules ? `${rules} permission rule${rules === 1 ? "" : "s"}` : "", hooks ? `${hooks} hook${hooks === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
        const folder = settings.file.path.replace(/\/?\.claude\/settings\.json$/, "") || ".";
        return {
          check: "settings-in-parent-folder",
          severity: "warning" as const,
          file: settings.file.path,
          message: `${settings.file.path} is in a parent folder, so Claude Code doesn't load it when it starts here${contents ? `: its ${contents} don't apply` : ""}.`,
          detail: "Claude Code reads the shared .claude/settings.json only from the folder a session starts in; there is no parent-folder fallback. (.claude/settings.local.json at the repository root, and CLAUDE.md files in parent folders, do load.)",
          fix: `Start Claude Code in ${folder}, or copy the rules and hooks you need into ./.claude/settings.json.`,
          docs: `${DOCS}/settings#where-claude-code-looks-for-each-file`,
          reports: ["R09"],
        };
      }),
};

// ---------- R10: allow rules for protected paths ----------

const PROTECTED_DIRS = [".git", ".config/git", ".vscode", ".idea", ".husky", ".cargo", ".devcontainer", ".yarn", ".mvn", ".claude"];
const PROTECTED_FILES = new Set([
  ".gitconfig", ".gitmodules", ".bashrc", ".bash_profile", ".bash_login", ".bash_aliases", ".bash_logout", ".zshrc", ".zprofile",
  ".zshenv", ".zlogin", ".zlogout", ".profile", ".envrc", ".npmrc", ".yarnrc", ".yarnrc.yml", ".pnp.cjs", ".pnp.loader.mjs",
  ".pnpmfile.cjs", "bunfig.toml", ".bunfig.toml", ".bazelrc", ".bazelversion", ".bazeliskrc", ".pre-commit-config.yaml",
  "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "gradle-wrapper.properties", "maven-wrapper.properties",
  ".devcontainer.json",
]);

/** The protected directory or file a path specifier targets, if any. */
export function protectedTarget(spec: string, userSettings: boolean): string | undefined {
  // A single leading slash in user settings anchors at ~/.claude, itself protected.
  if (userSettings && /^\/(?!\/)/.test(spec)) return ".claude";
  const segments = spec.replace(/^(\/\/|~\/|\.\/|\/)/, "").split("/").filter((segment) => segment && segment !== "**" && segment !== "*");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === ".claude") {
      if (segments[index + 1] === "worktrees") return undefined;
      return ".claude";
    }
    if (segment === ".config" && segments[index + 1] === "git") return ".config/git";
    if (PROTECTED_DIRS.includes(segment)) return segment;
  }
  const last = segments.at(-1);
  return last && PROTECTED_FILES.has(last) ? last : undefined;
}

const allowRuleProtectedPath: ConfigCheck = {
  id: "allow-rule-protected-path",
  title: "Allow rule can't pre-approve a protected path",
  description: "Allow rules for protected paths such as .claude/, .git/, .husky/ and .zshrc, which pre-approve nothing.",
  reports: ["R10"],
  docs: `${DOCS}/permission-modes#protected-paths`,
  run: (model) =>
    permissionRules(model.settings)
      .filter((rule) => rule.list === "allow" && WRITE_TOOLS.has(rule.tool) && rule.spec)
      .flatMap((rule) => {
        const target = protectedTarget(rule.spec!, rule.settings.file.scope === "user");
        if (!target) return [];
        return [{
          check: "allow-rule-protected-path",
          severity: "warning" as const,
          file: rule.settings.file.path,
          line: lineOf(rule.settings.file, rule.rule),
          message: `Allow rule ${rule.rule} can't pre-approve writes to ${target}, a protected path.`,
          detail: "Claude Code's protected-path check runs before allow rules from settings. Writes there are still prompted in default and acceptEdits modes, and go to the classifier in auto mode.",
          fix: "Remove the rule, and approve these writes when asked. The prompt offers a session-wide option for .claude/.",
          docs: `${DOCS}/permission-modes#protected-paths`,
          reports: ["R10"],
        }];
      }),
};

// ---------- R11: unknown agent frontmatter fields ----------

export const AGENT_FIELDS = [
  "name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns", "skills", "mcpServers", "hooks",
  "memory", "background", "omitClaudeMd", "effort", "isolation", "color", "initialPrompt", "experimental",
];
const normalizeField = (field: string) => field.toLowerCase().replace(/[-_\s]/g, "");
/** Skill and command fields that do nothing in an agent file. */
const SKILL_ONLY_FIELDS = new Set(["allowed-tools", "argument-hint", "when_to_use", "disable-model-invocation", "user-invocable", "context", "agent", "paths", "arguments"]);

const agentUnknownField: ConfigCheck = {
  id: "agent-unknown-field",
  title: "Agent frontmatter field Claude Code ignores",
  description: "Agent fields Claude Code ignores, such as allowed-tools where tools is meant, which leaves the agent with every tool.",
  reports: ["R11"],
  docs: `${DOCS}/sub-agents#supported-frontmatter-fields`,
  run: (model) =>
    model.agents.flatMap((agent) => {
      if (!agent.frontmatter) return [];
      const name = typeof agent.frontmatter.name === "string" ? agent.frontmatter.name : agent.file.path;
      const docs = `${DOCS}/sub-agents#supported-frontmatter-fields`;
      // x- fields are deliberate extensions for other tools.
      const unknown = Object.keys(agent.frontmatter).filter((field) => !AGENT_FIELDS.includes(field) && !field.startsWith("x-"));
      const findings: ConfigFinding[] = [];
      const other: string[] = [];
      for (const field of unknown) {
        const suggestion = field === "allowed-tools" ? "tools" : AGENT_FIELDS.find((known) => normalizeField(known) === normalizeField(field));
        // A near miss or a skill field was meant to do something: warn about each one.
        if (!suggestion && !SKILL_ONLY_FIELDS.has(field)) {
          other.push(field);
          continue;
        }
        const noTools = agent.frontmatter.tools === undefined;
        findings.push({
          check: "agent-unknown-field",
          severity: "warning",
          file: agent.file.path,
          line: frontmatterLine(agent, field),
          message: `Agent "${name}" has a field Claude Code ignores: ${field}.`,
          detail:
            field === "allowed-tools"
              ? `allowed-tools is a skill field. Agents use tools.${noTools ? " With no tools field, this agent can use every tool." : ""}`
              : suggestion
                ? "Claude Code ignores frontmatter fields it doesn't recognize, without reporting an error. Field names are camelCase and must match exactly."
                : `${field} is a skill field; agent files ignore it.`,
          fix: suggestion ? `Rename ${field} to ${suggestion}.` : `Remove ${field}.`,
          ...withEdit(suggestion ? renameFieldEdit(agent, field, suggestion) : undefined),
          docs,
          reports: ["R11"],
        });
      }
      // Anything else is often metadata for another tool: one note per file.
      if (other.length > 0) {
        findings.push({
          check: "agent-unknown-field",
          severity: "info",
          file: agent.file.path,
          line: frontmatterLine(agent, other[0]),
          message: `Agent "${name}" has ${other.length === 1 ? "a field" : `${other.length} fields`} Claude Code ignores: ${other.join(", ")}.`,
          detail: "Claude Code ignores frontmatter fields it doesn't recognize, without reporting an error.",
          fix: "No change needed if another tool reads these. Otherwise remove them.",
          docs,
          reports: ["R11"],
        });
      }
      return findings;
    }),
};

// ---------- R16: agent files Claude Code skips ----------

/** `skip` is set when the problem means Claude Code doesn't load the file as an agent: why, in a few words. */
type AgentProblem = Omit<ConfigFinding, "check" | "file" | "docs" | "reports"> & { skip?: string };

function agentProblems(agent: MarkdownFile): AgentProblem[] {
  if (!agent.opensWithFrontmatter) {
    return agent.frontmatterNotOnFirstLine
      ? [{ severity: "error", skip: "the --- block doesn't start on the first line", message: `Claude Code skips ${agent.file.path}: its --- block doesn't start on the first line, so the file reads as documentation.`, fix: "Move the opening --- to line 1." }]
      : [];
  }
  if (agent.error) {
    const skip = agent.error.includes("not closed") ? "the frontmatter isn't closed with ---" : "the frontmatter doesn't parse";
    return [{ severity: "error", skip, message: `Claude Code skips ${agent.file.path}: its frontmatter doesn't parse.`, detail: `YAML error: ${agent.error}.`, fix: yamlFix(agent.error), ...withEdit(yamlEdit(agent)) }];
  }
  const fm = agent.frontmatter ?? {};
  const problems: AgentProblem[] = [];
  const name = fm.name;
  if (name === undefined) {
    problems.push({ severity: "warning", skip: "the frontmatter has no name", message: `${agent.file.path} has frontmatter but no name, so Claude Code treats it as documentation, not an agent.`, fix: "Add a name field." });
    return problems;
  }
  if (typeof name !== "string" || name.startsWith("-") || name.includes(":")) {
    problems.push({ severity: "error", skip: "the name starts with - or contains :", line: frontmatterLine(agent, "name"), message: `Claude Code skips agent "${String(name)}": a name can't start with - or contain :.`, fix: "Rename the agent." });
  }
  if (typeof fm.description !== "string" || !fm.description.trim()) {
    problems.push({ severity: "error", skip: "there's a name but no description", line: frontmatterLine(agent, "name"), message: `Claude Code skips agent "${String(name)}": it has a name but no description.`, fix: "Add a description saying when to use the agent." });
  }
  if (fm.hooks !== undefined && !asRecord(fm.hooks)) {
    problems.push({
      severity: "error",
      skip: "hooks isn't a map of hook events",
      line: frontmatterLine(agent, "hooks"),
      message: `Agent "${String(name)}" has hooks written as ${Array.isArray(fm.hooks) ? "a list" : `a ${typeof fm.hooks}`}; it must be a map of hook events.`,
      detail: "hooks takes the settings.json shape, for example PreToolUse: [...]. In a reported case, `hooks: []` made Claude Code drop the whole agent without an error.",
      fix: "Remove hooks, or write it as a map of events.",
      ...withEdit(removeEmptyHooksEdit(agent)),
    });
  }
  for (const field of ["tools", "disallowedTools"]) {
    const value = fm[field];
    if (value !== undefined && typeof value !== "string" && !(Array.isArray(value) && value.every((item) => typeof item === "string"))) {
      problems.push({ severity: "warning", line: frontmatterLine(agent, field), message: `Agent "${String(name)}" has ${field} in a form Claude Code can't read; it takes a comma-separated string or a list of tool names.`, fix: `Write ${field} as a list of tool names.` });
    }
  }
  for (const field of ["skills", "mcpServers"]) {
    if (fm[field] !== undefined && !Array.isArray(fm[field])) {
      problems.push({ severity: "warning", line: frontmatterLine(agent, field), message: `Agent "${String(name)}" has ${field} that isn't a list.`, fix: `Write ${field} as a list.` });
    }
  }
  return problems;
}

/**
 * Why Claude Code doesn't load a file from an agents folder as an agent, in a
 * few words, or undefined when it does. The importer uses this, so a blueprint
 * holds only the agents Claude Code runs.
 */
export function agentSkipReason(agent: MarkdownFile): string | undefined {
  if (!agent.opensWithFrontmatter && !agent.frontmatterNotOnFirstLine) return "there's no frontmatter, so it reads as documentation";
  return agentProblems(agent).find((problem) => problem.skip)?.skip;
}

const agentNotLoaded: ConfigCheck = {
  id: "agent-not-loaded",
  title: "Agent file Claude Code skips",
  description: "Agent files Claude Code skips: frontmatter that doesn't parse or isn't closed, --- not on line 1, a name with : or a leading -, no description, or hooks written as a list.",
  reports: ["R16"],
  docs: `${DOCS}/sub-agents`,
  run: (model) =>
    model.agents.flatMap((agent) =>
      agentProblems(agent).map(({ skip: _skip, ...problem }) => ({ check: "agent-not-loaded", file: agent.file.path, docs: `${DOCS}/sub-agents`, reports: ["R16"], ...problem }))
    ),
};

// ---------- R12: agent references that don't resolve ----------

const BUILT_IN_AGENTS = ["Explore", "Plan", "general-purpose"];

/** Plugin agents are namespaced: plugin[:subfolder...]:name. */
function pluginAgentId(pluginName: string, agent: MarkdownFile): string | undefined {
  const name = agent.frontmatter?.name;
  if (typeof name !== "string") return undefined;
  const folders = agent.file.path.replace(/^agents\//, "").split("/").slice(0, -1);
  return [pluginName, ...folders, name].join(":");
}

const agentReferenceUnresolved: ConfigCheck = {
  id: "agent-reference-unresolved",
  title: "Skill runs in an agent that doesn't resolve",
  description: "A skill's agent: that doesn't resolve, including bare names for plugin agents, which are namespaced (plugin:agent).",
  reports: ["R12"],
  docs: `${DOCS}/plugins-reference#name`,
  run: (model) => {
    const available = new Set(BUILT_IN_AGENTS);
    const pluginLocal = new Map<string, string>();
    for (const agent of model.agents) {
      const name = agent.frontmatter?.name;
      if (typeof name !== "string") continue;
      if (agent.file.scope === "plugin" && model.pluginName) {
        const id = pluginAgentId(model.pluginName, agent);
        if (id) {
          available.add(id);
          pluginLocal.set(name, id);
        }
      } else {
        available.add(name);
      }
    }
    const userScanned = model.files.some((file) => file.scope === "user");
    return [...model.skills, ...model.commands].flatMap((skill) => {
      const agent = skill.frontmatter?.agent;
      if (typeof agent !== "string" || available.has(agent)) return [];
      // A reference into another plugin can't be checked from here.
      if (agent.includes(":") && !(model.pluginName && agent.startsWith(`${model.pluginName}:`))) return [];
      const scoped = pluginLocal.get(agent);
      return [{
        check: "agent-reference-unresolved",
        severity: scoped || userScanned ? ("warning" as const) : ("info" as const),
        file: skill.file.path,
        line: frontmatterLine(skill, "agent"),
        message: scoped
          ? `${skill.file.path} runs in agent "${agent}", but plugin agents are namespaced: this one is "${scoped}".`
          : `${skill.file.path} runs in agent "${agent}", which doesn't exist here${userScanned ? "" : " (user agents weren't checked)"}.`,
        detail: "An agent reference that doesn't resolve doesn't run the agent you expect. In a reported case, Claude Code silently used a different agent.",
        fix: scoped ? `Set agent to ${scoped}.` : `Use one of: ${[...available].sort().join(", ")}.`,
        ...withEdit(scoped ? setFieldEdit(skill, "agent", scoped) : undefined),
        docs: `${DOCS}/plugins-reference#name`,
        reports: ["R12"],
      }];
    });
  },
};

// ---------- R37: ask rules outrank a PreToolUse hook's allow ----------

const askRuleOverridesHook: ConfigCheck = {
  id: "ask-rule-overrides-hook",
  title: "Ask rules still prompt when a hook allows",
  description: "Ask rules that still prompt when a PreToolUse hook allows the call.",
  reports: ["R37"],
  docs: `${DOCS}/permissions#extend-permissions-with-hooks`,
  run: (model) => {
    const askRules = permissionRules(model.settings).filter((rule) => rule.list === "ask");
    return hookEntries(model.settings)
      .filter((hook) => hook.event === "PreToolUse")
      .flatMap((hook) => {
        const overlapping = askRules.filter((rule) => matcherMatches(hook.matcher, rule.tool));
        if (overlapping.length === 0) return [];
        return [{
          check: "ask-rule-overrides-hook",
          severity: "info" as const,
          file: hook.settings.file.path,
          line: lineOf(hook.settings.file, hook.command.slice(0, 40)),
          message: `The PreToolUse hook \`${hook.command}\` can't auto-approve calls that match these ask rules: ${overlapping.map((rule) => rule.rule).join(", ")}.`,
          detail: "Claude Code evaluates deny and ask rules regardless of what a PreToolUse hook returns: a matching ask rule still prompts even when the hook returned allow.",
          fix: "If the hook is meant to approve these calls, remove the overlapping ask rules. If you want the prompt, no change is needed.",
          docs: `${DOCS}/permissions#extend-permissions-with-hooks`,
          reports: ["R37"],
        }];
      });
  },
};

// ---------- R39: a single leading slash isn't absolute ----------

const LOOKS_ABSOLUTE = /^\/(Users|home|root|etc|var|tmp|opt|private|usr|srv|mnt|Volumes|Library|System)\//;

const singleSlashPath: ConfigCheck = {
  id: "single-slash-path",
  title: "Rule path with one leading slash isn't absolute",
  description: "Permission rules like Read(/Users/...): one leading slash anchors at the settings source, not the filesystem root.",
  reports: ["R39"],
  docs: `${DOCS}/permissions#read-and-edit`,
  run: (model) =>
    permissionRules(model.settings)
      .filter((rule) => PATH_RULE_TOOLS.has(rule.tool) && rule.spec && /^\/(?!\/)/.test(rule.spec))
      .flatMap((rule) => {
        const user = rule.settings.file.scope === "user";
        if (!user && !LOOKS_ABSOLUTE.test(rule.spec!)) return [];
        const pointsAt = user ? `~/.claude${rule.spec}` : `<project>${rule.spec}`;
        const line = lineOf(rule.settings.file, rule.rule);
        return [{
          check: "single-slash-path",
          severity: "warning" as const,
          file: rule.settings.file.path,
          line,
          message: `${rule.list === "deny" ? "Deny rule" : rule.list === "ask" ? "Ask rule" : "Allow rule"} ${rule.rule} points at ${pointsAt}, not ${rule.spec}.`,
          detail: `A single leading slash anchors at the settings source (${user ? "~/.claude for user settings" : "the project for project settings"}), not the filesystem root.${rule.list === "deny" ? " This deny rule doesn't protect what it appears to protect." : ""}`,
          fix: `Use /${rule.spec} (two slashes) for an absolute path${rule.spec!.startsWith("/Users/") || rule.spec!.startsWith("/home/") ? ", or ~/... for your home folder" : ""}.`,
          ...(LOOKS_ABSOLUTE.test(rule.spec!) ? withEdit(doubleSlashEdit(rule.settings.file, line, rule.rule, rule.spec!)) : {}),
          docs: `${DOCS}/permissions#read-and-edit`,
          reports: ["R39"],
        }];
      }),
};

// ---------- R41: nested CLAUDE.md files load on demand ----------

const RULE_WORDS = /\b(never|must|do not|don't|always|required?)\b/i;

const nestedInstructions: ConfigCheck = {
  id: "nested-claude-md",
  title: "CLAUDE.md in a subfolder loads only on demand",
  description: "CLAUDE.md files in subfolders, which load only after Claude reads a file in that folder.",
  reports: ["R41"],
  docs: `${DOCS}/memory#how-claude-md-files-load`,
  run: (model) =>
    model.instructions
      .filter((file) => file.nested && /(^|\/)CLAUDE(\.local)?\.md$/.test(file.path))
      .map((file) => {
        const folder = file.path.split("/").slice(0, -1).join("/");
        return {
          check: "nested-claude-md",
          severity: RULE_WORDS.test(file.content) ? ("warning" as const) : ("info" as const),
          file: file.path,
          message: `${file.path} loads only after Claude reads a file in ${folder}/ with the Read tool.`,
          detail: `Claude Code includes subfolder CLAUDE.md files on demand, not at launch. Work in ${folder}/ done with Bash or Edit before any Read there doesn't see these instructions. In a reported case, auto mode used Bash first.`,
          fix: "Move rules that must always apply to the root CLAUDE.md, or enforce them with permission rules or a hook.",
          docs: `${DOCS}/memory#how-claude-md-files-load`,
          reports: ["R41"],
        };
      }),
};

export const CONFIG_CHECKS: ConfigCheck[] = [
  unparsedFiles,
  mcpEnabledAndDisabled,
  settingsInParentFolder,
  allowRuleProtectedPath,
  agentUnknownField,
  agentNotLoaded,
  agentReferenceUnresolved,
  askRuleOverridesHook,
  singleSlashPath,
  nestedInstructions,
];

