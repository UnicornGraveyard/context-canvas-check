import type { SourceAtom as Atom, SourceEdge as Edge } from "../model/source";
import { slugify } from "../util/slug";
import type { IRSettings, IRSettingsScope } from "./types";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function mergePermissions(
  target: IRSettingsScope | Record<string, unknown>,
  permissionsValue: unknown
) {
  const permissionsObject = asObject(permissionsValue);
  if (!permissionsObject) return;

  const existingPermissions = asObject((target as IRSettingsScope).permissions ?? null);
  const existingAllow = asStringArray(existingPermissions?.allow);
  const existingDeny = asStringArray(existingPermissions?.deny);
  const nextAllow = asStringArray(permissionsObject.allow);
  const nextDeny = asStringArray(permissionsObject.deny);

  (target as IRSettingsScope).permissions = {
    allow: dedupe([...existingAllow, ...nextAllow]),
    deny: dedupe([...existingDeny, ...nextDeny]),
  };
}

function mergeEnv(target: IRSettingsScope | Record<string, unknown>, envValue: unknown) {
  const envObject = asObject(envValue);
  if (!envObject) return;

  const existing = (target as IRSettingsScope).env ?? {};
  const merged: Record<string, string> = { ...existing };
  for (const [key, value] of Object.entries(envObject)) {
    if (typeof value !== "string") continue;
    merged[key] = value;
  }

  (target as IRSettingsScope).env = merged;
}

function mergeMcpServers(target: IRSettingsScope | Record<string, unknown>, mcpValue: unknown) {
  const mcpObject = asObject(mcpValue);
  if (!mcpObject) return;

  const existing = (target as IRSettingsScope).mcpServers ?? {};
  (target as IRSettingsScope).mcpServers = {
    ...existing,
    ...mcpObject,
  };
}

function applySettingMetadata(
  target: IRSettingsScope | Record<string, unknown>,
  metadata: Record<string, unknown>
) {
  const settingType = metadata.settingType;

  if (settingType === "permissions") {
    mergePermissions(target, metadata.permissions);
  }

  if (settingType === "environment") {
    mergeEnv(target, metadata.environment);
  }

  if (settingType === "mcp") {
    mergeMcpServers(target, metadata.mcpServers);
  }
}

/**
 * Merges SETTING atoms into global settings (in atom order) and per-target
 * scopes (CONFIGURES edges, in edge order). Permission allow rules from scoped
 * settings stay in their scope; everything else is also merged globally.
 */
export function compileSettings(settingAtoms: Atom[], atoms: Atom[], edges: Edge[]): IRSettings {
  const claudeSettings: Record<string, unknown> = {};
  const mcpConfig: Record<string, unknown> = {};

  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const settingsById = new Map(settingAtoms.map((atom) => [atom.id, atom]));

  // Settings attached to an agent or skill through CONFIGURES are scoped.
  const scopedSettingIds = new Set(
    edges
      .filter((edge) => {
        if (edge.label !== "CONFIGURES" || !settingsById.has(edge.sourceAtomId)) return false;
        const target = atomById.get(edge.targetAtomId);
        return target?.type === "AGENT_CLASS" || target?.type === "SKILL";
      })
      .map((edge) => edge.sourceAtomId)
  );

  // Settings whose every CONFIGURES target is an agent can stay with those
  // agents (agent frontmatter supports MCP servers and denied tools).
  const agentOnlySettingIds = new Set(
    [...scopedSettingIds].filter((settingId) =>
      edges
        .filter((edge) => edge.label === "CONFIGURES" && edge.sourceAtomId === settingId)
        .every((edge) => atomById.get(edge.targetAtomId)?.type !== "SKILL")
    )
  );

  for (const atom of settingAtoms) {
    const metadata = asObject(atom.metadata) ?? {};
    const settingType = metadata.settingType;
    const agentOnly = agentOnlySettingIds.has(atom.id);

    if (settingType === "permissions") {
      if (scopedSettingIds.has(atom.id)) {
        // A scoped allow rule must not widen permissions for every agent, so
        // only deny rules (the safe direction) reach the global settings. For
        // agent-only settings, bare tool denies become the agents' own
        // disallowedTools; pattern denies (Tool(spec)) still go global.
        const deny = asStringArray(asObject(metadata.permissions)?.deny).filter((rule) => !agentOnly || rule.includes("("));
        if (deny.length > 0) mergePermissions(claudeSettings, { deny });
      } else {
        mergePermissions(claudeSettings, metadata.permissions);
      }
    }

    if (settingType === "environment") {
      // Claude Code has no per-agent environment, so scoped variables are project-wide.
      mergeEnv(claudeSettings, metadata.environment);
    }

    if (settingType === "mcp" && !agentOnly) {
      mergeMcpServers(mcpConfig, metadata.mcpServers);
    }
  }

  const scoped = {
    agents: {} as Record<string, IRSettingsScope>,
    skills: {} as Record<string, IRSettingsScope>,
  };

  for (const edge of edges) {
    if (edge.label !== "CONFIGURES") continue;

    const sourceSetting = settingsById.get(edge.sourceAtomId);
    if (!sourceSetting) continue;

    const target = atomById.get(edge.targetAtomId);
    if (!target) continue;
    if (target.type !== "AGENT_CLASS" && target.type !== "SKILL") continue;

    const metadata = asObject(sourceSetting.metadata) ?? {};
    const targetKey = slugify(target.title);
    const group = target.type === "AGENT_CLASS" ? scoped.agents : scoped.skills;
    const scopeEntry = group[targetKey] ?? {};
    applySettingMetadata(scopeEntry, metadata);
    const existingSources = scopeEntry.sources ?? [];
    scopeEntry.sources = dedupe([...existingSources, sourceSetting.title]);
    group[targetKey] = scopeEntry;
  }

  const hasAgentOrSkillConfigures = edges.some((edge) => {
    if (edge.label !== "CONFIGURES") return false;
    const target = atoms.find((atom) => atom.id === edge.targetAtomId);
    return target?.type === "AGENT_CLASS" || target?.type === "SKILL";
  });

  return {
    global: claudeSettings as IRSettings["global"],
    mcpServers: (asObject(mcpConfig.mcpServers) ?? {}) as Record<string, unknown>,
    scoped,
    hasAgentOrSkillConfigures,
  };
}
