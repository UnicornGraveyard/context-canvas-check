import type { SourceAtom as Atom, SourceEdge as Edge } from "../model/source";

type PromptSections = {
  role?: string;
  constraints?: string;
  style?: string;
  custom?: Record<string, string>;
};

type AgentMetadata = {
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  deniedTools?: string[];
  promptSections?: PromptSections;
  permissionMode?: string;
  effort?: string;
  isolation?: string;
  color?: string;
  background?: boolean;
  memory?: string;
  initialPrompt?: string;
};

/** Scalar settings a child agent inherits unless it sets its own. */
const INHERITED_SCALARS = ["permissionMode", "effort", "isolation", "color", "memory", "initialPrompt"] as const;

export type ResolvedAgent = {
  chain: Atom[];
  metadata: AgentMetadata;
  prompt: string;
};

export function resolveAgentInheritance(agent: Atom, atoms: Atom[], edges: Edge[]): ResolvedAgent {
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const parentIdsByChild = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.label !== "EXTENDS") continue;
    const list = parentIdsByChild.get(edge.sourceAtomId) ?? [];
    list.push(edge.targetAtomId);
    parentIdsByChild.set(edge.sourceAtomId, list);
  }

  const compareParentIds = (a: string, b: string): number => {
    const aAtom = atomById.get(a);
    const bAtom = atomById.get(b);

    const byTitle = (aAtom?.title ?? a).localeCompare(bAtom?.title ?? b, undefined, {
      sensitivity: "base",
      numeric: true,
    });

    if (byTitle !== 0) return byTitle;
    return a.localeCompare(b);
  };

  const chain: Atom[] = [];
  const stateById = new Map<string, number>();

  const visit = (atomId: string) => {
    const state = stateById.get(atomId) ?? 0;
    if (state === 2) return;
    if (state === 1) return;

    stateById.set(atomId, 1);
    const sortedParentIds = [...(parentIdsByChild.get(atomId) ?? [])].sort(compareParentIds);
    for (const parentId of sortedParentIds) {
      if (!atomById.has(parentId)) continue;
      visit(parentId);
    }

    stateById.set(atomId, 2);
    const current = atomById.get(atomId);
    if (current) {
      chain.push(current);
    }
  };

  visit(agent.id);

  const merged: AgentMetadata = {};
  const mergedSections: PromptSections = {};
  const allowedTools = new Set<string>();
  const deniedTools = new Set<string>();

  for (const atom of chain) {
    const metadata = (atom.metadata ?? {}) as AgentMetadata;

    if (metadata.model) merged.model = metadata.model;
    if (metadata.maxTurns) merged.maxTurns = metadata.maxTurns;
    for (const key of INHERITED_SCALARS) {
      if (typeof metadata[key] === "string" && metadata[key]) merged[key] = metadata[key];
    }
    if (typeof metadata.background === "boolean") merged.background = metadata.background;

    for (const tool of metadata.allowedTools ?? []) {
      allowedTools.add(tool);
    }

    for (const tool of metadata.deniedTools ?? []) {
      deniedTools.add(tool);
    }

    if (metadata.promptSections?.role) {
      mergedSections.role = metadata.promptSections.role;
    }

    if (metadata.promptSections?.constraints) {
      mergedSections.constraints = metadata.promptSections.constraints;
    }

    if (metadata.promptSections?.style) {
      mergedSections.style = metadata.promptSections.style;
    }

    if (metadata.promptSections?.custom) {
      mergedSections.custom = {
        ...(mergedSections.custom ?? {}),
        ...metadata.promptSections.custom,
      };
    }
  }

  for (const denied of deniedTools) {
    allowedTools.delete(denied);
  }

  merged.allowedTools = Array.from(allowedTools);
  merged.deniedTools = Array.from(deniedTools);
  merged.promptSections = mergedSections;

  const promptParts: string[] = [];

  if (mergedSections.role) {
    promptParts.push(`## Role\n\n${mergedSections.role}`);
  }

  if (mergedSections.constraints) {
    promptParts.push(`## Constraints\n\n${mergedSections.constraints}`);
  }

  if (mergedSections.style) {
    promptParts.push(`## Style\n\n${mergedSections.style}`);
  }

  if (mergedSections.custom) {
    for (const [key, value] of Object.entries(mergedSections.custom)) {
      promptParts.push(`## ${key}\n\n${value}`);
    }
  }

  promptParts.push(chain[chain.length - 1]?.content ?? agent.content);

  return {
    chain,
    metadata: merged,
    prompt: promptParts.join("\n\n"),
  };
}

export function resolveComposedSkills(agentId: string, edges: Edge[]): string[] {
  const composed = edges
    .filter((edge) => edge.label === "COMPOSES" && edge.sourceAtomId === agentId)
    .map((edge) => edge.targetAtomId);

  const requiresMap = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.label !== "REQUIRES") continue;
    const list = requiresMap.get(edge.sourceAtomId) ?? [];
    list.push(edge.targetAtomId);
    requiresMap.set(edge.sourceAtomId, list);
  }

  const all = new Set<string>(composed);
  const queue = [...composed];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    for (const dep of requiresMap.get(current) ?? []) {
      if (all.has(dep)) continue;
      all.add(dep);
      queue.push(dep);
    }
  }

  return Array.from(all);
}
