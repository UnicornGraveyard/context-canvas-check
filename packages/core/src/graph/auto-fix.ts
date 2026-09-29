import type { SourceAtom as Atom, SourceEdge as Edge } from "../model/source";
import { slugify } from "../util/slug";
import { getAllowedRelationshipLabels, isEdgeLabel, isRelationshipLabelAllowed, type EdgeLabel, preferredRelationshipLabel } from "../model/relationships";

type CycleLabel = Extract<EdgeLabel, "EXTENDS" | "REQUIRES" | "NEXT">;

export type BuildGateAutoFixOperation =
  | {
      kind: "DELETE_EDGE";
      edgeId: string;
      reason: string;
    }
  | {
      kind: "RELABEL_EDGE";
      edgeId: string;
      fromLabel: string;
      toLabel: EdgeLabel;
      reason: string;
    }
  | {
      kind: "RENAME_ATOM";
      atomId: string;
      fromTitle: string;
      toTitle: string;
      reason: string;
    };

export type BuildGateAutoFixPlan = {
  operations: BuildGateAutoFixOperation[];
  summary: {
    totalOperations: number;
    edgesDeleted: number;
    edgesRelabeled: number;
    atomsRenamed: number;
  };
};

function getTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function compareByCreatedAscThenId<T extends { id: string; createdAt?: unknown }>(a: T, b: T): number {
  const diff = getTimestamp(a.createdAt) - getTimestamp(b.createdAt);
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

function compareByCreatedDescThenIdDesc<T extends { id: string; createdAt?: unknown }>(a: T, b: T): number {
  const diff = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
  if (diff !== 0) return diff;
  return b.id.localeCompare(a.id);
}

function chooseReplacementLabel(sourceType: string, targetType: string): EdgeLabel | null {
  const allowed = getAllowedRelationshipLabels(sourceType, targetType);
  if (allowed.length === 0) return null;
  const preferred = preferredRelationshipLabel(sourceType, targetType);
  return allowed.includes(preferred) ? preferred : allowed[0];
}

function findCycleEdgeToRemove(edges: Edge[], label: CycleLabel): Edge | null {
  const filtered = edges.filter((edge) => edge.label === label);
  if (filtered.length === 0) return null;

  const adjacency = new Map<string, Edge[]>();
  const nodes = new Set<string>();

  for (const edge of filtered) {
    nodes.add(edge.sourceAtomId);
    nodes.add(edge.targetAtomId);
    const outgoing = adjacency.get(edge.sourceAtomId) ?? [];
    outgoing.push(edge);
    adjacency.set(edge.sourceAtomId, outgoing);
  }

  for (const outgoing of adjacency.values()) {
    outgoing.sort(compareByCreatedAscThenId);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackNodes: string[] = [];
  const stackEdges: Edge[] = [];
  let selectedEdge: Edge | null = null;

  const dfs = (nodeId: string): boolean => {
    visited.add(nodeId);
    inStack.add(nodeId);
    stackNodes.push(nodeId);

    for (const edge of adjacency.get(nodeId) ?? []) {
      const targetId = edge.targetAtomId;

      if (!visited.has(targetId)) {
        stackEdges.push(edge);
        if (dfs(targetId)) return true;
        stackEdges.pop();
        continue;
      }

      if (inStack.has(targetId)) {
        const cycleStartIndex = stackNodes.lastIndexOf(targetId);
        const cycleEdges = [...stackEdges.slice(cycleStartIndex), edge];
        selectedEdge = [...cycleEdges].sort(compareByCreatedDescThenIdDesc)[0] ?? edge;
        return true;
      }
    }

    inStack.delete(nodeId);
    stackNodes.pop();
    return false;
  };

  for (const nodeId of Array.from(nodes).sort()) {
    if (visited.has(nodeId)) continue;
    if (dfs(nodeId)) return selectedEdge;
  }

  return null;
}

function isPolicyRuleAtom(atom: Atom): boolean {
  if (atom.type !== "POLICY") return false;
  const metadata = atom.metadata as Record<string, unknown> | null;
  return metadata?.exportAsRule === true;
}

function getExportPath(atom: Atom, title: string): string | null {
  if (atom.type === "AGENT_CLASS") {
    return `.claude/agents/${slugify(title)}.md`;
  }

  if (atom.type === "SKILL") {
    return `.claude/skills/${slugify(title)}/SKILL.md`;
  }

  if (isPolicyRuleAtom(atom)) {
    return `.claude/rules/${slugify(title)}.md`;
  }

  return null;
}

function withNumericSuffix(title: string, suffix: number): string {
  const suffixText = ` ${suffix}`;
  const normalized = title.trim() || "Untitled";
  const maxBaseLength = Math.max(1, 140 - suffixText.length);
  return `${normalized.slice(0, maxBaseLength)}${suffixText}`;
}

function summarize(operations: BuildGateAutoFixOperation[]): BuildGateAutoFixPlan["summary"] {
  return {
    totalOperations: operations.length,
    edgesDeleted: operations.filter((operation) => operation.kind === "DELETE_EDGE").length,
    edgesRelabeled: operations.filter((operation) => operation.kind === "RELABEL_EDGE").length,
    atomsRenamed: operations.filter((operation) => operation.kind === "RENAME_ATOM").length,
  };
}

export function planBuildGateAutoFixes(atoms: Atom[], edges: Edge[]): BuildGateAutoFixPlan {
  const operations: BuildGateAutoFixOperation[] = [];

  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const titleByAtomId = new Map(atoms.map((atom) => [atom.id, atom.title]));
  const edgeById = new Map(edges.map((edge) => [edge.id, { ...edge }]));
  const deletedEdgeIds = new Set<string>();

  const removeEdge = (edge: Edge, reason: string) => {
    if (deletedEdgeIds.has(edge.id)) return;
    deletedEdgeIds.add(edge.id);
    operations.push({
      kind: "DELETE_EDGE",
      edgeId: edge.id,
      reason,
    });
  };

  const relabelEdge = (edge: Edge, toLabel: EdgeLabel, reason: string) => {
    if (deletedEdgeIds.has(edge.id)) return;
    if (edge.label === toLabel) return;

    const wouldDuplicate = Array.from(edgeById.values()).some(
      (candidate) =>
        !deletedEdgeIds.has(candidate.id) &&
        candidate.id !== edge.id &&
        candidate.sourceAtomId === edge.sourceAtomId &&
        candidate.targetAtomId === edge.targetAtomId &&
        candidate.label === toLabel
    );

    if (wouldDuplicate) {
      removeEdge(
        edge,
        `Removed duplicate edge while normalizing relationship label to ${toLabel}.`
      );
      return;
    }

    operations.push({
      kind: "RELABEL_EDGE",
      edgeId: edge.id,
      fromLabel: edge.label,
      toLabel,
      reason,
    });

    edge.label = toLabel;
    edgeById.set(edge.id, edge);
  };

  const orderedEdges = [...edgeById.values()].sort(compareByCreatedAscThenId);

  // Step 1: normalize invalid/mismatched edges.
  for (const edge of orderedEdges) {
    if (deletedEdgeIds.has(edge.id)) continue;

    if (edge.sourceAtomId === edge.targetAtomId) {
      removeEdge(edge, "Removed self-referential relationship.");
      continue;
    }

    const source = atomById.get(edge.sourceAtomId);
    const target = atomById.get(edge.targetAtomId);
    if (!source || !target) {
      removeEdge(edge, "Removed edge with missing source or target atom.");
      continue;
    }

    const replacement = chooseReplacementLabel(source.type, target.type);

    if (!isEdgeLabel(edge.label)) {
      if (!replacement) {
        removeEdge(
          edge,
          `Removed edge with unknown label ${edge.label} for disallowed ${source.type} -> ${target.type}.`
        );
      } else {
        relabelEdge(edge, replacement, `Replaced unknown label ${edge.label} with ${replacement}.`);
      }
      continue;
    }

    if (!isRelationshipLabelAllowed(edge.label, source.type, target.type)) {
      if (!replacement) {
        removeEdge(edge, `Removed invalid ${edge.label} for ${source.type} -> ${target.type}.`);
      } else {
        relabelEdge(edge, replacement, `Replaced invalid ${edge.label} with ${replacement}.`);
      }
    }
  }

  // Step 2: break EXTENDS, REQUIRES and NEXT cycles by removing the newest edge in each cycle.
  for (const label of ["EXTENDS", "REQUIRES", "NEXT"] as const) {
    while (true) {
      const activeEdges = [...edgeById.values()].filter((edge) => !deletedEdgeIds.has(edge.id));
      const cycleEdge = findCycleEdgeToRemove(activeEdges, label);
      if (!cycleEdge) break;
      removeEdge(cycleEdge, `Removed ${label} edge to break a cycle.`);
    }
  }

  // Step 3: resolve export path collisions by renaming later atoms deterministically.
  const getTitle = (atomId: string): string => {
    const title = titleByAtomId.get(atomId);
    if (typeof title === "string" && title.trim().length > 0) return title;
    return atomById.get(atomId)?.title ?? "Untitled";
  };

  const exportableAtoms = atoms
    .map((atom) => {
      const path = getExportPath(atom, getTitle(atom.id));
      return { atom, path };
    })
    .filter((item): item is { atom: Atom; path: string } => Boolean(item.path))
    .sort((a, b) => compareByCreatedAscThenId(a.atom, b.atom));

  const usedPaths = new Set<string>();
  const pathToAtomIds = new Map<string, string[]>();

  for (const item of exportableAtoms) {
    usedPaths.add(item.path);
    const ids = pathToAtomIds.get(item.path) ?? [];
    ids.push(item.atom.id);
    pathToAtomIds.set(item.path, ids);
  }

  for (const [path, atomIds] of pathToAtomIds.entries()) {
    if (atomIds.length <= 1) continue;

    for (let index = 1; index < atomIds.length; index += 1) {
      const atomId = atomIds[index];
      const atom = atomById.get(atomId);
      if (!atom) continue;

      const fromTitle = getTitle(atomId);
      let suffix = 2;
      let toTitle = fromTitle;
      let nextPath: string | null = null;

      while (suffix < 500) {
        const candidate = withNumericSuffix(fromTitle, suffix);
        const candidatePath = getExportPath(atom, candidate);
        if (candidatePath && !usedPaths.has(candidatePath)) {
          toTitle = candidate;
          nextPath = candidatePath;
          break;
        }
        suffix += 1;
      }

      if (!nextPath || toTitle === fromTitle) continue;

      titleByAtomId.set(atomId, toTitle);
      usedPaths.add(nextPath);
      operations.push({
        kind: "RENAME_ATOM",
        atomId,
        fromTitle,
        toTitle,
        reason: `Renamed to avoid export path collision at ${path}.`,
      });
    }
  }

  return {
    operations,
    summary: summarize(operations),
  };
}

/**
 * Applies a plan to in-memory atoms and edges (the browser demo; the server
 * applies the same plan to the database). Returns new arrays; inputs are not
 * mutated.
 */
export function applyAutoFixPlan<A extends { id: string; title: string }, E extends { id: string; label: string }>(
  atoms: A[],
  edges: E[],
  plan: BuildGateAutoFixPlan
): { atoms: A[]; edges: E[] } {
  const deletedEdgeIds = new Set<string>();
  const relabels = new Map<string, string>();
  const renames = new Map<string, string>();

  for (const operation of plan.operations) {
    if (operation.kind === "DELETE_EDGE") deletedEdgeIds.add(operation.edgeId);
    if (operation.kind === "RELABEL_EDGE") relabels.set(operation.edgeId, operation.toLabel);
    if (operation.kind === "RENAME_ATOM") renames.set(operation.atomId, operation.toTitle);
  }

  return {
    atoms: atoms.map((atom) => (renames.has(atom.id) ? { ...atom, title: renames.get(atom.id) as string } : atom)),
    edges: edges
      .filter((edge) => !deletedEdgeIds.has(edge.id))
      .map((edge) => (relabels.has(edge.id) ? { ...edge, label: relabels.get(edge.id) as string } : edge)),
  };
}
