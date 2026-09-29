import type { z } from "zod";
import { parseFrontmatter } from "../adapters/claude-code/frontmatter";
import { agentSkipReason } from "../config/checks";
import { readMarkdown, type MarkdownFile } from "../config/model";
import {
  agentClassMetadataSchema,
  gateMetadataSchema,
  mcpServerSchema,
  skillMetadataSchema,
  STAGE_KINDS,
} from "../model/metadata";
import { slugify } from "../util/slug";

// Import: turns an existing Claude Code project (a .claude/ directory,
// .mcp.json, CLAUDE.md, AGENTS.md, or a plugin) into atoms and edges. Files a
// Context Canvas export generated (manifest, lifecycle.json, gate hooks,
// approval skills) are recognized, so exporting, importing and exporting
// again gives the same agents, skills, rules, settings and lifecycle.

export type ImportFile = { path: string; content: string };

export type ImportedAtom = {
  /** Stable key within the plan, e.g. "agent:reviewer"; edges refer to it. */
  key: string;
  type: "AGENT_CLASS" | "SKILL" | "POLICY" | "SETTING" | "FACT" | "STAGE" | "GATE" | "ARTIFACT";
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  /** The file the atom came from. */
  source: string;
};

export type ImportedEdge = { source: string; target: string; label: string; metadata?: Record<string, unknown> };

export type ImportNote = { level: "info" | "warning"; message: string; path?: string };

export type ImportPlan = {
  name: string | null;
  description: string | null;
  /** True when the files carry a Context Canvas export manifest. */
  fromContextCanvas: boolean;
  atoms: ImportedAtom[];
  edges: ImportedEdge[];
  notes: ImportNote[];
  /** Files that produced atoms or settings. */
  usedFiles: string[];
};

export const IMPORT_LIMITS = { files: 1000, fileBytes: 512 * 1024, atoms: 400, contentChars: 20000, titleChars: 140 } as const;

const MARKERS = [".claude/", ".claude-plugin/", ".context-canvas/", "AGENTS.md", "CLAUDE.md", ".mcp.json"];
const GATE_HOOK_MARKER = "context-canvas/gate.mjs";

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** "security-reviewer" -> "Security Reviewer". */
export function humanize(name: string): string {
  const words = name
    .replace(/\.md$/i, "")
    .split(/[-_\s]+/)
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || "Untitled";
}

/** Splits a tools value: a YAML list, or a string separated by commas or spaces (not inside parentheses). */
export function splitToolList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const tools: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "," || /\s/.test(char))) {
      if (current.trim()) tools.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) tools.push(current.trim());
  return tools;
}

function splitPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Strips one shared top-level folder (a zipped repository) and normalizes separators. */
export function normalizeImportPaths(files: ImportFile[]): ImportFile[] {
  const cleaned = files.map((file) => ({ ...file, path: file.path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "") }));
  const atRoot = cleaned.some((file) => MARKERS.some((marker) => file.path.startsWith(marker)));
  if (atRoot) return cleaned;
  const first = new Set(cleaned.map((file) => file.path.split("/")[0]));
  if (first.size !== 1) return cleaned;
  const [prefix] = [...first];
  return cleaned.filter((file) => file.path.startsWith(`${prefix}/`)).map((file) => ({ ...file, path: file.path.slice(prefix.length + 1) }));
}

/** The body after a frontmatter block. */
function stripFrontmatter(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "").trim();
}

/** Removes the "## TL;DR" block Context Canvas writes at the top of agent files. */
function stripTldr(body: string): string {
  if (!body.startsWith("## TL;DR")) return body;
  const end = body.indexOf("\n\n");
  return end < 0 ? "" : body.slice(end + 2).trim();
}

/** Keeps the fields a schema accepts one by one, and names the ones it rejects. */
function keepValid<T extends z.ZodObject>(schema: T, candidate: Json): { value: Json; rejected: string[] } {
  const value: Json = {};
  const rejected: string[] = [];
  for (const [key, raw] of Object.entries(candidate)) {
    if (raw === undefined) continue;
    const field = schema.shape[key] as z.ZodType | undefined;
    if (!field) continue;
    const parsed = field.safeParse(raw);
    if (parsed.success && parsed.data !== undefined) value[key] = parsed.data;
    else rejected.push(key);
  }
  return { value, rejected };
}

