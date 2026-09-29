import { asRecord, asStringList, type ConfigModel } from "./model";
import { hookEntries, permissionRules } from "./rules";
import type { ConfigFinding } from "./types";

/**
 * Drift: what changed in hooks, permissions, MCP servers, agents and settings
 * keys since a recorded baseline. Tools and agents rewrite config without
 * notice (reports R06, R36, R40), so the only reliable signal is comparison.
 * Values that could hold secrets (MCP config, frontmatter) are stored as
 * hashes, never as text.
 */

export type ConfigBaseline = {
  version: 1;
  recordedAt: string;
  /** Key: a JSON array naming the entry. Value: "1" for presence, or a hash or short value. */
  entries: Record<string, string>;
};

/** FNV-1a, 32-bit, hex. Enough to notice a change; not a security hash. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const key = (...parts: string[]) => JSON.stringify(parts);

export function configFingerprint(model: ConfigModel, recordedAt: string): ConfigBaseline {
  const entries: Record<string, string> = {};
  const valid = model.settings.filter((settings) => settings.data);
  for (const settings of valid) {
    const path = settings.file.path;
    entries[key("settings-keys", path)] = Object.keys(settings.data!).sort().join(",");
    const permissions = asRecord(settings.data!.permissions);
    if (typeof permissions?.defaultMode === "string") entries[key("default-mode", path)] = permissions.defaultMode;
    for (const list of ["enabledMcpjsonServers", "disabledMcpjsonServers"]) {
      for (const name of asStringList(settings.data![list]) ?? []) entries[key(list, path, name)] = "1";
    }
    if (settings.data!.enableAllProjectMcpServers !== undefined) entries[key("enableAllProjectMcpServers", path)] = String(settings.data!.enableAllProjectMcpServers);
  }
  for (const hook of hookEntries(valid)) entries[key("hook", hook.settings.file.path, hook.event, hook.matcher, hook.command)] = "1";
  for (const rule of permissionRules(valid)) entries[key("permission", rule.settings.file.path, rule.list, rule.rule)] = "1";
  for (const mcp of model.mcp) {
    for (const [name, server] of Object.entries(asRecord(mcp.data?.mcpServers) ?? {})) entries[key("mcp-server", mcp.file.path, name)] = hash(canonical(server));
  }
  for (const agent of model.agents) {
    if (agent.frontmatter) entries[key("agent", agent.file.path)] = hash(canonical(agent.frontmatter));
  }
  return { version: 1, recordedAt, entries };
}

type Change = "added" | "removed" | "changed";
const MAX_FINDINGS = 25;

function describe(parts: string[], change: Change, previous: string | undefined, current: string | undefined, since: string): Omit<ConfigFinding, "check" | "docs" | "reports"> {
  const [kind, path, ...rest] = parts;
  switch (kind) {
    case "hook": {
      const [event, matcher, command] = rest;
      return { severity: "warning", file: path, message: `A ${event}${matcher ? ` [${matcher}]` : ""} hook was ${change} in ${path} since ${since}: \`${command}\`.`, fix: change === "removed" ? "If it was a guard you rely on, restore it." : "Confirm you (or a tool you installed) added it." };
    }
    case "permission": {
      const [list, rule] = rest;
      const widening = (change === "added" && list === "allow") || (change === "removed" && list !== "allow");
      return { severity: widening ? "warning" : "info", file: path, message: `The ${list} rule ${rule} was ${change} in ${path} since ${since}.` };
    }
    case "default-mode":
      return { severity: "warning", file: path, message: `defaultMode in ${path} ${change === "changed" ? `changed from ${previous} to ${current}` : change === "added" ? `was set to ${current}` : `(${previous}) was removed`} since ${since}.` };
    case "mcp-server":
      return { severity: change === "removed" ? "info" : "warning", file: path, message: `MCP server "${rest[0]}" was ${change} in ${path} since ${since}.` };
    case "agent":
      return { severity: "info", file: path, message: `Agent ${path} was ${change} since ${since}.` };
    case "settings-keys": {
      const before = new Set((previous ?? "").split(",").filter(Boolean));
      const after = new Set((current ?? "").split(",").filter(Boolean));
      const lost = [...before].filter((item) => !after.has(item));
      if (change === "removed") return { severity: "warning", file: path, message: `${path} is gone since ${since}${before.size ? ` (it had: ${[...before].join(", ")})` : ""}.` };
      if (lost.length > 0) return { severity: "warning", file: path, message: `${path} lost settings since ${since}: ${lost.join(", ")}.`, fix: "If a tool rewrote the file, restore the missing settings." };
      return { severity: "info", file: path, message: `${path} ${change === "added" ? "appeared" : "gained settings"} since ${since}.` };
    }
    default:
      return { severity: "info", file: path, message: `${kind} ${rest.join(" ")} in ${path} was ${change} since ${since}.` };
  }
}

export function compareToBaseline(baseline: ConfigBaseline, current: ConfigBaseline): ConfigFinding[] {
  const since = baseline.recordedAt.slice(0, 10);
  const changes: [string[], Change, string | undefined, string | undefined][] = [];
  for (const [entry, value] of Object.entries(current.entries)) {
    if (!(entry in baseline.entries)) changes.push([JSON.parse(entry), "added", undefined, value]);
    else if (baseline.entries[entry] !== value) changes.push([JSON.parse(entry), "changed", baseline.entries[entry], value]);
  }
  for (const [entry, value] of Object.entries(baseline.entries)) {
    if (!(entry in current.entries)) changes.push([JSON.parse(entry), "removed", value, undefined]);
  }
  const findings: ConfigFinding[] = changes
    .map(([parts, change, previous, value]) => ({ kind: parts[0], ...describe(parts, change, previous, value, since) }))
    // A settings file that only gained keys is reported through its other entries (hooks, rules).
    .filter((finding) => !(finding.kind === "settings-keys" && finding.severity === "info"))
    .map(({ kind: _kind, ...finding }) => ({ check: "config-drift", docs: "https://code.claude.com/docs/en/settings", reports: ["R36", "R06", "R40"], ...finding }));
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
  if (findings.length <= MAX_FINDINGS) return findings;
  const rest = findings.length - MAX_FINDINGS;
  return [
    ...findings.slice(0, MAX_FINDINGS),
    { check: "config-drift", severity: "info", file: "", message: `${rest} more change${rest === 1 ? "" : "s"} since ${since}.`, docs: "https://code.claude.com/docs/en/settings", reports: ["R36", "R06", "R40"] },
  ];
}
