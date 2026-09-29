type DirectedEdge = {
  sourceAtomId: string;
  targetAtomId: string;
  label: string;
};

/** True when the edges carrying `label` contain a directed cycle. */
export function hasCycle(edges: readonly DirectedEdge[], label: string): boolean {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    if (edge.label !== label) continue;
    nodes.add(edge.sourceAtomId);
    nodes.add(edge.targetAtomId);
    const neighbors = adjacency.get(edge.sourceAtomId) ?? [];
    neighbors.push(edge.targetAtomId);
    adjacency.set(edge.sourceAtomId, neighbors);
  }

  const state = new Map<string, number>();

  const visit = (node: string): boolean => {
    const nodeState = state.get(node) ?? 0;
    if (nodeState === 1) return true;
    if (nodeState === 2) return false;

    state.set(node, 1);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (visit(neighbor)) return true;
    }
    state.set(node, 2);
    return false;
  };

  for (const node of nodes) {
    if (visit(node)) return true;
  }

  return false;
}

/** Breadth-first search: can `toId` be reached from `fromId`? A node always reaches itself. */
export function hasPath(
  edges: readonly Pick<DirectedEdge, "sourceAtomId" | "targetAtomId">[],
  fromId: string,
  toId: string
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.sourceAtomId) ?? [];
    neighbors.push(edge.targetAtomId);
    adjacency.set(edge.sourceAtomId, neighbors);
  }

  const visited = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === toId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

/** True when adding `sourceId -label-> targetId` would close a cycle among `edges`. */
export function wouldCreateCycle(
  edges: readonly DirectedEdge[],
  sourceId: string,
  targetId: string,
  label: string
): boolean {
  return hasPath(
    edges.filter((edge) => edge.label === label),
    targetId,
    sourceId
  );
}