function describeWith(description: string | null, body: string, fallback: string): string {
  if (!description) return body || fallback;
  if (!body) return description;
  return body.startsWith(description) ? body : `${description}\n\n${body}`;
}

class PlanBuilder {
  atoms = new Map<string, ImportedAtom>();
  edges: ImportedEdge[] = [];
  notes: ImportNote[] = [];
  used = new Set<string>();
  /** Files a note already covers, such as agents Claude Code skips; they aren't counted as ignored. */
  reported = new Set<string>();

  /** Notes about something left out; the plan lists them first. */
  leftOut = new Set<ImportNote>();

  note(level: ImportNote["level"], message: string, path?: string) {
    this.notes.push({ level, message, ...(path ? { path } : {}) });
  }

  /** A note about a file or entry that was not imported. */
  skip(level: ImportNote["level"], message: string, path?: string) {
    this.note(level, message, path);
    this.leftOut.add(this.notes[this.notes.length - 1]);
  }

  add(atom: ImportedAtom): string {
    let content = atom.content.trim() || atom.title;
    if (content.length > IMPORT_LIMITS.contentChars) {
      this.note("warning", `Content was cut to ${IMPORT_LIMITS.contentChars} characters.`, atom.source);
      content = content.slice(0, IMPORT_LIMITS.contentChars);
    }
    const title = atom.title.slice(0, IMPORT_LIMITS.titleChars);
    this.atoms.set(atom.key, { ...atom, title, content });
    this.used.add(atom.source);
    return atom.key;
  }

  edge(source: string, target: string, label: string, metadata?: Json) {
    if (!this.atoms.has(source) || !this.atoms.has(target)) return;
    if (this.edges.some((edge) => edge.source === source && edge.target === target && edge.label === label)) return;
    this.edges.push({ source, target, label, ...(metadata ? { metadata } : {}) });
  }
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function mcpServers(raw: unknown, plan: PlanBuilder, path: string): Json {
  const servers: Json = {};
  if (!isRecord(raw)) return servers;
  for (const [name, config] of Object.entries(raw)) {
    const parsed = mcpServerSchema.safeParse(config);
    if (parsed.success) servers[name] = parsed.data;
    else plan.skip("warning", `MCP server "${name}" was skipped: its configuration is not a supported stdio, http or sse server.`, path);
  }
  const names = Object.keys(servers);
  if (names.length > 20) {
    plan.skip("warning", `Only the first 20 of ${names.length} MCP servers were imported.`, path);
    return Object.fromEntries(Object.entries(servers).slice(0, 20));
  }
  return servers;
}

const AGENT_KEYS = new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "maxTurns",
  "skills",
  "mcpServers",
  "hooks",
  "permissionMode",
  "effort",
  "isolation",
  "color",
  "background",
  "memory",
  "initialPrompt",
]);
const SKILL_KEYS = new Set([
  "name",
  "description",
  "when_to_use",
  "allowed-tools",
  "model",
  "user-invocable",
  "argument-hint",
  "disable-model-invocation",
  "context",
  "agent",
  "paths",
]);

function frontmatterOf(file: ImportFile, plan: PlanBuilder): Json | null {
  try {
    return parseFrontmatter(file.content) ?? {};
  } catch {
    plan.note("warning", "The frontmatter is not valid YAML; the file was imported without its settings.", file.path);
    return null;
  }
}

