import { CONFIG_CHECKS } from "./checks";
import { compareToBaseline, configFingerprint, type ConfigBaseline } from "./drift";
import { buildConfigModel } from "./model";
import type { ConfigFinding, ConfigSeverity, ConfigSnapshot } from "./types";

export * from "./types";
export { buildConfigModel, readMarkdown, type ConfigModel, type JsonFile, type MarkdownFile } from "./model";
export { parseRule, permissionRules, hookEntries, matcherMatches } from "./rules";
export { CONFIG_CHECKS, AGENT_FIELDS, agentSkipReason, protectedTarget } from "./checks";
export { configFingerprint, compareToBaseline, type ConfigBaseline } from "./drift";
export {
  CONFIG_WALK,
  mightBeConfigPath,
  shouldDescend,
  snapshotFromProjectFiles,
  type ProjectFile,
  type ProjectFilesOptions,
  type ProjectFilesResult,
} from "./project-files";
export { CHECK_DESCRIPTIONS, CHECK_TITLES, groupFindings, summarizeFindings } from "./summary";
export { buildFixPrompt, describeEdit, fixableFindings, type FixPromptOptions } from "./fix-prompt";

const SEVERITY_ORDER: Record<ConfigSeverity, number> = { error: 0, warning: 1, info: 2 };

export type CheckConfigResult = {
  findings: ConfigFinding[];
  /** The fingerprint of the configuration as checked, to record as the next baseline. */
  fingerprint: ConfigBaseline;
};

/**
 * Runs every check on a snapshot. With a baseline, also reports drift since
 * it was recorded. Findings come sorted: errors, then warnings, then info.
 */
export function checkConfig(snapshot: ConfigSnapshot, options: { baseline?: ConfigBaseline | null; now?: string } = {}): CheckConfigResult {
  const model = buildConfigModel(snapshot);
  const fingerprint = configFingerprint(model, options.now ?? new Date().toISOString());
  const findings = CONFIG_CHECKS.flatMap((check) => check.run(model));
  if (options.baseline) findings.push(...compareToBaseline(options.baseline, fingerprint));
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { findings, fingerprint };
}
