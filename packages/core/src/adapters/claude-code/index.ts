import type { BlueprintIR } from "../../ir/types";
import type { AdapterOutput, ExportAdapter } from "../types";
import { generateAgentFile } from "./generators/agent";
import { generateClaudeMd } from "./generators/claudemd";
import { generatePolicyRuleFile } from "./generators/policy-rule";
import { generateSettingsFiles } from "./generators/settings";
import { generateSkillFile } from "./generators/skill";
import { generateLifecycleFiles } from "./generators/lifecycle";
import { lintClaudeCodeTools } from "./tools";
import { claudeCodeFidelity } from "./fidelity";
import { lintMcpSecrets } from "./mcp-lint";
import { claudeCodeOptionsSchema, telemetryEnv } from "./options";
import { toPluginLayout } from "./plugin";

export const CLAUDE_CODE_ADAPTER_ID = "claude-code";

function emit(ir: BlueprintIR, rawOptions?: unknown): AdapterOutput {
  const options = claudeCodeOptionsSchema.parse(rawOptions ?? {});
  const files: Record<string, string> = {};

  for (const agent of ir.agents) {
    const file = generateAgentFile(agent, ir);
    files[file.path] = file.content;
  }

  for (const skill of ir.skills) {
    const file = generateSkillFile(skill, ir);
    files[file.path] = file.content;
  }

  for (const rule of ir.rules) {
    const file = generatePolicyRuleFile(rule);
    files[file.path] = file.content;
  }

  Object.assign(files, generateSettingsFiles(ir.settings));
  Object.assign(files, generateLifecycleFiles(ir));

  const claude = generateClaudeMd(ir);
  if (claude) {
    files[claude.path] = claude.content;
  }

  if (options.telemetry) {
    const settings = JSON.parse(files[".claude/settings.json"] ?? "{}") as { env?: Record<string, string> };
    settings.env = { ...(settings.env ?? {}), ...telemetryEnv(options.telemetry) };
    files[".claude/settings.json"] = JSON.stringify(settings, null, 2);
  }

  const fidelity = claudeCodeFidelity(ir);
  if (options.layout === "plugin") {
    const plugin = toPluginLayout(files, ir, options);
    return {
      files: plugin.files,
      fidelity: { adapterId: CLAUDE_CODE_ADAPTER_ID, adapterVersion: claudeCodeAdapter.version, items: [...fidelity, ...plugin.fidelity] },
    };
  }

  return {
    files,
    fidelity: { adapterId: CLAUDE_CODE_ADAPTER_ID, adapterVersion: claudeCodeAdapter.version, items: fidelity },
  };
}

/** Claude Code project files: .claude/agents, skills, rules, settings, .mcp.json, CLAUDE.md. */
export const claudeCodeAdapter: ExportAdapter = {
  id: CLAUDE_CODE_ADAPTER_ID,
  version: "2.3.0",
  // Path collisions are reported by the build gate (graph/compliance.ts).
  lint: (ir) => [...lintClaudeCodeTools(ir), ...lintMcpSecrets(ir)],
  emit,
};