function importSkill(file: ImportFile, dirName: string, plan: PlanBuilder, fromContextCanvas: boolean) {
  const fm = frontmatterOf(file, plan) ?? {};
  const name = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : dirName;
  const body = stripFrontmatter(file.content);
  if (name.startsWith("approve-gate-") && (fromContextCanvas || body.includes(GATE_HOOK_MARKER))) {
    plan.used.add(file.path);
    return; // Generated from a HUMAN_APPROVAL gate; the gate itself is imported from lifecycle.json.
  }
  const description = typeof fm.description === "string" ? fm.description.trim() : null;
  let content = describeWith(description, body, humanize(name));
  if (typeof fm.when_to_use === "string" && fm.when_to_use.trim()) content += `\n\nWhen to use: ${fm.when_to_use.trim()}`;

  const { value, rejected } = keepValid(skillMetadataSchema, {
    allowedTools: fm["allowed-tools"] === undefined ? undefined : splitToolList(fm["allowed-tools"]),
    model: fm.model,
    userInvocable: fm["user-invocable"],
    argumentHint: fm["argument-hint"],
    disableModelInvocation: fm["disable-model-invocation"],
    context: fm.context,
    agent: fm.agent,
    paths: fm.paths === undefined ? undefined : splitPaths(fm.paths),
  });
  const unsupported = Object.keys(fm).filter((key) => !SKILL_KEYS.has(key));
  if (rejected.length > 0) plan.note("warning", `Invalid values were dropped: ${rejected.join(", ")}.`, file.path);
  if (unsupported.length > 0) plan.note("warning", `Not modeled yet, dropped: ${unsupported.join(", ")}.`, file.path);

  plan.add({ key: `skill:${slugify(name)}`, type: "SKILL", title: humanize(name), content, metadata: value, source: file.path });
}

/** The agent's name: its frontmatter name, or the file name. */
function agentName(markdown: MarkdownFile): string {
  const name = markdown.frontmatter?.name;
  return typeof name === "string" && name.trim() ? name.trim() : (markdown.file.path.split("/").pop() ?? "").replace(/\.md$/i, "");
}

/** Imports an agent file Claude Code loads (agentSkipReason is undefined). */
function importAgent(file: ImportFile, markdown: MarkdownFile, plan: PlanBuilder, projectServers: Set<string>) {
  const fm = markdown.frontmatter ?? {};
  const name = agentName(markdown);
  const slug = slugify(name);
  const description = typeof fm.description === "string" ? fm.description.trim() : null;
  const body = stripTldr(markdown.body.trim());

  const { value, rejected } = keepValid(agentClassMetadataSchema, {
    model: fm.model,
    maxTurns: fm.maxTurns,
    allowedTools: fm.tools === undefined ? undefined : splitToolList(fm.tools),
    deniedTools: fm.disallowedTools === undefined ? undefined : splitToolList(fm.disallowedTools),
    permissionMode: fm.permissionMode,
    effort: fm.effort,
    isolation: fm.isolation,
    color: fm.color,
    background: fm.background,
    memory: fm.memory,
    initialPrompt: fm.initialPrompt,
  });
  if (rejected.length > 0) plan.note("warning", `Invalid values were dropped: ${rejected.join(", ")}.`, file.path);
  const unsupported = Object.keys(fm).filter((key) => !AGENT_KEYS.has(key));
  if (unsupported.length > 0) plan.note("warning", `Unknown frontmatter keys were dropped: ${unsupported.join(", ")}.`, file.path);
  if (fm.hooks !== undefined && !JSON.stringify(fm.hooks).includes(GATE_HOOK_MARKER)) {
    plan.note("warning", "Hooks were dropped. Model gates as lifecycle GATE nodes instead; the export writes the hooks.", file.path);
  }

  const key = plan.add({ key: `agent:${slug}`, type: "AGENT_CLASS", title: humanize(name), content: describeWith(description, body, humanize(name)), metadata: value, source: file.path });

  // Inline MCP servers are scoped to this agent: a SETTING that CONFIGURES it.
  if (Array.isArray(fm.mcpServers)) {
    const inline: Json = {};
    for (const entry of fm.mcpServers) {
      if (typeof entry === "string") {
        if (!projectServers.has(entry)) plan.note("warning", `MCP server "${entry}" is referenced but not defined in .mcp.json.`, file.path);
      } else if (isRecord(entry)) {
        Object.assign(inline, entry);
      }
    }
    const servers = mcpServers(inline, plan, file.path);
    if (Object.keys(servers).length > 0) {
      const settingKey = plan.add({
        key: `setting:mcp:${slug}`,
        type: "SETTING",
        title: `${humanize(name)} MCP Servers`,
        content: `MCP servers only the ${humanize(name)} agent uses.`,
        metadata: { settingType: "mcp", mcpServers: servers },
        source: file.path,
      });
      plan.edge(settingKey, key, "CONFIGURES");
    }
  }
  return { key, skills: Array.isArray(fm.skills) ? fm.skills.filter((item): item is string => typeof item === "string") : [] };
}

