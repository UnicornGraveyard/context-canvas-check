import { CONFIG_CHECKS } from "./checks";
import type { ConfigFinding, ConfigSeverity } from "./types";

/**
 * Presentation helpers shared by the CLI's text output and a browser report,
 * so both count and group findings the same way.
 */

/** Check titles by id, including drift findings, which come from the baseline comparison. */
export const CHECK_TITLES: ReadonlyMap<string, string> = new Map<string, string>([
  ...CONFIG_CHECKS.map((check) => [check.id, check.title] as [string, string]),
  ["config-drift", "Changed since the last baseline"],
]);

/** What each check catches, in one sentence, by id. */
export const CHECK_DESCRIPTIONS: ReadonlyMap<string, string> = new Map<string, string>([
  ...CONFIG_CHECKS.map((check) => [check.id, check.description] as [string, string]),
  ["config-drift", "Hooks, permission rules, MCP servers and agents added, removed or changed since the last recorded baseline."],
]);

const GROUP_AT = 3;

export function summarizeFindings(findings: ConfigFinding[]): Record<ConfigSeverity, number> {
  const counts: Record<ConfigSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * Findings that say the same thing about different files, as one group: 3 or
 * more with the same severity, check, detail and fix. Other findings stay
 * alone. Each group sits where its first finding was.
 */
export function groupFindings(findings: ConfigFinding[]): ConfigFinding[][] {
  const keyOf = (finding: ConfigFinding) => [finding.severity, finding.check, finding.detail ?? "", finding.fix ?? ""].join("\u0000");
  const byKey = new Map<string, ConfigFinding[]>();
  for (const finding of findings) {
    const members = byKey.get(keyOf(finding));
    if (members) members.push(finding);
    else byKey.set(keyOf(finding), [finding]);
  }
  const out: ConfigFinding[][] = [];
  const emitted = new Set<string>();
  for (const finding of findings) {
    const key = keyOf(finding);
    const members = byKey.get(key)!;
    if (members.length < GROUP_AT) out.push([finding]);
    else if (!emitted.has(key)) {
      out.push(members);
      emitted.add(key);
    }
  }
  return out;
}
