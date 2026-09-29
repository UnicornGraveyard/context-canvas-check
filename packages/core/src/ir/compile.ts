import type { SourceAtom, SourceEdge } from "../model/source";
import { slugify } from "../util/slug";
import { resolveAgentInheritance, resolveComposedSkills } from "./inheritance";
import { compileSettings } from "./settings";
import { isLeadAssignment, orderStages } from "../graph/lifecycle";
import { gateMetadataSchema, stageMetadataSchema } from "../model/metadata";
import {
  IR_VERSION,
  type BlueprintIR,
  type Diagnostic,
  type IRAgent,
  type IRKnowledge,
  type IRLifecycle,
  type IRSkill,
  type RawMetadata,
} from "./types";

export type CompileSource = {
  atoms: SourceAtom[];
  edges: SourceEdge[];
};

export type BlueprintMeta = {
  name?: string;
  description?: string;
};

export type CompileResult = {
  ir: BlueprintIR;
  diagnostics: Diagnostic[];
};

const KNOWLEDGE_TYPES = new Set(["FACT", "DECISION", "TASK", "ARTIFACT", "POLICY", "SNIPPET"]);

function rawMetadata(value: unknown): RawMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isPolicyRule(atom: SourceAtom): boolean {
  return atom.type === "POLICY" && rawMetadata(atom.metadata)?.exportAsRule === true;
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function toSkill(atom: SourceAtom): IRSkill {
  return {
    id: atom.id,
    title: atom.title,
    slug: slugify(atom.title),
    content: atom.content,
    metadata: rawMetadata(atom.metadata),
  };
}

function compileAgent(agent: SourceAtom, atoms: SourceAtom[], edges: SourceEdge[], composeCount: Map<string, number>): IRAgent {
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const skillIds = resolveComposedSkills(agent.id, edges).filter((id) => atomById.get(id)?.type === "SKILL");

  const base: IRAgent = {
    id: agent.id,
    title: agent.title,
    slug: slugify(agent.title),
    content: agent.content,
    metadata: rawMetadata(agent.metadata),
    ancestors: [],
    config: null,
    skillIds,
    directComposeCount: composeCount.get(agent.id) ?? 0,
  };

  // Malformed metadata can make the merge throw. Keep compiling the rest of the
  // blueprint; renderers re-raise this error for this agent only.
  try {
    const resolved = resolveAgentInheritance(agent, atoms, edges);
    return {
      ...base,
      ancestors: resolved.chain
        .slice(0, -1)
        .filter((ancestor) => ancestor.id !== agent.id)
        .map((ancestor) => ({ id: ancestor.id, title: ancestor.title, slug: slugify(ancestor.title) })),
      config: {
        model: resolved.metadata.model,
        maxTurns: resolved.metadata.maxTurns,
        allowedTools: resolved.metadata.allowedTools ?? [],
        deniedTools: resolved.metadata.deniedTools ?? [],
        promptSections: resolved.metadata.promptSections ?? {},
        prompt: resolved.prompt,
        // Optional keys stay absent when unset, so existing IR hashes do not change.
        ...pick(resolved.metadata, ["permissionMode", "effort", "isolation", "color", "background", "memory", "initialPrompt"]),
      },
    };
  } catch (error) {
    return { ...base, configError: error instanceof Error ? error.message : String(error) };
  }
}

function compileLifecycle(atoms: CompileSource["atoms"], edges: CompileSource["edges"]): IRLifecycle | null {
  const order = orderStages(atoms, edges);
  if (order.stages.length === 0) return null;

  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const slugOf = (id: string) => {
    const atom = atomById.get(id);
    return atom ? slugify(atom.title) : null;
  };
  const targets = (stageId: string, label: string) =>
    edges
      .filter((edge) => edge.label === label && edge.sourceAtomId === stageId)
      .map((edge) => slugOf(edge.targetAtomId))
      .filter((slug): slug is string => slug !== null)
      .sort();

  const stages = order.stages.map((stage, index) => {
    const parsed = stageMetadataSchema.safeParse(stage.metadata ?? {});
    const config = parsed.success ? parsed.data : stageMetadataSchema.parse({});
    const assignments = edges.filter((edge) => edge.label === "ASSIGNED_TO" && edge.targetAtomId === stage.id);
    const lead = assignments.find(isLeadAssignment);
    const gates = edges
      .filter((edge) => edge.label === "GATED_BY" && edge.sourceAtomId === stage.id)
      .map((edge) => atomById.get(edge.targetAtomId))
      .filter((gate): gate is NonNullable<typeof gate> => gate !== undefined && gate.type === "GATE")
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
      .map((gate) => {
        const gateConfig = gateMetadataSchema.safeParse(gate.metadata ?? {});
        return {
          id: gate.id,
          title: gate.title,
          slug: slugify(gate.title),
          content: gate.content,
          config: gateConfig.success ? gateConfig.data : null,
          ...(gateConfig.success ? {} : { configError: gateConfig.error.issues[0]?.message ?? "invalid gate settings" }),
        };
      });

    return {
      id: stage.id,
      title: stage.title,
      slug: slugify(stage.title),
      content: stage.content,
      order: index + 1,
      kind: config.kind,
      entryCriteria: config.entryCriteria,
      exitCriteria: config.exitCriteria,
      ...(config.outcomeRubric ? { outcomeRubric: config.outcomeRubric } : {}),
      ...(config.maxIterations ? { maxIterations: config.maxIterations } : {}),
      lead: lead ? slugOf(lead.sourceAtomId) : null,
      contributors: assignments
        .filter((edge) => !isLeadAssignment(edge))
        .map((edge) => slugOf(edge.sourceAtomId))
        .filter((slug): slug is string => slug !== null)
        .sort(),
      gates,
      produces: targets(stage.id, "PRODUCES"),
      consumes: targets(stage.id, "CONSUMES"),
    };
  });

  const artifactIds = new Set(
    edges.filter((edge) => edge.label === "PRODUCES" || edge.label === "CONSUMES").map((edge) => edge.targetAtomId)
  );
  const artifacts = atoms
    .filter((atom) => artifactIds.has(atom.id) && atom.type === "ARTIFACT")
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((atom) => ({ id: atom.id, title: atom.title, slug: slugify(atom.title), content: atom.content }));

  return { stages, artifacts, linear: order.linear };
}

/**
 * Builds the Blueprint IR from a pack's atoms (in pack order) and edges.
 * Pure and deterministic; always returns an IR so previews work on invalid
 * graphs. Graph and export validation stay in the build gate for now.
 */
export function compile(source: CompileSource, meta: BlueprintMeta = {}): CompileResult {
  const { atoms, edges } = source;

  const composeCount = new Map<string, number>();
  for (const edge of edges) {
    if (edge.label !== "COMPOSES") continue;
    composeCount.set(edge.sourceAtomId, (composeCount.get(edge.sourceAtomId) ?? 0) + 1);
  }

  const knowledge: IRKnowledge[] = atoms
    .filter((atom) => !isPolicyRule(atom) && KNOWLEDGE_TYPES.has(atom.type))
    .map((atom) => ({ id: atom.id, type: atom.type, title: atom.title, content: atom.content }));

  const ir: BlueprintIR = {
    irVersion: IR_VERSION,
    blueprint: {
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.description ? { description: meta.description } : {}),
    },
    agents: atoms
      .filter((atom) => atom.type === "AGENT_CLASS")
      .map((agent) => compileAgent(agent, atoms, edges, composeCount)),
    skills: atoms.filter((atom) => atom.type === "SKILL").map(toSkill),
    rules: atoms.filter(isPolicyRule).map(toSkill),
    knowledge,
    settings: compileSettings(atoms.filter((atom) => atom.type === "SETTING"), atoms, edges),
    lifecycle: compileLifecycle(atoms, edges),
  };

  return { ir, diagnostics: [] };
}