function importRule(file: ImportFile, plan: PlanBuilder) {
  const fm = frontmatterOf(file, plan);
  if (fm && Object.keys(fm).length > 0) plan.note("warning", "Rule frontmatter (such as paths) is not modeled yet and was dropped.", file.path);
  const body = stripFrontmatter(file.content);
  const heading = body.match(/^#\s+(.+)\n?/);
  const fileName = file.path.split("/").pop() ?? file.path;
  const title = heading ? heading[1].trim() : humanize(fileName);
  const content = heading ? body.slice(heading[0].length).trim() : body;
  plan.add({
    key: `rule:${slugify(title)}`,
    type: "POLICY",
    title,
    content: content || title,
    metadata: { exportAsRule: true, inputs: [], outputs: [], preconditions: [], postconditions: [] },
    source: file.path,
  });
}

function importSettings(file: ImportFile, plan: PlanBuilder) {
  const json = parseJson(file.content);
  if (!isRecord(json)) {
    plan.skip("warning", "settings.json is not a JSON object and was skipped.", file.path);
    return;
  }
  const permissions = isRecord(json.permissions) ? json.permissions : {};
  const addPermissions = () => {
    const allow = splitToolList(permissions.allow);
    const deny = splitToolList(permissions.deny);
    if (allow.length === 0 && deny.length === 0) return;
    plan.add({
      key: "setting:permissions",
      type: "SETTING",
      title: "Project Permissions",
      content: "Tool permissions for everyone working in this project.",
      metadata: { settingType: "permissions", permissions: { allow: allow.slice(0, 200), deny: deny.slice(0, 200) } },
      source: file.path,
    });
  };
  const addEnvironment = () => {
    if (!isRecord(json.env)) return;
    const environment = Object.fromEntries(
      Object.entries(json.env).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(0, 100)
    );
    if (Object.keys(environment).length === 0) return;
    plan.add({
      key: "setting:environment",
      type: "SETTING",
      title: "Project Environment",
      content: "Environment variables Claude Code sets for this project.",
      metadata: { settingType: "environment", environment },
      source: file.path,
    });
  };
  // Keep the file's key order: the export writes settings in node order.
  for (const key of Object.keys(json)) {
    if (key === "permissions") addPermissions();
    if (key === "env") addEnvironment();
  }
  const otherPermissionKeys = Object.keys(permissions).filter((key) => key !== "allow" && key !== "deny");
  if (otherPermissionKeys.length > 0) plan.note("warning", `Permission settings not modeled yet: ${otherPermissionKeys.join(", ")}.`, file.path);

  if (json.hooks !== undefined && !JSON.stringify(json.hooks).includes(GATE_HOOK_MARKER)) {
    plan.note("warning", "Project hooks were dropped. Model gates as lifecycle GATE nodes; the export writes the hooks.", file.path);
  }
  const other = Object.keys(json).filter((key) => !["permissions", "env", "hooks", "$schema"].includes(key));
  if (other.length > 0) plan.note("warning", `Settings not modeled yet were dropped: ${other.join(", ")}.`, file.path);
}

type LifecycleRecord = {
  stages?: Array<{
    slug?: string;
    title?: string;
    kind?: string;
    order?: number;
    lead?: string | null;
    contributors?: string[];
    entryCriteria?: string[];
    exitCriteria?: string[];
    outcomeRubric?: string;
    maxIterations?: number;
    produces?: string[];
    consumes?: string[];
    gates?: Array<Json>;
  }>;
  artifacts?: Array<{ slug?: string; title?: string }>;
};

function gateMetadataFromRecord(record: Json): Json | null {
  const type = record.type;
  const candidate =
    type === "CHECK"
      ? { gateType: "CHECK", blocking: record.blocking, command: record.command, timeoutSec: record.timeoutSec }
      : type === "OUTCOME_RUBRIC"
        ? {
            gateType: "OUTCOME_RUBRIC",
            blocking: record.blocking,
            rubric: {
              criteria: record.criteria,
              passThreshold: record.passThreshold,
              ...(record.grader === "jev" ? { grader: "jev", model: record.model, minProbability: record.minProbability } : {}),
            },
          }
        : { gateType: "HUMAN_APPROVAL", blocking: record.blocking, approverRole: record.approverRole, requiredEvidence: record.requiredEvidence };
  const parsed = gateMetadataSchema.safeParse(JSON.parse(JSON.stringify(candidate)));
  return parsed.success ? (parsed.data as Json) : null;
}

function importLifecycle(file: ImportFile, plan: PlanBuilder) {
  const json = parseJson(file.content) as LifecycleRecord | undefined;
  if (!json || !Array.isArray(json.stages)) {
    plan.skip("warning", "lifecycle.json could not be read; stages were not imported.", file.path);
    return;
  }
  const artifactTitles = new Map((json.artifacts ?? []).filter((item) => item.slug).map((item) => [item.slug as string, item.title ?? humanize(item.slug as string)]));
  const stages = [...json.stages].filter((stage) => stage.slug && stage.title).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const artifactKey = (slug: string) =>
    plan.add({
      key: `artifact:${slug}`,
      type: "ARTIFACT",
      title: artifactTitles.get(slug) ?? humanize(slug),
      content: `Handed between stages: ${artifactTitles.get(slug) ?? slug}.`,
      metadata: null,
      source: file.path,
    });

  let previous: string | null = null;
  for (const stage of stages) {
    const kind = (STAGE_KINDS as readonly string[]).includes(stage.kind ?? "") ? stage.kind : "CUSTOM";
    const metadata: Json = {
      kind,
      entryCriteria: (stage.entryCriteria ?? []).slice(0, 20),
      exitCriteria: (stage.exitCriteria ?? []).slice(0, 20),
      ...(stage.outcomeRubric ? { outcomeRubric: stage.outcomeRubric } : {}),
      ...(stage.maxIterations ? { maxIterations: stage.maxIterations } : {}),
    };
    const stageKey = plan.add({
      key: `stage:${stage.slug}`,
      type: "STAGE",
      title: stage.title as string,
      content: (stage.exitCriteria ?? []).length > 0 ? `Done when: ${(stage.exitCriteria ?? []).join("; ")}.` : (stage.title as string),
      metadata,
      source: file.path,
    });
    if (previous) plan.edge(previous, stageKey, "NEXT");
    previous = stageKey;

    if (stage.lead) plan.edge(`agent:${stage.lead}`, stageKey, "ASSIGNED_TO", { role: "LEAD" });
    for (const contributor of stage.contributors ?? []) plan.edge(`agent:${contributor}`, stageKey, "ASSIGNED_TO", { role: "CONTRIBUTOR" });
    for (const slug of stage.produces ?? []) plan.edge(stageKey, artifactKey(slug), "PRODUCES");
    for (const slug of stage.consumes ?? []) plan.edge(stageKey, artifactKey(slug), "CONSUMES");

    for (const gate of stage.gates ?? []) {
      if (typeof gate.slug !== "string" || typeof gate.title !== "string") continue;
      const metadata = gateMetadataFromRecord(gate);
      if (!metadata) plan.note("warning", `Gate "${gate.title}" has settings this version cannot read; it was imported as a human approval.`, file.path);
      const gateKey = plan.add({
        key: `gate:${gate.slug}`,
        type: "GATE",
        title: gate.title,
        content: gate.title,
        metadata: metadata ?? { gateType: "HUMAN_APPROVAL", blocking: true, approverRole: "APPROVER", requiredEvidence: [] },
        source: file.path,
      });
      plan.edge(stageKey, gateKey, "GATED_BY");
    }
  }
}

const KNOWLEDGE_TYPES = new Set(["FACT", "DECISION", "TASK", "ARTIFACT", "POLICY", "SNIPPET"]);

/**
 * Knowledge nodes from a CLAUDE.md that Context Canvas generated: "## TYPE"
 * sections holding "### Title" entries. Also returns the team summary.
 */
function importGeneratedClaudeMd(file: ImportFile, plan: PlanBuilder): { summary: string | null } {
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  let type: string | null = null;
  let current: { title: string; body: string[] } | null = null;
  let summary: string | null = null;
  const flush = () => {
    if (type && current) {
      const content = current.body.join("\n").trim();
      const prefix = type === "ARTIFACT" ? "artifact" : "knowledge";
      plan.add({
        key: `${prefix}:${slugify(current.title)}`,
        type: type as ImportedAtom["type"],
        title: current.title,
        content: content || current.title,
        metadata: type === "POLICY" ? { exportAsRule: false, inputs: [], outputs: [], preconditions: [], postconditions: [] } : null,
        source: file.path,
      });
    }
    current = null;
  };
  for (const line of lines) {
    const section = line.match(/^## (.+)$/);
    if (section) {
      flush();
      type = KNOWLEDGE_TYPES.has(section[1].trim()) ? section[1].trim() : null;
      continue;
    }
    const entry = line.match(/^### (.+)$/);
    if (entry && type) {
      flush();
      current = { title: entry[1].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
    const teamSummary = line.match(/^- Summary: (.+)$/);
    if (!type && teamSummary) summary = teamSummary[1].trim();
  }
  flush();
  plan.used.add(file.path);
  return { summary };
}

/** Builds an import plan from project files. Pure: nothing is written. */
export function importClaudeProject(input: ImportFile[]): ImportPlan {
  const plan = new PlanBuilder();
  const files = normalizeImportPaths(input);
  const byPath = new Map(files.map((file) => [file.path, file]));

  const manifest = parseJson(byPath.get(".context-canvas/manifest.json")?.content ?? "");
  const fromContextCanvas = isRecord(manifest);
  const plugin = parseJson(byPath.get(".claude-plugin/plugin.json")?.content ?? "");
  const isPlugin = isRecord(plugin);

  let name: string | null = null;
  let description: string | null = null;
  if (fromContextCanvas && isRecord(manifest.blueprint) && typeof manifest.blueprint.name === "string") name = manifest.blueprint.name;
  if (isPlugin) {
    if (!name && typeof plugin.name === "string") name = humanize(plugin.name);
    if (typeof plugin.description === "string") description = plugin.description;
  }
  if (fromContextCanvas) plan.used.add(".context-canvas/manifest.json");
  if (isPlugin) plan.used.add(".claude-plugin/plugin.json");

  const prefixes = (dir: string) => [`.claude/${dir}/`, ...(isPlugin ? [`${dir}/`] : [])];

  // Project MCP servers first, so agent references can be checked.
  const projectServerNames = new Set<string>();
  const mcpFile = byPath.get(".mcp.json");
  if (mcpFile) {
    const json = parseJson(mcpFile.content);
    const servers = mcpServers(isRecord(json) ? json.mcpServers : undefined, plan, mcpFile.path);
    for (const serverName of Object.keys(servers)) projectServerNames.add(serverName);
    if (Object.keys(servers).length > 0) {
      plan.add({
        key: "setting:mcp",
        type: "SETTING",
        title: "Project MCP Servers",
        content: "MCP servers available to everyone working in this project.",
        metadata: { settingType: "mcp", mcpServers: servers },
        source: mcpFile.path,
      });
    } else if (!isRecord(json)) {
      plan.skip("warning", ".mcp.json is not valid JSON and was skipped.", mcpFile.path);
    }
  }

  for (const file of files) {
    for (const prefix of prefixes("skills")) {
      const rest = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : null;
      const match = rest?.match(/^([^/]+)\/SKILL\.md$/);
      if (match) importSkill(file, match[1], plan, fromContextCanvas);
    }
  }

  // Agents at any depth below agents/, as Claude Code reads them. Files it
  // doesn't load as agents are reported, not imported, and when two files
  // share a name the first in path order is kept.
  const agentFiles = files
    .filter((file) => /\.md$/i.test(file.path) && prefixes("agents").some((prefix) => file.path.startsWith(prefix)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const notAgents = new Map<string, string[]>();
  const agentSkills: Array<{ key: string; skills: string[]; path: string }> = [];
  for (const file of agentFiles) {
    const markdown = readMarkdown({ path: file.path, content: file.content, kind: "agent", scope: "project" });
    const reason = agentSkipReason(markdown);
    if (reason) {
      notAgents.set(reason, [...(notAgents.get(reason) ?? []), file.path]);
      plan.reported.add(file.path);
      continue;
    }
    const taken = plan.atoms.get(`agent:${slugify(agentName(markdown))}`);
    if (taken) {
      plan.skip("warning", `${taken.source} already uses this agent name, so this file was not imported.`, file.path);
      plan.reported.add(file.path);
      continue;
    }
    agentSkills.push({ ...importAgent(file, markdown, plan, projectServerNames), path: file.path });
  }
  for (const [reason, paths] of notAgents) {
    const listed = paths.length > 3 ? `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more` : paths.join(", ");
    plan.skip(
      reason.includes("documentation") ? "info" : "warning",
      paths.length === 1
        ? `Claude Code doesn't load this file as an agent, so it was not imported: ${reason}.`
        : `Claude Code doesn't load ${paths.length} files in agents folders, so they were not imported: ${reason} (${listed}).`,
      paths.length === 1 ? paths[0] : undefined
    );
  }
  for (const { key, skills, path } of agentSkills) {
    for (const skill of skills) {
      const skillKey = `skill:${slugify(skill)}`;
      if (plan.atoms.has(skillKey)) plan.edge(key, skillKey, "COMPOSES");
      else plan.note("warning", `Skill "${skill}" is listed but not in the imported files.`, path);
    }
  }

  for (const file of files) {
    if (file.path.startsWith(".claude/rules/") && file.path.toLowerCase().endsWith(".md")) importRule(file, plan);
  }

  const settings = byPath.get(".claude/settings.json");
  if (settings) importSettings(settings, plan);
  if (byPath.has(".claude/settings.local.json")) {
    plan.used.add(".claude/settings.local.json");
    plan.note("info", "settings.local.json holds personal settings and was not imported.", ".claude/settings.local.json");
  }

  const lifecycle = byPath.get(".context-canvas/lifecycle.json");
  if (lifecycle) importLifecycle(lifecycle, plan);

  for (const doc of ["CLAUDE.md", "AGENTS.md"]) {
    const file = byPath.get(doc) ?? byPath.get(`.claude/${doc}`);
    if (!file) continue;
    if (fromContextCanvas) {
      // Generated files: CLAUDE.md carries the knowledge nodes; the rest is rebuilt on export.
      if (doc === "CLAUDE.md") {
        const { summary } = importGeneratedClaudeMd(file, plan);
        if (!description && summary) description = summary;
      } else {
        plan.used.add(file.path);
      }
      continue;
    }
    plan.add({
      key: `doc:${doc}`,
      type: "FACT",
      title: `Project Instructions (${doc})`,
      content: stripFrontmatter(file.content),
      metadata: null,
      source: file.path,
    });
  }

  for (const path of [".claude/hooks/context-canvas/gate.mjs"]) if (byPath.has(path)) plan.used.add(path);

  const atoms = [...plan.atoms.values()];
  if (atoms.length > IMPORT_LIMITS.atoms) {
    plan.skip("warning", `Only the first ${IMPORT_LIMITS.atoms} of ${atoms.length} nodes were imported.`);
  }
  const kept = atoms.slice(0, IMPORT_LIMITS.atoms);
  const keptKeys = new Set(kept.map((atom) => atom.key));
  const skipped = files.filter((file) => !plan.used.has(file.path) && !plan.reported.has(file.path));
  if (skipped.length > 0) {
    plan.note("info", `${skipped.length} file${skipped.length === 1 ? " was" : "s were"} not part of a Claude Code project setup and ${skipped.length === 1 ? "was" : "were"} ignored.`);
  }
  if (kept.length === 0) plan.note("warning", "No agents, skills, rules, settings or instructions were found.");

  return {
    name,
    description,
    fromContextCanvas,
    atoms: kept,
    edges: plan.edges.filter((edge) => keptKeys.has(edge.source) && keptKeys.has(edge.target)),
    notes: [...plan.notes.filter((note) => plan.leftOut.has(note)), ...plan.notes.filter((note) => !plan.leftOut.has(note))],
    usedFiles: [...plan.used].sort(),
  };
}
